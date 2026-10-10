import * as vehicleRepo from '../repositories/vehicle.repository';
import { findCustomerById } from '../repositories/customer.repository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPagination } from '../utils/api-response';
import { PaginationQuery } from '../utils/pagination';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { resolveCategory } from './vehicle-category.service';
import { Request } from 'express';

export async function listVehicles(
  carWashId: string,
  pagination: PaginationQuery,
  filters: { search?: string; customerId?: string },
) {
  const { rows, total } = await vehicleRepo.listVehicles({ carWashId, ...pagination, ...filters });
  return { rows, pagination: buildPagination(pagination.page, pagination.limit, total) };
}

export async function getVehicle(carWashId: string, id: string) {
  const vehicle = await vehicleRepo.findVehicleById(id, carWashId);
  if (!vehicle) throw new NotFoundError('Vehicle not found');
  return vehicle;
}

async function assertCustomerBelongsToCarWash(customerId: string, carWashId: string) {
  const customer = await findCustomerById(customerId, carWashId);
  if (!customer) {
    throw new ValidationError('Customer does not belong to your car wash');
  }
  return customer;
}

export async function createVehicle(carWashId: string, input: any, req?: Request) {
  await assertCustomerBelongsToCarWash(input.customerId, carWashId);

  const existing = await vehicleRepo.findVehicleByRegistration(input.registrationNumber, carWashId);
  if (existing) {
    throw new ConflictError(
      `A vehicle with registration "${input.registrationNumber}" already exists`,
    );
  }

  const category = await resolveCategory({ categoryId: input.categoryId });
  const vehicle = await vehicleRepo.createVehicle({ ...input, categoryId: category.id, carWashId });
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.VEHICLE_CREATED,
    entityType: 'VEHICLE',
    entityId: vehicle.id,
    metadata: { registrationNumber: vehicle.registrationNumber },
  });
  return vehicle;
}

export async function updateVehicle(carWashId: string, id: string, input: any, req?: Request) {
  const existing = await vehicleRepo.findVehicleById(id, carWashId);
  if (!existing) throw new NotFoundError('Vehicle not found');

  if (input.categoryId) await resolveCategory({ categoryId: input.categoryId });
  const updated = await vehicleRepo.updateVehicle(id, carWashId, input);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.VEHICLE_UPDATED,
    entityType: 'VEHICLE',
    entityId: id,
  });
  return updated;
}

export async function deleteVehicle(carWashId: string, id: string, req?: Request) {
  const existing = await vehicleRepo.findVehicleById(id, carWashId);
  if (!existing) throw new NotFoundError('Vehicle not found');
  await vehicleRepo.softDeleteVehicle(id, carWashId);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.VEHICLE_DELETED,
    entityType: 'VEHICLE',
    entityId: id,
  });
}
