import * as serviceRepo from '../repositories/service.repository';
import { ConflictError, NotFoundError } from '../utils/errors';
import { buildPagination } from '../utils/api-response';
import { PaginationQuery } from '../utils/pagination';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { Request } from 'express';

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

  const service = await serviceRepo.createService({
    ...input,
    price: String(input.price),
    carWashId,
  });
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

  const updated = await serviceRepo.updateService(id, carWashId, {
    ...input,
    price: input.price !== undefined ? String(input.price) : undefined,
  });
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
