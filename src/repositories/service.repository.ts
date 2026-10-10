import { and, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { services, serviceRates, Service, NewService } from '../db/schema';

/** Per-vehicle-category rates, returned with every service. */
const withRates = { rates: { columns: { categoryId: true, price: true } } } as const;

export type ServiceWithRates = Service & { rates: { categoryId: string; price: string }[] };

export async function findServiceById(
  id: string,
  carWashId: string,
): Promise<ServiceWithRates | undefined> {
  return db.query.services.findFirst({
    where: and(eq(services.id, id), eq(services.carWashId, carWashId), isNull(services.deletedAt)),
    with: withRates,
  });
}

export async function findServicesByIds(
  ids: string[],
  carWashId: string,
): Promise<ServiceWithRates[]> {
  if (ids.length === 0) return [];
  return db.query.services.findMany({
    where: and(
      inArray(services.id, ids),
      eq(services.carWashId, carWashId),
      isNull(services.deletedAt),
    ),
    with: withRates,
  });
}

/** Replaces the rates for the given categories: a null price removes that category's rate. */
export async function setServiceRates(
  serviceId: string,
  rates: { categoryId: string; price: string | null }[],
  options: { replaceAll?: boolean } = {},
) {
  await db.transaction(async (tx) => {
    if (options.replaceAll) {
      await tx.delete(serviceRates).where(eq(serviceRates.serviceId, serviceId));
    } else if (rates.length > 0) {
      await tx.delete(serviceRates).where(
        and(
          eq(serviceRates.serviceId, serviceId),
          inArray(
            serviceRates.categoryId,
            rates.map((r) => r.categoryId),
          ),
        ),
      );
    }
    const rows = rates
      .filter((r): r is { categoryId: string; price: string } => r.price !== null)
      .map((r) => ({ serviceId, categoryId: r.categoryId, price: r.price }));
    if (rows.length > 0) await tx.insert(serviceRates).values(rows);
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
      with: withRates,
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
