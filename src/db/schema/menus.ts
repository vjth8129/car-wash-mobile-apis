import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { AnyPgColumn } from 'drizzle-orm/pg-core';
import { permissions } from './permissions';

export const menus = pgTable(
  'menus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 100 }).notNull(),
    title: varchar('title', { length: 150 }).notNull(),
    icon: varchar('icon', { length: 100 }),
    route: varchar('route', { length: 200 }),
    // primary permission required to see this menu item; null = always visible when authenticated
    permissionId: uuid('permission_id').references(() => permissions.id, { onDelete: 'set null' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => menus.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('menus_key_idx').on(table.key)],
);

// Additional permissions that also grant visibility of a menu item (OR semantics with menus.permissionId)
export const menuPermissions = pgTable(
  'menu_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    menuId: uuid('menu_id')
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('menu_permissions_unique_idx').on(table.menuId, table.permissionId)],
);

export type Menu = typeof menus.$inferSelect;
export type NewMenu = typeof menus.$inferInsert;
