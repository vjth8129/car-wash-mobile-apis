import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  vehicleCategories,
  VehicleCategory,
  NewVehicleCategory,
  DEFAULT_VEHICLE_CATEGORY_CODE,
} from '../db/schema';

export async function listVehicleCategories(options: { activeOnly?: boolean } = {}) {
  return db.query.vehicleCategories.findMany({
    where: options.activeOnly ? eq(vehicleCategories.status, 'ACTIVE') : undefined,
    orderBy: [asc(vehicleCategories.sortOrder), asc(vehicleCategories.name)],
  });
}

export async function findVehicleCategoryById(id: string): Promise<VehicleCategory | undefined> {
  return db.query.vehicleCategories.findFirst({ where: eq(vehicleCategories.id, id) });
}

export async function findVehicleCategoryByCode(
  code: string,
): Promise<VehicleCategory | undefined> {
  return db.query.vehicleCategories.findFirst({ where: eq(vehicleCategories.code, code) });
}

export async function findVehicleCategoriesByIds(ids: string[]): Promise<VehicleCategory[]> {
  if (ids.length === 0) return [];
  return db.query.vehicleCategories.findMany({ where: inArray(vehicleCategories.id, ids) });
}

export async function findDefaultVehicleCategory(): Promise<VehicleCategory | undefined> {
  return findVehicleCategoryByCode(DEFAULT_VEHICLE_CATEGORY_CODE);
}

export async function createVehicleCategory(data: NewVehicleCategory): Promise<VehicleCategory> {
  const [row] = await db.insert(vehicleCategories).values(data).returning();
  return row;
}

export async function updateVehicleCategory(
  id: string,
  data: Partial<NewVehicleCategory>,
): Promise<VehicleCategory | undefined> {
  const [row] = await db
    .update(vehicleCategories)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(vehicleCategories.id, id)))
    .returning();
  return row;
}
