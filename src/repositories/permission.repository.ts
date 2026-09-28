import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import {
  permissions,
  rolePermissions,
  roleOverrides,
  roleOverridePermissions,
  Permission,
} from '../db/schema';

export type PermissionSummary = Pick<Permission, 'id' | 'key' | 'name'>;

export async function getAllPermissions(): Promise<Permission[]> {
  return db.query.permissions.findMany({ orderBy: (p, { asc }) => [asc(p.module), asc(p.key)] });
}

export async function getPermissionKeysForRole(roleId: string): Promise<string[]> {
  const rows = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((r) => r.key);
}

/**
 * A car wash's customised permission set for a (global) role, or null when it uses the
 * role's defaults.
 */
export async function findRoleOverridePermissions(
  carWashId: string,
  roleId: string,
): Promise<PermissionSummary[] | null> {
  const override = await db.query.roleOverrides.findFirst({
    where: and(eq(roleOverrides.carWashId, carWashId), eq(roleOverrides.roleId, roleId)),
  });
  if (!override) return null;
  return db
    .select({ id: permissions.id, key: permissions.key, name: permissions.name })
    .from(roleOverridePermissions)
    .innerJoin(permissions, eq(roleOverridePermissions.permissionId, permissions.id))
    .where(eq(roleOverridePermissions.overrideId, override.id));
}

/**
 * Permission keys a user actually holds: their car wash's override for the role if one
 * exists, otherwise the role's own permissions.
 */
export async function getEffectivePermissionKeys(
  roleId: string,
  carWashId: string | null,
): Promise<string[]> {
  if (carWashId) {
    const override = await findRoleOverridePermissions(carWashId, roleId);
    if (override) return override.map((p) => p.key);
  }
  return getPermissionKeysForRole(roleId);
}

export async function findPermissionsByKeys(keys: string[]): Promise<Permission[]> {
  if (keys.length === 0) return [];
  return db.query.permissions.findMany({
    where: (p, { inArray }) => inArray(p.key, keys),
  });
}

export async function findPermissionsByIds(ids: string[]): Promise<Permission[]> {
  if (ids.length === 0) return [];
  return db.query.permissions.findMany({
    where: (p, { inArray }) => inArray(p.id, ids),
  });
}
