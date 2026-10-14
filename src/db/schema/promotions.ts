import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { carWashes } from './car-washes';
import { customers } from './customers';
import { users } from './users';

/** SCHEDULED → SENDING → SENT (or FAILED when nothing went out); CANCELLED only before sending. */
export const PROMOTION_STATUSES = ['SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export const PROMOTION_CHANNELS = ['WHATSAPP', 'SMS'] as const;
export type PromotionChannel = (typeof PROMOTION_CHANNELS)[number];

export const RECIPIENT_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

/** A message sent (now or at a scheduled time) to a group of customers the owner picked. */
export const promotions = pgTable(
  'promotions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carWashId: uuid('car_wash_id')
      .notNull()
      .references(() => carWashes.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 150 }).notNull(),
    /** May contain {name}, replaced with each customer's first name. */
    message: text('message').notNull(),
    channel: varchar('channel', { length: 20 }).$type<PromotionChannel>().notNull(),
    status: varchar('status', { length: 20 })
      .$type<PromotionStatus>()
      .notNull()
      .default('SCHEDULED'),
    /** When it goes out; "send now" is stored as the time it was created. */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /** How the group was picked, e.g. "Basic Wash · last 7 days", and the filters behind it. */
    audienceLabel: varchar('audience_label', { length: 200 }),
    audience: jsonb('audience'),
    recipientCount: integer('recipient_count').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    /** Which message provider sent it ("console" = logged only, nothing delivered). */
    deliveryMode: varchar('delivery_mode', { length: 30 }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('promotions_car_wash_id_idx').on(table.carWashId),
    index('promotions_status_scheduled_at_idx').on(table.status, table.scheduledAt),
  ],
);

/** One customer in a promotion, with their name and phone as they were when it was created. */
export const promotionRecipients = pgTable(
  'promotion_recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 150 }).notNull(),
    phone: varchar('phone', { length: 30 }),
    status: varchar('status', { length: 20 }).$type<RecipientStatus>().notNull().default('PENDING'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    error: text('error'),
  },
  (table) => [index('promotion_recipients_promotion_id_idx').on(table.promotionId)],
);

export type Promotion = typeof promotions.$inferSelect;
export type NewPromotion = typeof promotions.$inferInsert;
export type PromotionRecipient = typeof promotionRecipients.$inferSelect;
