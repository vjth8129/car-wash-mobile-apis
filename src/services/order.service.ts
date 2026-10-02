import { eq } from 'drizzle-orm';
import { db } from '../db';
import { orders, bookings } from '../db/schema';
import * as orderRepo from '../repositories/order.repository';
import { findBookingById } from '../repositories/booking.repository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPagination } from '../utils/api-response';
import { PaginationQuery } from '../utils/pagination';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { AuthenticatedUser } from '../types/express';
import { Request } from 'express';

type OrderStatus = 'CREATED' | 'WASHING' | 'READY' | 'COMPLETED' | 'CANCELLED';

// CREATED is shown to staff as "Waiting".
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ['WASHING', 'CANCELLED'],
  WASHING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

// Order status -> corresponding booking status kept in sync, in the same transaction.
const BOOKING_STATUS_FOR_ORDER_STATUS: Partial<Record<OrderStatus, string>> = {
  WASHING: 'IN_PROGRESS',
  READY: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

export async function listOrders(
  carWashId: string,
  pagination: PaginationQuery,
  filters: { status?: string },
) {
  const { rows, total } = await orderRepo.listOrders({ carWashId, ...pagination, ...filters });
  return { rows, pagination: buildPagination(pagination.page, pagination.limit, total) };
}

export async function getOrder(carWashId: string, id: string) {
  const order = await orderRepo.findOrderById(id, carWashId);
  if (!order) throw new NotFoundError('Order not found');
  return order;
}

export async function createOrder(
  user: AuthenticatedUser,
  carWashId: string,
  bookingId: string,
  req?: Request,
) {
  const booking = await findBookingById(bookingId, carWashId);
  if (!booking) throw new ValidationError('Booking does not belong to your car wash');
  if (
    booking.status === 'CANCELLED' ||
    booking.status === 'COMPLETED' ||
    booking.status === 'NO_SHOW'
  ) {
    throw new ValidationError(`Cannot create an order for a booking with status ${booking.status}`);
  }

  const existingOrder = await orderRepo.findOrderByBookingId(bookingId, carWashId);
  if (existingOrder) {
    throw new ConflictError('An order already exists for this booking');
  }

  const order = await db.transaction(async (tx) => {
    const [newOrder] = await tx
      .insert(orders)
      .values({ carWashId, bookingId, status: 'CREATED', createdBy: user.id })
      .returning();
    if (booking.status === 'PENDING') {
      await tx
        .update(bookings)
        .set({ status: 'CONFIRMED', updatedAt: new Date() })
        .where(eq(bookings.id, bookingId));
    }
    return newOrder;
  });

  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.ORDER_CREATED,
    entityType: 'ORDER',
    entityId: order.id,
  });
  return getOrder(carWashId, order.id);
}

export async function updateOrderStatus(
  carWashId: string,
  id: string,
  nextStatus: OrderStatus,
  req?: Request,
) {
  const existing = await orderRepo.findOrderById(id, carWashId);
  if (!existing) throw new NotFoundError('Order not found');

  const allowed = ALLOWED_TRANSITIONS[existing.status as OrderStatus];
  if (!allowed.includes(nextStatus)) {
    throw new ValidationError(`Cannot transition order from ${existing.status} to ${nextStatus}`);
  }

  const timestampField: Partial<Record<OrderStatus, string>> = {
    WASHING: 'washStartedAt',
    READY: 'readyAt',
    COMPLETED: 'completedAt',
    CANCELLED: 'cancelledAt',
  };

  await db.transaction(async (tx) => {
    const updates: Record<string, unknown> = { status: nextStatus, updatedAt: new Date() };
    const field = timestampField[nextStatus];
    if (field) updates[field] = new Date();
    if (nextStatus === 'COMPLETED') {
      // The booking's price snapshot reflects the private/taxi rate at booking time;
      // fall back to the service price for bookings created before prices were snapshotted.
      const amount = existing.booking?.price ?? existing.booking?.service?.price;
      if (amount) updates.totalAmount = amount;
    }
    await tx.update(orders).set(updates).where(eq(orders.id, id));

    const bookingStatus = BOOKING_STATUS_FOR_ORDER_STATUS[nextStatus];
    if (bookingStatus) {
      await tx
        .update(bookings)
        .set({ status: bookingStatus as any, updatedAt: new Date() })
        .where(eq(bookings.id, existing.bookingId));
    }
  });

  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.ORDER_UPDATED,
    entityType: 'ORDER',
    entityId: id,
    metadata: { status: nextStatus },
  });
  return getOrder(carWashId, id);
}
