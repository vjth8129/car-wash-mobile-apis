import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { customers, Customer, NewCustomer } from '../db/schema';

export async function findCustomerById(
  id: string,
  carWashId: string,
): Promise<Customer | undefined> {
  return db.query.customers.findFirst({
    where: and(
      eq(customers.id, id),
      eq(customers.carWashId, carWashId),
      isNull(customers.deletedAt),
    ),
  });
}

export async function findCustomerByPhone(
  phone: string,
  carWashId: string,
): Promise<Customer | undefined> {
  return db.query.customers.findFirst({
    where: and(
      eq(customers.phone, phone),
      eq(customers.carWashId, carWashId),
      isNull(customers.deletedAt),
    ),
  });
}

export async function createCustomer(data: NewCustomer): Promise<Customer> {
  const [row] = await db.insert(customers).values(data).returning();
  return row;
}

export async function updateCustomer(
  id: string,
  carWashId: string,
  data: Partial<NewCustomer>,
): Promise<Customer | undefined> {
  const [row] = await db
    .update(customers)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(customers.id, id), eq(customers.carWashId, carWashId)))
    .returning();
  return row;
}

export async function softDeleteCustomer(id: string, carWashId: string): Promise<void> {
  await db
    .update(customers)
    .set({ deletedAt: new Date(), status: 'INACTIVE' })
    .where(and(eq(customers.id, id), eq(customers.carWashId, carWashId)));
}

interface ListCustomersOptions {
  carWashId: string;
  search?: string;
  status?: string;
  page: number;
  limit: number;
  offset: number;
}

export async function listCustomers(options: ListCustomersOptions) {
  const conditions = [eq(customers.carWashId, options.carWashId), isNull(customers.deletedAt)];
  if (options.status) {
    conditions.push(eq(customers.status, options.status as 'ACTIVE' | 'INACTIVE'));
  }
  if (options.search) {
    const term = `%${options.search}%`;
    conditions.push(or(ilike(customers.name, term), ilike(customers.phone, term))!);
  }
  const where = and(...conditions);

  const [rows, totalRow] = await Promise.all([
    db.query.customers.findMany({
      where,
      limit: options.limit,
      offset: options.offset,
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(customers)
      .where(where),
  ]);

  return { rows, total: totalRow[0]?.count ?? 0 };
}
