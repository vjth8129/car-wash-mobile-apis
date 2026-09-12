import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { carWashes } from './car-washes';
import { statusEnum } from './enums';

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carWashId: uuid('car_wash_id')
      .notNull()
      .references(() => carWashes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 150 }).notNull(),
    phone: varchar('phone', { length: 30 }).notNull(),
    email: varchar('email', { length: 150 }),
    address: text('address'),
    status: statusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('customers_car_wash_id_idx').on(table.carWashId),
    index('customers_phone_idx').on(table.phone),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
