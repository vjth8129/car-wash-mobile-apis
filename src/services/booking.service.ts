import * as bookingRepo from '../repositories/booking.repository';
import { findCustomerById } from '../repositories/customer.repository';
import { findVehicleById } from '../repositories/vehicle.repository';
import { findServicesByIds, ServiceWithRates } from '../repositories/service.repository';
import { resolveCategory } from './vehicle-category.service';
import { db } from '../db';
import {
  bookings,
  bookingServices,
  vehicles,
  VehicleCategory,
  TAXI_VEHICLE_CATEGORY_CODE,
} from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPagination } from '../utils/api-response';
import { PaginationQuery } from '../utils/pagination';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { AuthenticatedUser } from '../types/express';
import { Request } from 'express';

type BookingStatus =
  'PENDING' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** The rate a service charges for a vehicle category: its rate for that category, else its price. */
export function rateForCategory(
  service: { price: string; rates?: { categoryId: string; price: string }[] },
  categoryId: string,
): string {
  return service.rates?.find((r) => r.categoryId === categoryId)?.price ?? service.price;
}

/** Older clients read a PRIVATE/TAXI flag; any other category counts as private for them. */
const legacyCategoryFlag = (category: VehicleCategory): 'PRIVATE' | 'TAXI' =>
  category.code === TAXI_VEHICLE_CATEGORY_CODE ? 'TAXI' : 'PRIVATE';

/** Editable fields (date/time/service/vehicle/notes) only make sense before work has started. */
const EDITABLE_STATUSES: BookingStatus[] = ['PENDING', 'CONFIRMED'];

function addMinutesToTime(startTime: string, minutes: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

const uniqueIds = (ids: string[]) => [...new Set(ids)];

async function validateRelations(
  carWashId: string,
  { customerId, vehicleId }: { customerId: string; vehicleId: string },
) {
  const [customer, vehicle] = await Promise.all([
    findCustomerById(customerId, carWashId),
    findVehicleById(vehicleId, carWashId),
  ]);
  if (!customer) throw new ValidationError('Customer does not belong to your car wash');
  if (!vehicle) throw new ValidationError('Vehicle does not belong to your car wash');
  if (vehicle.customerId !== customerId) {
    throw new ValidationError('Vehicle does not belong to the specified customer');
  }
  return { customer, vehicle };
}

/** Loads the chosen services (all must be active and in this car wash), in the order given. */
async function loadServices(carWashId: string, serviceIds: string[]) {
  const found = await findServicesByIds(serviceIds, carWashId);
  return serviceIds.map((id) => {
    const service = found.find((s) => s.id === id);
    if (!service) throw new ValidationError('Service does not belong to your car wash');
    if (service.status !== 'ACTIVE') {
      throw new ValidationError(`${service.name} is not currently active`);
    }
    return service;
  });
}

/** Line items snapshotted from each service's rate for the category, plus their totals. */
function priceItems(services: ServiceWithRates[], category: VehicleCategory) {
  const items = services.map((service, i) => ({
    serviceId: service.id,
    name: service.name,
    price: rateForCategory(service, category.id),
    durationMinutes: service.durationMinutes,
    sortOrder: i,
  }));
  const total = items.reduce((sum, item) => sum + Number(item.price), 0).toFixed(2);
  const minutes = items.reduce((sum, item) => sum + item.durationMinutes, 0);
  return { items, total, minutes };
}

export async function listBookings(
  carWashId: string,
  pagination: PaginationQuery,
  filters: { status?: string; dateFrom?: string; dateTo?: string; customerId?: string },
) {
  const { rows, total } = await bookingRepo.listBookings({ carWashId, ...pagination, ...filters });
  return { rows, pagination: buildPagination(pagination.page, pagination.limit, total) };
}

export async function getBooking(carWashId: string, id: string) {
  const booking = await bookingRepo.findBookingById(id, carWashId);
  if (!booking) throw new NotFoundError('Booking not found');
  return booking;
}

export async function createBooking(
  user: AuthenticatedUser,
  carWashId: string,
  input: any,
  req?: Request,
) {
  const { vehicle } = await validateRelations(carWashId, input);
  const services = await loadServices(carWashId, uniqueIds(input.serviceIds ?? [input.serviceId]));
  // An explicit choice wins; otherwise the vehicle's usual category (e.g. a known taxi).
  const category = await resolveCategory({
    categoryId: input.vehicleCategoryId,
    code: input.vehicleCategory,
    fallbackId: vehicle.categoryId,
  });
  const { items, total, minutes } = priceItems(services, category);
  const endTime = addMinutesToTime(input.startTime, minutes);

  const conflicts = await bookingRepo.findOverlappingBookingsForVehicle(
    carWashId,
    input.vehicleId,
    input.bookingDate,
    input.startTime,
    endTime,
  );
  if (conflicts.length > 0) {
    throw new ConflictError('This vehicle already has an overlapping booking at that time');
  }

  const booking = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(bookings)
      .values({
        carWashId,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        serviceId: services[0].id,
        bookingDate: input.bookingDate,
        startTime: input.startTime,
        endTime,
        notes: input.notes,
        vehicleCategory: legacyCategoryFlag(category),
        categoryId: category.id,
        price: total,
        createdBy: user.id,
      })
      .returning();
    await tx.insert(bookingServices).values(items.map((item) => ({ ...item, bookingId: row.id })));
    // The vehicle remembers its category so the next wash starts with it.
    if (vehicle.categoryId !== category.id) {
      await tx
        .update(vehicles)
        .set({ categoryId: category.id, updatedAt: new Date() })
        .where(eq(vehicles.id, vehicle.id));
    }
    return row;
  });

  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.BOOKING_CREATED,
    entityType: 'BOOKING',
    entityId: booking.id,
  });

  return getBooking(carWashId, booking.id);
}

