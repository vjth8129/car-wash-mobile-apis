import * as customerRepo from '../repositories/customer.repository';
import { ConflictError, NotFoundError } from '../utils/errors';
import { buildPagination } from '../utils/api-response';
import { PaginationQuery } from '../utils/pagination';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { Request } from 'express';

export async function listCustomers(
  carWashId: string,
  pagination: PaginationQuery,
  filters: { search?: string; status?: string },
) {
  const { rows, total } = await customerRepo.listCustomers({
    carWashId,
    ...pagination,
    ...filters,
  });
  return { rows, pagination: buildPagination(pagination.page, pagination.limit, total) };
}

export async function getCustomer(carWashId: string, id: string) {
  const customer = await customerRepo.findCustomerById(id, carWashId);
  if (!customer) throw new NotFoundError('Customer not found');
  return customer;
}

export async function createCustomer(carWashId: string, input: any, req?: Request) {
  const existing = await customerRepo.findCustomerByPhone(input.phone, carWashId);
  if (existing) throw new ConflictError(`A customer with phone "${input.phone}" already exists`);

  const customer = await customerRepo.createCustomer({ ...input, carWashId });
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.CUSTOMER_CREATED,
    entityType: 'CUSTOMER',
    entityId: customer.id,
    metadata: { name: customer.name },
  });
  return customer;
}

export async function updateCustomer(carWashId: string, id: string, input: any, req?: Request) {
  const existing = await customerRepo.findCustomerById(id, carWashId);
  if (!existing) throw new NotFoundError('Customer not found');

  const updated = await customerRepo.updateCustomer(id, carWashId, input);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.CUSTOMER_UPDATED,
    entityType: 'CUSTOMER',
    entityId: id,
  });
  return updated;
}

export async function deleteCustomer(carWashId: string, id: string, req?: Request) {
  const existing = await customerRepo.findCustomerById(id, carWashId);
  if (!existing) throw new NotFoundError('Customer not found');
  await customerRepo.softDeleteCustomer(id, carWashId);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.CUSTOMER_DELETED,
    entityType: 'CUSTOMER',
    entityId: id,
  });
}
