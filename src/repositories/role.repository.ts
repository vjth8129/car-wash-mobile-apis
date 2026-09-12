import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { roles, rolePermissions, permissions, Role, NewRole } from '../db/schema';

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

export async function countUsersWithRole(roleId: string): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from users where role_id = ${roleId} and deleted_at is null`,
  );
  return result.rows[0]?.count ?? 0;
}

export { permissions };
