import { and, eq, ilike, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { services, Service, NewService } from '../db/schema';

export async function findServiceById(id: string, carWashId: string): Promise<Service | undefined> {
  return db.query.services.findFirst({
    where: and(eq(services.id, id), eq(services.carWashId, carWashId), isNull(services.deletedAt)),
  });
}

export async function findServiceByName(
  name: string,
  carWashId: string,
): Promise<Service | undefined> {
  return db.query.services.findFirst({
    where: and(
      eq(services.name, name),
      eq(services.carWashId, carWashId),
      isNull(services.deletedAt),
    ),
  });
}

export async function createService(data: NewService): Promise<Service> {
  const [row] = await db.insert(services).values(data).returning();
  return row;
}

export async function updateService(
  id: string,
  carWashId: string,
  data: Partial<NewService>,
): Promise<Service | undefined> {
  const [row] = await db
    .update(services)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(services.id, id), eq(services.carWashId, carWashId)))
    .returning();
  return row;
}

export async function softDeleteService(id: string, carWashId: string): Promise<void> {
  await db
    .update(services)
    .set({ deletedAt: new Date(), status: 'INACTIVE' })
    .where(and(eq(services.id, id), eq(services.carWashId, carWashId)));
}

interface ListServicesOptions {
  carWashId: string;
  search?: string;
  status?: string;
  page: number;
  limit: number;
  offset: number;
}

export async function listServices(options: ListServicesOptions) {
  const conditions = [eq(services.carWashId, options.carWashId), isNull(services.deletedAt)];
  if (options.status) {
    conditions.push(eq(services.status, options.status as 'ACTIVE' | 'INACTIVE'));
  }
  if (options.search) {
    conditions.push(ilike(services.name, `%${options.search}%`));
  }
  const where = and(...conditions);

  const [rows, totalRow] = await Promise.all([
    db.query.services.findMany({
      where,
      limit: options.limit,
      offset: options.offset,
      orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.name)],
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(services)
      .where(where),
  ]);

  return { rows, total: totalRow[0]?.count ?? 0 };
}
