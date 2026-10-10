import * as serviceRepo from '../repositories/service.repository';
import * as categoryRepo from '../repositories/vehicle-category.repository';
import { TAXI_VEHICLE_CATEGORY_CODE } from '../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPagination } from '../utils/api-response';
import { PaginationQuery } from '../utils/pagination';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { Request } from 'express';

function toNumericOrNull(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

type RateInput = { categoryId: string; price: number | null };

/**
 * Works out which service_rates rows to write. `rates` (current clients) lists a price per
 * vehicle category; older clients only send `taxiPrice`, which maps to the Taxi category.
 * Returns null when the request doesn't touch rates.
 */
async function ratesFromInput(input: {
  rates?: RateInput[];
  taxiPrice?: number | null;
}): Promise<{ categoryId: string; price: string | null }[] | null> {
  if (input.rates !== undefined) {
    const ids = [...new Set(input.rates.map((r) => r.categoryId))];
    const found = await categoryRepo.findVehicleCategoriesByIds(ids);
    if (found.length !== ids.length) throw new ValidationError('Unknown vehicle type in rates');
    return input.rates.map((r) => ({ categoryId: r.categoryId, price: toNumericOrNull(r.price) }));
  }
  if (input.taxiPrice !== undefined) {
    const taxi = await categoryRepo.findVehicleCategoryByCode(TAXI_VEHICLE_CATEGORY_CODE);
    return taxi ? [{ categoryId: taxi.id, price: toNumericOrNull(input.taxiPrice) }] : null;
  }
  return null;
}

/** services.taxi_price mirrors the Taxi rate so older app builds keep showing it. */
async function taxiPriceFromRates(rates: { categoryId: string; price: string | null }[]) {
  const taxi = await categoryRepo.findVehicleCategoryByCode(TAXI_VEHICLE_CATEGORY_CODE);
  const rate = taxi ? rates.find((r) => r.categoryId === taxi.id) : undefined;
  return rate ? rate.price : undefined;
}

export async function listServices(
  carWashId: string,
  pagination: PaginationQuery,
  filters: { search?: string; status?: string },
) {
  const { rows, total } = await serviceRepo.listServices({ carWashId, ...pagination, ...filters });
  return { rows, pagination: buildPagination(pagination.page, pagination.limit, total) };
}

export async function getService(carWashId: string, id: string) {
  const service = await serviceRepo.findServiceById(id, carWashId);
  if (!service) throw new NotFoundError('Service not found');
  return service;
}

export async function createService(carWashId: string, input: any, req?: Request) {
  const existing = await serviceRepo.findServiceByName(input.name, carWashId);
  if (existing) throw new ConflictError(`A service named "${input.name}" already exists`);

  const { rates: _rates, ...fields } = input;
  const rates = (await ratesFromInput(input)) ?? [];
  const created = await serviceRepo.createService({
    ...fields,
    price: String(input.price),
    taxiPrice: (await taxiPriceFromRates(rates)) ?? null,
    carWashId,
  });
  await serviceRepo.setServiceRates(created.id, rates, { replaceAll: true });
  const service = (await serviceRepo.findServiceById(created.id, carWashId))!;
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.SERVICE_CREATED,
    entityType: 'SERVICE',
    entityId: service.id,
    metadata: { name: service.name },
  });
  return service;
}

export async function updateService(carWashId: string, id: string, input: any, req?: Request) {
  const existing = await serviceRepo.findServiceById(id, carWashId);
  if (!existing) throw new NotFoundError('Service not found');

  const { rates: _rates, ...fields } = input;
  const rates = await ratesFromInput(input);
  if (rates)
    await serviceRepo.setServiceRates(id, rates, { replaceAll: input.rates !== undefined });
  const taxiPrice = rates ? await taxiPriceFromRates(rates) : undefined;
  await serviceRepo.updateService(id, carWashId, {
    ...fields,
    price: input.price !== undefined ? String(input.price) : undefined,
    // A full rates list without Taxi clears the Taxi rate.
    taxiPrice: taxiPrice !== undefined ? taxiPrice : input.rates !== undefined ? null : undefined,
  });
  const updated = await serviceRepo.findServiceById(id, carWashId);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.SERVICE_UPDATED,
    entityType: 'SERVICE',
    entityId: id,
  });
  return updated;
}

export async function deleteService(carWashId: string, id: string, req?: Request) {
  const existing = await serviceRepo.findServiceById(id, carWashId);
  if (!existing) throw new NotFoundError('Service not found');
  await serviceRepo.softDeleteService(id, carWashId);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.SERVICE_DELETED,
    entityType: 'SERVICE',
    entityId: id,
  });
}
