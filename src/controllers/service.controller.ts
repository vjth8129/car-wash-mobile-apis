import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess, sendList } from '../utils/api-response';
import { parsePaginationQuery } from '../utils/pagination';
import * as serviceService from '../services/service.service';
import { ForbiddenError } from '../utils/errors';

function carWashIdOf(req: Request): string {
  if (!req.user?.carWashId) throw new ForbiddenError('User is not associated with a car wash');
  return req.user.carWashId;
}

export const listServices = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePaginationQuery(req.query as Record<string, unknown>);
  const { search, status } = req.query as { search?: string; status?: string };
  const { rows, pagination: paginationResult } = await serviceService.listServices(
    carWashIdOf(req),
    pagination,
    { search, status },
  );
  sendList(res, rows, paginationResult);
});

export const getService = asyncHandler(async (req: Request, res: Response) => {
  const service = await serviceService.getService(carWashIdOf(req), req.params.id);
  sendSuccess(res, service);
});

export const createService = asyncHandler(async (req: Request, res: Response) => {
  const service = await serviceService.createService(carWashIdOf(req), req.body, req);
  sendSuccess(res, service, 201);
});

export const updateService = asyncHandler(async (req: Request, res: Response) => {
  const service = await serviceService.updateService(
    carWashIdOf(req),
    req.params.id,
    req.body,
    req,
  );
  sendSuccess(res, service);
});

export const deleteService = asyncHandler(async (req: Request, res: Response) => {
  await serviceService.deleteService(carWashIdOf(req), req.params.id, req);
  sendSuccess(res, { message: 'Service deleted successfully' });
});
