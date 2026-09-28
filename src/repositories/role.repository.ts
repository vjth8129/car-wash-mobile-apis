import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  roles,
  rolePermissions,
  roleOverrides,
  roleOverridePermissions,
  permissions,
  Role,
  NewRole,
} from '../db/schema';
import type { PermissionSummary } from './permission.repository';

export async function findRoleById(id: string) {
  return db.query.roles.findFirst({
    where: eq(roles.id, id),
    with: { rolePermissions: { with: { permission: true } } },
  });
}

export async function findRoleByName(name: string, carWashId: string | null) {
  return db.query.roles.findFirst({
    where: carWashId
      ? and(eq(roles.name, name), eq(roles.carWashId, carWashId))
      : and(eq(roles.name, name), isNull(roles.carWashId)),
  });
}

/** Roles visible to a car wash: its own custom roles plus global system role templates. */
export async function listRolesForCarWash(carWashId: string | null) {
  const where = carWashId ? or(eq(roles.carWashId, carWashId), isNull(roles.carWashId)) : undefined;
  return db.query.roles.findMany({
    where,
    with: { rolePermissions: { with: { permission: true } } },
    orderBy: (r, { asc }) => [asc(r.name)],
  });
}

export async function createRole(data: NewRole): Promise<Role> {
  const [row] = await db.insert(roles).values(data).returning();
  return row;
}

export async function updateRole(id: string, data: Partial<NewRole>): Promise<Role | undefined> {
  const [row] = await db
    .update(roles)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(roles.id, id))
    .returning();
  return row;
}

export async function deleteRole(id: string): Promise<void> {
  await db.delete(roles).where(eq(roles.id, id));
}

export async function setRolePermissions(roleId: string, permissionIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (permissionIds.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(permissionIds.map((permissionId) => ({ roleId, permissionId })));
    }
  });
}

/** All of a car wash's role overrides, keyed by role id. */
export async function listRoleOverridesForCarWash(
  carWashId: string,
): Promise<Map<string, PermissionSummary[]>> {
  const rows = await db
    .select({
      roleId: roleOverrides.roleId,
      permissionId: permissions.id,
      key: permissions.key,
      name: permissions.name,
    })
    .from(roleOverrides)
    .leftJoin(roleOverridePermissions, eq(roleOverridePermissions.overrideId, roleOverrides.id))
    .leftJoin(permissions, eq(roleOverridePermissions.permissionId, permissions.id))
    .where(eq(roleOverrides.carWashId, carWashId));

  const map = new Map<string, PermissionSummary[]>();
  for (const row of rows) {
    const list = map.get(row.roleId) ?? [];
    // leftJoin: an override with zero permissions still yields one row with nulls
    if (row.permissionId && row.key && row.name) {
      list.push({ id: row.permissionId, key: row.key, name: row.name });
    }
    map.set(row.roleId, list);
  }
  return map;
}

/** Replace a car wash's permission set for a role (creating the override if needed). */
export async function setRoleOverride(
  carWashId: string,
  roleId: string,
  permissionIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const [override] = await tx
      .insert(roleOverrides)
      .values({ carWashId, roleId })
      .onConflictDoUpdate({
        target: [roleOverrides.carWashId, roleOverrides.roleId],
        set: { updatedAt: new Date() },
      })
      .returning();
    await tx
      .delete(roleOverridePermissions)
      .where(eq(roleOverridePermissions.overrideId, override.id));
    if (permissionIds.length > 0) {
      await tx
        .insert(roleOverridePermissions)
        .values(permissionIds.map((permissionId) => ({ overrideId: override.id, permissionId })));
    }
  });
}

/** Drop a car wash's override so the role goes back to its default permissions. */
export async function deleteRoleOverride(carWashId: string, roleId: string): Promise<void> {
  await db
    .delete(roleOverrides)
    .where(and(eq(roleOverrides.carWashId, carWashId), eq(roleOverrides.roleId, roleId)));
}

export async function countUsersWithRole(roleId: string): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from users where role_id = ${roleId} and deleted_at is null`,
  );
  return result.rows[0]?.count ?? 0;
}

export { permissions };
