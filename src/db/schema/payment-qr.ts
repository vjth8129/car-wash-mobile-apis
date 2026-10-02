import { pgTable, uuid, text, varchar, timestamp } from 'drizzle-orm/pg-core';
import { carWashes } from './car-washes';
import { users } from './users';

/**
 * The payment QR (e.g. a UPI QR) staff show customers at the counter - one per car wash.
 * Kept out of `car_washes` so car wash lists don't carry the image.
 */
export const carWashPaymentQrs = pgTable('car_wash_payment_qrs', {
  carWashId: uuid('car_wash_id')
    .primaryKey()
    .references(() => carWashes.id, { onDelete: 'cascade' }),
  /** data:image/(png|jpeg|webp);base64,... - resized on the device before upload. */
  image: text('image').notNull(),
  /** Optional text shown under the QR, e.g. the UPI ID or payee name. */
  note: varchar('note', { length: 100 }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CarWashPaymentQr = typeof carWashPaymentQrs.$inferSelect;
