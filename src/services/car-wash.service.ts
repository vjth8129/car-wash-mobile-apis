import * as carWashRepo from '../repositories/car-wash.repository';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/errors';
import { buildPagination } from '../utils/api-response';
import { PaginationQuery } from '../utils/pagination';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { AuthenticatedUser } from '../types/express';
import { SYSTEM_ROLES } from '../constants/roles';
import { Request } from 'express';

interface ListFilters {
  search?: string;
  status?: string;
}

export async function listCarWashes(pagination: PaginationQuery, filters: ListFilters) {
  const { rows, total } = await carWashRepo.listCarWashes({ ...pagination, ...filters });
  return { rows, pagination: buildPagination(pagination.page, pagination.limit, total) };
}

export async function getCarWash(id: string) {
  const carWash = await carWashRepo.findCarWashById(id);
  if (!carWash) throw new NotFoundError('Car wash not found');
  return carWash;
}

export async function createCarWash(input: any, req?: Request) {
  const existing = await carWashRepo.findCarWashByCode(input.code);
  if (existing) {
    throw new ConflictError(`A car wash with code "${input.code}" already exists`);
  }
  const carWash = await carWashRepo.createCarWash({ ...input, code: input.code.toUpperCase() });
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.CAR_WASH_CREATED,
    entityType: 'CAR_WASH',
    entityId: carWash.id,
    metadata: { name: carWash.name, code: carWash.code },
  });
  return carWash;
}

export async function updateCarWash(
  id: string,
  input: any,
  user: AuthenticatedUser,
  req?: Request,
) {
  const carWash = await carWashRepo.findCarWashById(id);
  if (!carWash) throw new NotFoundError('Car wash not found');
  if (input.status && user.roleName !== SYSTEM_ROLES.SUPER_ADMIN) {
    throw new ForbiddenError('Only a platform administrator can change a car wash status');
  }
  if (input.code && input.code.toUpperCase() !== carWash.code) {
    const existing = await carWashRepo.findCarWashByCode(input.code.toUpperCase());
    if (existing) throw new ConflictError(`A car wash with code "${input.code}" already exists`);
  }
  const updated = await carWashRepo.updateCarWash(id, {
    ...input,
    code: input.code ? input.code.toUpperCase() : undefined,
  });
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.CAR_WASH_UPDATED,
    entityType: 'CAR_WASH',
    entityId: id,
  });
  return updated;
}

export async function deleteCarWash(id: string, req?: Request) {
  const carWash = await carWashRepo.findCarWashById(id);
  if (!carWash) throw new NotFoundError('Car wash not found');
  await carWashRepo.softDeleteCarWash(id);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.CAR_WASH_DELETED,
    entityType: 'CAR_WASH',
    entityId: id,
  });
}
