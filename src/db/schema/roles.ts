import { pgTable, uuid, varchar, text, timestamp, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { carWashes } from './car-washes';
import { permissions } from './permissions';

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // null carWashId => global/system role template (SUPER_ADMIN, OWNER, MANAGER, STAFF, CUSTOMER)
    carWashId: uuid('car_wash_id').references(() => carWashes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('roles_global_name_idx')
      .on(table.name)
      .where(sql`${table.carWashId} is null`),
    uniqueIndex('roles_tenant_name_idx')
      .on(table.carWashId, table.name)
      .where(sql`${table.carWashId} is not null`),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('role_permissions_unique_idx').on(table.roleId, table.permissionId)],
);

/**
 * A car wash's own permission set for a global/system role (e.g. its STAFF may differ
 * from another car wash's STAFF). When a row exists for (carWashId, roleId), its
 * permissions replace the role's defaults for users of that car wash.
 */
export const roleOverrides = pgTable(
  'role_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    carWashId: uuid('car_wash_id')
      .notNull()
      .references(() => carWashes.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('role_overrides_car_wash_role_idx').on(table.carWashId, table.roleId)],
);

export const roleOverridePermissions = pgTable(
  'role_override_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    overrideId: uuid('override_id')
      .notNull()
      .references(() => roleOverrides.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('role_override_permissions_unique_idx').on(table.overrideId, table.permissionId),
  ],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
