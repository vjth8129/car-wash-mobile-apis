import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { orders, Order } from '../db/schema';
import { bookingDetailRelations } from './booking.repository';

export interface OrderWithBooking extends Order {
  booking: {
    id: string;
    status: string;
    vehicleCategory: 'PRIVATE' | 'TAXI';
    categoryId: string | null;
    price: string | null;
    category: { id: string; code: string; name: string } | null;
    items: {
      id: string;
      serviceId: string;
      name: string;
      price: string;
      durationMinutes: number;
    }[];
    customer: { id: string; name: string; phone: string } | null;
    vehicle: { id: string; registrationNumber: string } | null;
    service: {
      id: string;
      name: string;
      price: string;
      taxiPrice: string | null;
      durationMinutes: number;
    } | null;
  };
}

export async function findOrderById(
  id: string,
  carWashId: string,
): Promise<OrderWithBooking | undefined> {
  const row = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.carWashId, carWashId)),
    with: {
      booking: {
        with: {
          customer: { columns: { id: true, name: true, phone: true } },
          vehicle: { columns: { id: true, registrationNumber: true } },
          service: {
            columns: { id: true, name: true, price: true, taxiPrice: true, durationMinutes: true },
          },
          ...bookingDetailRelations,
        },
      },
    },
  });
  return row as unknown as OrderWithBooking | undefined;
}

export async function findOrderByBookingId(
  bookingId: string,
  carWashId: string,
): Promise<Order | undefined> {
  return db.query.orders.findFirst({
    where: and(eq(orders.bookingId, bookingId), eq(orders.carWashId, carWashId)),
  });
}

interface ListOrdersOptions {
  carWashId: string;
  status?: string;
  paymentStatus?: 'PAID' | 'UNPAID';
  page: number;
  limit: number;
  offset: number;
}

export async function listOrders(options: ListOrdersOptions) {
  const conditions = [eq(orders.carWashId, options.carWashId)];
  if (options.status) {
    conditions.push(
      eq(
        orders.status,
        options.status as 'CREATED' | 'WASHING' | 'READY' | 'COMPLETED' | 'CANCELLED',
      ),
    );
  }
  if (options.paymentStatus) {
    conditions.push(
      options.paymentStatus === 'PAID' ? isNotNull(orders.paidAt) : isNull(orders.paidAt),
    );
  }
  const where = and(...conditions);

  const [rows, totalRow] = await Promise.all([
    db.query.orders.findMany({
      where,
      with: {
        booking: {
          with: {
            customer: { columns: { id: true, name: true, phone: true } },
            vehicle: { columns: { id: true, registrationNumber: true } },
            service: { columns: { id: true, name: true, price: true, taxiPrice: true } },
            ...bookingDetailRelations,
          },
        },
      },
      limit: options.limit,
      offset: options.offset,
      orderBy: (o, { desc }) => [desc(o.createdAt)],
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(where),
  ]);

  return { rows, total: totalRow[0]?.count ?? 0 };
}