export async function updateBooking(carWashId: string, id: string, input: any, req?: Request) {
  const existing = await bookingRepo.findBookingById(id, carWashId);
  if (!existing) throw new NotFoundError('Booking not found');
  if (!EDITABLE_STATUSES.includes(existing.status as BookingStatus)) {
    throw new ValidationError(`Cannot modify a booking with status ${existing.status}`);
  }
  const existingItems = (existing as any).items as { serviceId: string; durationMinutes: number }[];

  const customerId = existing.customerId;
  const vehicleId = input.vehicleId ?? existing.vehicleId;
  const { vehicle } = await validateRelations(carWashId, { customerId, vehicleId });

  const serviceIds: string[] = uniqueIds(
    input.serviceIds ??
      (input.serviceId
        ? [input.serviceId]
        : existingItems.length
          ? existingItems.map((i) => i.serviceId)
          : [existing.serviceId]),
  );
  const servicesChanged =
    serviceIds.join() !==
    (existingItems.length ? existingItems.map((i) => i.serviceId) : [existing.serviceId]).join();
  const categoryChosen =
    input.vehicleCategoryId !== undefined || input.vehicleCategory !== undefined;
  const category = await resolveCategory({
    categoryId: input.vehicleCategoryId,
    code: input.vehicleCategory,
    fallbackId: existing.categoryId,
  });
  // Re-price only when what's being bought changed; otherwise keep the original snapshot.
  const repriced =
    servicesChanged ||
    category.id !== existing.categoryId ||
    existing.price === null ||
    !existingItems.length;
  const priced = repriced ? priceItems(await loadServices(carWashId, serviceIds), category) : null;

  const bookingDate = input.bookingDate ?? existing.bookingDate;
  const startTime = input.startTime ?? existing.startTime;
  const minutes = priced
    ? priced.minutes
    : existingItems.reduce((sum, item) => sum + item.durationMinutes, 0);
  const endTime = addMinutesToTime(startTime, minutes);

  const conflicts = await bookingRepo.findOverlappingBookingsForVehicle(
    carWashId,
    vehicleId,
    bookingDate,
    startTime,
    endTime,
    id,
  );
  if (conflicts.length > 0) {
    throw new ConflictError('This vehicle already has an overlapping booking at that time');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(bookings)
      .set({
        vehicleId,
        serviceId: serviceIds[0],
        bookingDate,
        startTime,
        endTime,
        notes: input.notes ?? existing.notes,
        vehicleCategory: legacyCategoryFlag(category),
        categoryId: category.id,
        ...(priced ? { price: priced.total } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(bookings.id, id), eq(bookings.carWashId, carWashId)));
    if (priced) {
      await tx.delete(bookingServices).where(eq(bookingServices.bookingId, id));
      await tx
        .insert(bookingServices)
        .values(priced.items.map((item) => ({ ...item, bookingId: id })));
    }
    if (categoryChosen && vehicle.categoryId !== category.id) {
      await tx
        .update(vehicles)
        .set({ categoryId: category.id, updatedAt: new Date() })
        .where(eq(vehicles.id, vehicle.id));
    }
  });

  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.BOOKING_UPDATED,
    entityType: 'BOOKING',
    entityId: id,
  });
  return getBooking(carWashId, id);
}

async function transitionBookingStatus(carWashId: string, id: string, nextStatus: BookingStatus) {
  const existing = await bookingRepo.findBookingById(id, carWashId);
  if (!existing) throw new NotFoundError('Booking not found');

  const allowed = ALLOWED_TRANSITIONS[existing.status as BookingStatus];
  if (!allowed.includes(nextStatus)) {
    throw new ValidationError(`Cannot transition booking from ${existing.status} to ${nextStatus}`);
  }

  await bookingRepo.updateBooking(id, carWashId, { status: nextStatus });
  return getBooking(carWashId, id);
}

export async function cancelBooking(carWashId: string, id: string, req?: Request) {
  const booking = await transitionBookingStatus(carWashId, id, 'CANCELLED');
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.BOOKING_CANCELLED,
    entityType: 'BOOKING',
    entityId: id,
  });
  return booking;
}

export async function completeBooking(carWashId: string, id: string, req?: Request) {
  const existing = await bookingRepo.findBookingById(id, carWashId);
  if (!existing) throw new NotFoundError('Booking not found');
  // Completion is normally driven by the order workflow reaching COMPLETED, but allow a
  // direct shortcut from CONFIRMED for car washes that don't use the order/job workflow.
  const nextStatus: BookingStatus = 'COMPLETED';
  const allowedFrom: BookingStatus[] = ['IN_PROGRESS', 'CONFIRMED'];
  if (!allowedFrom.includes(existing.status as BookingStatus)) {
    throw new ValidationError(`Cannot complete a booking with status ${existing.status}`);
  }
  await bookingRepo.updateBooking(id, carWashId, { status: nextStatus });
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.BOOKING_COMPLETED,
    entityType: 'BOOKING',
    entityId: id,
  });
  return getBooking(carWashId, id);
}

export async function confirmBookingInternal(carWashId: string, id: string) {
  return transitionBookingStatus(carWashId, id, 'CONFIRMED');
}

export async function markBookingInProgressInternal(carWashId: string, id: string) {
  return transitionBookingStatus(carWashId, id, 'IN_PROGRESS');
}

export async function markBookingCompletedInternal(carWashId: string, id: string) {
  return transitionBookingStatus(carWashId, id, 'COMPLETED');
}

export async function markBookingCancelledInternal(carWashId: string, id: string) {
  return transitionBookingStatus(carWashId, id, 'CANCELLED');
}
