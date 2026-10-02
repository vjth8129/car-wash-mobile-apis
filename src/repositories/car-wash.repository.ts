import { and, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { carWashes, orders, users, CarWash, NewCarWash } from '../db/schema';

export async function findCarWashById(id: string): Promise<CarWash | undefined> {
  return db.query.carWashes.findFirst({ where: eq(carWashes.id, id) });
}

export async function findCarWashByCode(code: string): Promise<CarWash | undefined> {
  return db.query.carWashes.findFirst({ where: eq(carWashes.code, code) });
}

export async function createCarWash(data: NewCarWash): Promise<CarWash> {
  const [row] = await db.insert(carWashes).values(data).returning();
  return row;
}

export async function updateCarWash(
  id: string,
  data: Partial<NewCarWash>,
): Promise<CarWash | undefined> {
  const [row] = await db
    .update(carWashes)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(carWashes.id, id))
    .returning();
  return row;
}

export async function softDeleteCarWash(id: string): Promise<void> {
  await db
    .update(carWashes)
    .set({ status: 'INACTIVE', deletedAt: new Date() })
    .where(eq(carWashes.id, id));
}

interface ListCarWashesOptions {
  search?: string;
  status?: string;
  page: number;
  limit: number;
  offset: number;
}

export async function listCarWashes(options: ListCarWashesOptions) {
  const conditions = [];
  if (options.status) {
    conditions.push(eq(carWashes.status, options.status as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'));
  }
  if (options.search) {
    const term = `%${options.search}%`;
    conditions.push(
      or(ilike(carWashes.name, term), ilike(carWashes.code, term), ilike(carWashes.city, term))!,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRow] = await Promise.all([
    db.query.carWashes.findMany({
      where,
      limit: options.limit,
      offset: options.offset,
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(carWashes)
      .where(where ?? sql`true`),
  ]);

  const userCounts = await countUsersByCarWash(rows.map((r) => r.id));
  return {
    rows: rows.map((r) => ({ ...r, userCount: userCounts.get(r.id) ?? 0 })),
    total: totalRow[0]?.count ?? 0,
  };
}

async function countUsersByCarWash(carWashIds: string[]) {
  if (carWashIds.length === 0) return new Map<string, number>();
  const counts = await db
    .select({ carWashId: users.carWashId, count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(inArray(users.carWashId, carWashIds), isNull(users.deletedAt)))
    .groupBy(users.carWashId);
  return new Map(counts.map((c) => [c.carWashId!, c.count]));
}

/** Platform-wide numbers for the admin portal dashboard. */
export async function getPlatformStats() {
  const [washes, people, orderCounts] = await Promise.all([
    db
      .select({ status: carWashes.status, count: sql<number>`count(*)::int` })
      .from(carWashes)
      .groupBy(carWashes.status),
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${users.status} = 'ACTIVE')::int`,
      })
      .from(users)
      .where(and(isNotNull(users.carWashId), isNull(users.deletedAt))),
    db
      .select({
        today: sql<number>`count(*) filter (where ${orders.createdAt} >= date_trunc('day', now()))::int`,
        last30Days: sql<number>`count(*) filter (where ${orders.createdAt} >= now() - interval '30 days')::int`,
      })
      .from(orders),
  ]);
  const byStatus = { ACTIVE: 0, SUSPENDED: 0, INACTIVE: 0 } as Record<string, number>;
  for (const w of washes) byStatus[w.status] = w.count;
  return {
    carWashes: {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      active: byStatus.ACTIVE,
      suspended: byStatus.SUSPENDED,
      inactive: byStatus.INACTIVE,
    },
    users: people[0] ?? { total: 0, active: 0 },
    orders: orderCounts[0] ?? { today: 0, last30Days: 0 },
  };
}
