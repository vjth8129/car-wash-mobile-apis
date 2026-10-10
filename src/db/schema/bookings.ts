import { pgTable, uuid, text, date, time, timestamp, index, numeric } from 'drizzle-orm/pg-core';
import { carWashes } from './car-washes';
import { customers } from './customers';
import { vehicles } from './vehicles';
import { services } from './services';
import { users } from './users';
import { bookingStatusEnum, vehicleCategoryEnum } from './enums';
import { vehicleCategories } from './vehicle-categories';

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carWashId: uuid('car_wash_id')
      .notNull()
      .references(() => carWashes.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    bookingDate: date('booking_date').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    status: bookingStatusEnum('status').notNull().default('PENDING'),
    notes: text('notes'),
    /** Legacy PRIVATE/TAXI flag for older clients; categoryId is the source of truth. */
    vehicleCategory: vehicleCategoryEnum('vehicle_category').notNull().default('PRIVATE'),
    categoryId: uuid('category_id').references(() => vehicleCategories.id, {
      onDelete: 'set null',
    }),
    /**
     * Total charged: the sum of the booking_services price snapshots, taken from each service's
     * rate for the vehicle category when booked, so later rate changes don't alter it.
     */
    price: numeric('price', { precision: 10, scale: 2 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('bookings_car_wash_id_idx').on(table.carWashId),
    index('bookings_booking_date_idx').on(table.bookingDate),
    index('bookings_customer_id_idx').on(table.customerId),
    index('bookings_vehicle_id_idx').on(table.vehicleId),
    index('bookings_status_idx').on(table.status),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
