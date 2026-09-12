import { and, eq, ilike, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { vehicles, Vehicle, NewVehicle } from '../db/schema';

export async function findVehicleById(id: string, carWashId: string): Promise<Vehicle | undefined> {
  return db.query.vehicles.findFirst({
    where: and(eq(vehicles.id, id), eq(vehicles.carWashId, carWashId), isNull(vehicles.deletedAt)),
  });
}

export async function findVehicleByRegistration(
  registrationNumber: string,
  carWashId: string,
): Promise<Vehicle | undefined> {
  return db.query.vehicles.findFirst({
    where: and(
      eq(vehicles.registrationNumber, registrationNumber),
      eq(vehicles.carWashId, carWashId),
      isNull(vehicles.deletedAt),
    ),
  });
}

export async function createVehicle(data: NewVehicle): Promise<Vehicle> {
  const [row] = await db.insert(vehicles).values(data).returning();
  return row;
}

export async function updateVehicle(
  id: string,
  carWashId: string,
  data: Partial<NewVehicle>,
): Promise<Vehicle | undefined> {
  const [row] = await db
    .update(vehicles)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(vehicles.id, id), eq(vehicles.carWashId, carWashId)))
    .returning();
  return row;
}

export async function softDeleteVehicle(id: string, carWashId: string): Promise<void> {
  await db
    .update(vehicles)
    .set({ deletedAt: new Date() })
    .where(and(eq(vehicles.id, id), eq(vehicles.carWashId, carWashId)));
}

interface ListVehiclesOptions {
  carWashId: string;
  customerId?: string;
  search?: string;
  page: number;
  limit: number;
  offset: number;
}

export async function listVehicles(options: ListVehiclesOptions) {
  const conditions = [eq(vehicles.carWashId, options.carWashId), isNull(vehicles.deletedAt)];
  if (options.customerId) {
    conditions.push(eq(vehicles.customerId, options.customerId));
  }
  if (options.search) {
    conditions.push(ilike(vehicles.registrationNumber, `%${options.search}%`));
  }
  const where = and(...conditions);

  const [rows, totalRow] = await Promise.all([
    db.query.vehicles.findMany({
      where,
      limit: options.limit,
      offset: options.offset,
      orderBy: (v, { desc }) => [desc(v.createdAt)],
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(vehicles)
      .where(where),
  ]);

  return { rows, total: totalRow[0]?.count ?? 0 };
}
