import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { services } from './services';
import { statusEnum } from './enums';

/**
 * How a vehicle is used (Private, Taxi, ...) - decides which service rate is charged.
 * Platform-wide; managed by platform admins from the admin portal.
 */
export const vehicleCategories = pgTable('vehicle_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stable key, e.g. PRIVATE / TAXI. PRIVATE is the default for new vehicles. */
  code: varchar('code', { length: 30 }).notNull().unique(),
  name: varchar('name', { length: 50 }).notNull(),
  description: varchar('description', { length: 200 }),
  status: statusEnum('status').notNull().default('ACTIVE'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A service's rate for one vehicle category; categories without a row are charged services.price. */
export const serviceRates = pgTable(
  'service_rates',
  {
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => vehicleCategories.id, { onDelete: 'cascade' }),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.serviceId, table.categoryId] }),
    index('service_rates_category_id_idx').on(table.categoryId),
  ],
);

export const DEFAULT_VEHICLE_CATEGORY_CODE = 'PRIVATE';
export const TAXI_VEHICLE_CATEGORY_CODE = 'TAXI';

export type VehicleCategory = typeof vehicleCategories.$inferSelect;
export type NewVehicleCategory = typeof vehicleCategories.$inferInsert;
export type ServiceRate = typeof serviceRates.$inferSelect;
