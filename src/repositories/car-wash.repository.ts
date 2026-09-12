import { and, eq, ilike, sql } from 'drizzle-orm';
import { db } from '../db';
import { carWashes, CarWash, NewCarWash } from '../db/schema';

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
    conditions.push(ilike(carWashes.name, `%${options.search}%`));
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

  return { rows, total: totalRow[0]?.count ?? 0 };
}
