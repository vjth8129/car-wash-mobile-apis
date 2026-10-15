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
    /** GSTIN, e.g. 29ABCDE1234F1Z5. Required for self sign-ups. */
    gstNumber: varchar('gst_number', { length: 15 }),
    logo: text('logo'),
    status: carWashStatusEnum('status').notNull().default('ACTIVE'),
    /** ADMIN: onboarded by a platform admin. SELF_SIGNUP: the owner signed up from the app. */
    source: varchar('source', { length: 20 }).notNull().default('ADMIN'),
    timezone: varchar('timezone', { length: 60 }).notNull().default('Asia/Kolkata'),
    currency: varchar('currency', { length: 10 }).notNull().default('INR'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('car_washes_code_idx').on(table.code)],
);

/** A car wash's location: one row per car wash. */
export const carWashAddresses = pgTable(
  'car_wash_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carWashId: uuid('car_wash_id')
      .notNull()
      .references(() => carWashes.id, { onDelete: 'cascade' }),
    address: text('address'),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 100 }),
    postalCode: varchar('postal_code', { length: 20 }),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('car_wash_addresses_car_wash_id_idx').on(table.carWashId)],
);

export type CarWashRow = typeof carWashes.$inferSelect;
export type NewCarWash = typeof carWashes.$inferInsert;
export type CarWashAddress = typeof carWashAddresses.$inferSelect;
export type NewCarWashAddress = typeof carWashAddresses.$inferInsert;

export const ADDRESS_FIELDS = [
  'address',
  'city',
  'state',
  'country',
  'postalCode',
  'latitude',
  'longitude',
] as const;
export type AddressFields = Pick<CarWashAddress, (typeof ADDRESS_FIELDS)[number]>;

/** A car wash as the API returns it: its address fields flattened in. */
export type CarWash = CarWashRow & AddressFields;
