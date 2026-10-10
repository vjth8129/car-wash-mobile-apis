import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { carWashes } from './car-washes';
import { customers } from './customers';
import { vehicleTypeEnum } from './enums';
import { vehicleCategories } from './vehicle-categories';

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carWashId: uuid('car_wash_id')
      .notNull()
      .references(() => carWashes.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    registrationNumber: varchar('registration_number', { length: 30 }).notNull(),
    brand: varchar('brand', { length: 100 }),
    model: varchar('model', { length: 100 }),
    variant: varchar('variant', { length: 100 }),
    color: varchar('color', { length: 50 }),
    year: integer('year'),
    vehicleType: vehicleTypeEnum('vehicle_type').notNull().default('OTHER'),
    /** Private / taxi / ... as last washed; pre-selected for the next wash. */
    categoryId: uuid('category_id').references(() => vehicleCategories.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('vehicles_car_wash_id_idx').on(table.carWashId),
    index('vehicles_customer_id_idx').on(table.customerId),
    uniqueIndex('vehicles_car_wash_reg_idx').on(table.carWashId, table.registrationNumber),
  ],
);

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
