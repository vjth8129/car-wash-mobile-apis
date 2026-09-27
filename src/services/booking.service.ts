import * as bookingRepo from '../repositories/booking.repository';
import { findCustomerById } from '../repositories/customer.repository';
import { findVehicleById } from '../repositories/vehicle.repository';
import { findServiceById } from '../repositories/service.repository';
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

type VehicleCategory = 'PRIVATE' | 'TAXI';

/** The rate a booking is charged: the taxi rate for taxis when one is set, else the regular price. */
export function rateForCategory(
  service: { price: string; taxiPrice: string | null },
  category: VehicleCategory,
): string {
  return category === 'TAXI' && service.taxiPrice !== null ? service.taxiPrice : service.price;
}

/** Editable fields (date/time/service/vehicle/notes) only make sense before work has started. */
const EDITABLE_STATUSES: BookingStatus[] = ['PENDING', 'CONFIRMED'];

function addMinutesToTime(startTime: string, minutes: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

async function validateRelations(
  carWashId: string,
  {
    customerId,
    vehicleId,
    serviceId,
  }: { customerId: string; vehicleId: string; serviceId: string },
) {
  const [customer, vehicle, service] = await Promise.all([
    findCustomerById(customerId, carWashId),
    findVehicleById(vehicleId, carWashId),
    findServiceById(serviceId, carWashId),
  ]);
  if (!customer) throw new ValidationError('Customer does not belong to your car wash');
  if (!vehicle) throw new ValidationError('Vehicle does not belong to your car wash');
  if (vehicle.customerId !== customerId) {
    throw new ValidationError('Vehicle does not belong to the specified customer');
  }
  if (!service) throw new ValidationError('Service does not belong to your car wash');
  if (service.status !== 'ACTIVE') throw new ValidationError('Service is not currently active');
  return { customer, vehicle, service };
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
  const { service } = await validateRelations(carWashId, input);
  const endTime = addMinutesToTime(input.startTime, service.durationMinutes);

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

  const vehicleCategory: VehicleCategory = input.vehicleCategory ?? 'PRIVATE';
  const booking = await bookingRepo.createBooking({
    carWashId,
    customerId: input.customerId,
    vehicleId: input.vehicleId,
    serviceId: input.serviceId,
    bookingDate: input.bookingDate,
    startTime: input.startTime,
    endTime,
    notes: input.notes,
    vehicleCategory,
    price: rateForCategory(service, vehicleCategory),
    createdBy: user.id,
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

  const customerId = existing.customerId;
  const vehicleId = input.vehicleId ?? existing.vehicleId;
  const serviceId = input.serviceId ?? existing.serviceId;
  const { service } = await validateRelations(carWashId, { customerId, vehicleId, serviceId });

  const bookingDate = input.bookingDate ?? existing.bookingDate;
  const startTime = input.startTime ?? existing.startTime;
  const endTime = addMinutesToTime(startTime, service.durationMinutes);

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

  const vehicleCategory: VehicleCategory = input.vehicleCategory ?? existing.vehicleCategory;
  // Re-price only when what's being bought changed; otherwise keep the original snapshot.
  const repriced = serviceId !== existing.serviceId || vehicleCategory !== existing.vehicleCategory;

  await bookingRepo.updateBooking(id, carWashId, {
    vehicleId,
    serviceId,
    bookingDate,
    startTime,
    endTime,
    notes: input.notes ?? existing.notes,
    vehicleCategory,
    price:
      repriced || existing.price === null
        ? rateForCategory(service, vehicleCategory)
        : existing.price,
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
