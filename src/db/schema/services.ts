import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { carWashes } from './car-washes';
import { statusEnum } from './enums';

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carWashId: uuid('car_wash_id')
      .notNull()
      .references(() => carWashes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 150 }).notNull(),
    description: text('description'),
    /** Rate for private vehicles (the default rate). */
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    /** Rate for taxis; null means taxis are charged `price`. */
    taxiPrice: numeric('taxi_price', { precision: 10, scale: 2 }),
    durationMinutes: integer('duration_minutes').notNull(),
    status: statusEnum('status').notNull().default('ACTIVE'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('services_car_wash_id_idx').on(table.carWashId),
    uniqueIndex('services_car_wash_name_idx').on(table.carWashId, table.name),
  ],
);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
