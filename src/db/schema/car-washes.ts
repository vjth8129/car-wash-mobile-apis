import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  doublePrecision,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { carWashStatusEnum } from './enums';

export const carWashes = pgTable(
  'car_washes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 150 }).notNull(),
    code: varchar('code', { length: 50 }).notNull(),
    description: text('description'),
    phone: varchar('phone', { length: 30 }),
    email: varchar('email', { length: 150 }),
    address: text('address'),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 100 }),
    postalCode: varchar('postal_code', { length: 20 }),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    logo: text('logo'),
    status: carWashStatusEnum('status').notNull().default('ACTIVE'),
    timezone: varchar('timezone', { length: 60 }).notNull().default('Asia/Kolkata'),
    currency: varchar('currency', { length: 10 }).notNull().default('INR'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('car_washes_code_idx').on(table.code)],
);

export type CarWash = typeof carWashes.$inferSelect;
export type NewCarWash = typeof carWashes.$inferInsert;
