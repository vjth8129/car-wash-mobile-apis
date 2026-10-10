import { pgTable, uuid, numeric, timestamp, index, varchar } from 'drizzle-orm/pg-core';
import { carWashes } from './car-washes';
import { bookings } from './bookings';
import { users } from './users';
import { orderStatusEnum } from './enums';

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carWashId: uuid('car_wash_id')
      .notNull()
      .references(() => carWashes.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    status: orderStatusEnum('status').notNull().default('CREATED'),
    /** No longer set (the CHECKED_IN step was removed); kept for older orders. */
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    washStartedAt: timestamp('wash_started_at', { withTimezone: true }),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    totalAmount: numeric('total_amount', { precision: 10, scale: 2 }),
    /** Staff noted the customer paid (the app doesn't take payments itself). */
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /** UPI or CASH. */
    paymentMethod: varchar('payment_method', { length: 20 }),
    paidBy: uuid('paid_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('orders_car_wash_id_idx').on(table.carWashId),
    index('orders_booking_id_idx').on(table.bookingId),
    index('orders_status_idx').on(table.status),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
