import { pgTable, uuid, varchar, integer, numeric, index } from 'drizzle-orm/pg-core';
import { bookings } from './bookings';
import { services } from './services';

/**
 * The services bought in one booking (a wash can include several). Name, duration and price
 * are snapshotted so later service edits don't change past bookings; bookings.price is their sum.
 */
export const bookingServices = pgTable(
  'booking_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 150 }).notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('booking_services_booking_id_idx').on(table.bookingId),
    index('booking_services_service_id_idx').on(table.serviceId),
  ],
);

export type BookingService = typeof bookingServices.$inferSelect;
export type NewBookingService = typeof bookingServices.$inferInsert;
