import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, roles, carWashes, User, NewUser } from '../db/schema';

export interface UserWithRole extends User {
  role: { id: string; name: string; carWashId: string | null };
  carWash: { id: string; name: string; status: string } | null;
}

export async function findUserByUsername(username: string): Promise<UserWithRole | undefined> {
  const row = await db.query.users.findFirst({
    where: and(eq(users.username, username), isNull(users.deletedAt)),
    with: {
      role: { columns: { id: true, name: true, carWashId: true } },
      carWash: { columns: { id: true, name: true, status: true } },
    },
  });
  return row as UserWithRole | undefined;
}

export async function findUserById(id: string): Promise<UserWithRole | undefined> {
  const row = await db.query.users.findFirst({
    where: and(eq(users.id, id), isNull(users.deletedAt)),
    with: {
      role: { columns: { id: true, name: true, carWashId: true } },
      carWash: { columns: { id: true, name: true, status: true } },
    },
  });
  return row as UserWithRole | undefined;
}

export async function createUser(data: NewUser): Promise<User> {
  const [row] = await db.insert(users).values(data).returning();
  return row;
}

export async function updateUser(id: string, data: Partial<NewUser>): Promise<User | undefined> {
  const [row] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning();
  return row;
}

export async function softDeleteUser(id: string): Promise<void> {
  await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, id));
}

export async function updateLastLogin(id: string): Promise<void> {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
}

interface ListUsersOptions {
  carWashId: string | null;
  search?: string;
  status?: string;
  page: number;
  limit: number;
  offset: number;
}

export async function listUsers(options: ListUsersOptions) {
  const conditions = [isNull(users.deletedAt)];
  if (options.carWashId !== null) {
    conditions.push(eq(users.carWashId, options.carWashId));
  }
  if (options.status) {
    conditions.push(eq(users.status, options.status as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'));
  }
  if (options.search) {
    const term = `%${options.search}%`;
    conditions.push(
      or(ilike(users.name, term), ilike(users.username, term), ilike(users.email, term))!,
    );
  }
  const where = and(...conditions);

  const [rows, totalRow] = await Promise.all([
    db.query.users.findMany({
      where,
      with: {
        role: { columns: { id: true, name: true } },
        carWash: { columns: { id: true, name: true } },
      },
      limit: options.limit,
      offset: options.offset,
      orderBy: (u, { desc }) => [desc(u.createdAt)],
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(where),
  ]);

  return { rows, total: totalRow[0]?.count ?? 0 };
}

export { users, roles, carWashes };
