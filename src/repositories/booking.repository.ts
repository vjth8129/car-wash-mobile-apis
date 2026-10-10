import { and, eq, gte, lte, lt, gt, ne, sql } from 'drizzle-orm';
import { db } from '../db';
import { bookings, Booking, NewBooking } from '../db/schema';

/** Services in a booking and its vehicle category, included wherever bookings are returned. */
export const bookingDetailRelations = {
  items: {
    columns: { id: true, serviceId: true, name: true, price: true, durationMinutes: true },
    orderBy: (i: any, { asc }: any) => [asc(i.sortOrder)],
  },
  category: { columns: { id: true, code: true, name: true } },
} as const;

export async function findBookingById(id: string, carWashId: string): Promise<Booking | undefined> {
  return db.query.bookings.findFirst({
    where: and(eq(bookings.id, id), eq(bookings.carWashId, carWashId)),
    with: {
      customer: { columns: { id: true, name: true, phone: true } },
      vehicle: { columns: { id: true, registrationNumber: true } },
      service: {
        columns: { id: true, name: true, price: true, taxiPrice: true, durationMinutes: true },
      },
      ...bookingDetailRelations,
    },
  });
}

export async function createBooking(data: NewBooking): Promise<Booking> {
  const [row] = await db.insert(bookings).values(data).returning();
  return row;
}

export async function updateBooking(
  id: string,
  carWashId: string,
  data: Partial<NewBooking>,
): Promise<Booking | undefined> {
  const [row] = await db
    .update(bookings)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(bookings.id, id), eq(bookings.carWashId, carWashId)))
    .returning();
  return row;
}

/**
 * Finds open bookings for the same vehicle whose time range overlaps. Completed washes don't
 * count: the car is free once it's handed over, even if that was before the planned end time.
 */
export async function findOverlappingBookingsForVehicle(
  carWashId: string,
  vehicleId: string,
  bookingDate: string,
  startTime: string,
  endTime: string,
  excludeBookingId?: string,
) {
  const conditions = [
    eq(bookings.carWashId, carWashId),
    eq(bookings.vehicleId, vehicleId),
    eq(bookings.bookingDate, bookingDate),
    lt(bookings.startTime, endTime),
    gt(bookings.endTime, startTime),
    sql`${bookings.status} not in ('CANCELLED', 'NO_SHOW', 'COMPLETED')`,
  ];
  if (excludeBookingId) {
    conditions.push(ne(bookings.id, excludeBookingId));
  }
  return db.query.bookings.findMany({ where: and(...conditions) });
}

interface ListBookingsOptions {
  carWashId: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  page: number;
  limit: number;
  offset: number;
}

export async function listBookings(options: ListBookingsOptions) {
  const conditions = [eq(bookings.carWashId, options.carWashId)];
  if (options.status) {
    conditions.push(
      eq(
        bookings.status,
        options.status as
          'PENDING' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW',
      ),
    );
  }
  if (options.customerId) {
    conditions.push(eq(bookings.customerId, options.customerId));
  }
  if (options.dateFrom) {
    conditions.push(gte(bookings.bookingDate, options.dateFrom));
  }
  if (options.dateTo) {
    conditions.push(lte(bookings.bookingDate, options.dateTo));
  }
  const where = and(...conditions);

  const [rows, totalRow] = await Promise.all([
    db.query.bookings.findMany({
      where,
      with: {
        customer: { columns: { id: true, name: true, phone: true } },
        vehicle: { columns: { id: true, registrationNumber: true } },
        service: {
          columns: { id: true, name: true, price: true, taxiPrice: true, durationMinutes: true },
        },
        ...bookingDetailRelations,
      },
      limit: options.limit,
      offset: options.offset,
      orderBy: (b, { desc }) => [desc(b.bookingDate), desc(b.startTime)],
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(where),
  ]);

  return { rows, total: totalRow[0]?.count ?? 0 };
}
