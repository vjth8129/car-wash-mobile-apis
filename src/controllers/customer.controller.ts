import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess, sendList } from '../utils/api-response';
import { parsePaginationQuery } from '../utils/pagination';
import * as customerService from '../services/customer.service';
import { ForbiddenError } from '../utils/errors';

function carWashIdOf(req: Request): string {
  if (!req.user?.carWashId) throw new ForbiddenError('User is not associated with a car wash');
  return req.user.carWashId;
}

export const listCustomers = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePaginationQuery(req.query as Record<string, unknown>);
  const { search, status } = req.query as { search?: string; status?: string };
  const { rows, pagination: paginationResult } = await customerService.listCustomers(
    carWashIdOf(req),
    pagination,
    { search, status },
  );
  sendList(res, rows, paginationResult);
});

export const getCustomer = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.getCustomer(carWashIdOf(req), req.params.id);
  sendSuccess(res, customer);
});

export const createCustomer = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.createCustomer(carWashIdOf(req), req.body, req);
  sendSuccess(res, customer, 201);
});

export const updateCustomer = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.updateCustomer(
    carWashIdOf(req),
    req.params.id,
    req.body,
    req,
  );
  sendSuccess(res, customer);
});

export const deleteCustomer = asyncHandler(async (req: Request, res: Response) => {
  await customerService.deleteCustomer(carWashIdOf(req), req.params.id, req);
  sendSuccess(res, { message: 'Customer deleted successfully' });
});
