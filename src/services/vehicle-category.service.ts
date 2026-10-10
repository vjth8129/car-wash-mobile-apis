import { Request } from 'express';
import * as categoryRepo from '../repositories/vehicle-category.repository';
import { DEFAULT_VEHICLE_CATEGORY_CODE, VehicleCategory } from '../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';

/** "Mini Bus" -> "MINI_BUS". */
export function codeFromName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

export async function listVehicleCategories(includeInactive: boolean) {
  return categoryRepo.listVehicleCategories({ activeOnly: !includeInactive });
}

export async function createVehicleCategory(input: any, req?: Request) {
  const code = codeFromName(input.code ?? input.name);
  if (!code) throw new ValidationError('Enter a name with at least one letter or digit');
  if (await categoryRepo.findVehicleCategoryByCode(code)) {
    throw new ConflictError(`A vehicle type with code "${code}" already exists`);
  }
  const category = await categoryRepo.createVehicleCategory({
    code,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    sortOrder: input.sortOrder ?? 0,
  });
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.VEHICLE_CATEGORY_CREATED,
    entityType: 'VEHICLE_CATEGORY',
    entityId: category.id,
    metadata: { code, name: category.name },
  });
  return category;
}

export async function updateVehicleCategory(id: string, input: any, req?: Request) {
  const existing = await categoryRepo.findVehicleCategoryById(id);
  if (!existing) throw new NotFoundError('Vehicle type not found');
  if (input.status === 'INACTIVE' && existing.code === DEFAULT_VEHICLE_CATEGORY_CODE) {
    throw new ValidationError('Private is the default vehicle type and can’t be deactivated');
  }
  const updated = await categoryRepo.updateVehicleCategory(id, {
    name: input.name?.trim(),
    description: input.description === undefined ? undefined : input.description?.trim() || null,
    status: input.status,
    sortOrder: input.sortOrder,
  });
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.VEHICLE_CATEGORY_UPDATED,
    entityType: 'VEHICLE_CATEGORY',
    entityId: id,
    metadata: input,
  });
  return updated;
}

/**
 * Resolves the category a booking/vehicle uses: an explicit id, else a legacy PRIVATE/TAXI code
 * (older app builds), else the fallback (e.g. the vehicle's own), else Private.
 */
export async function resolveCategory(options: {
  categoryId?: string | null;
  code?: string | null;
  fallbackId?: string | null;
}): Promise<VehicleCategory> {
  if (options.categoryId) {
    const category = await categoryRepo.findVehicleCategoryById(options.categoryId);
    if (!category) throw new ValidationError('Unknown vehicle type');
    if (category.status !== 'ACTIVE')
      throw new ValidationError(`${category.name} is no longer offered`);
    return category;
  }
  if (options.code) {
    const category = await categoryRepo.findVehicleCategoryByCode(options.code);
    if (category) return category;
  }
  if (options.fallbackId) {
    const category = await categoryRepo.findVehicleCategoryById(options.fallbackId);
    if (category && category.status === 'ACTIVE') return category;
  }
  const fallback = await categoryRepo.findDefaultVehicleCategory();
  if (!fallback) throw new NotFoundError('The default vehicle type is missing');
  return fallback;
}
