import { eq } from 'drizzle-orm';
import { db } from '../db';
import { permissions, rolePermissions, Permission } from '../db/schema';

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
