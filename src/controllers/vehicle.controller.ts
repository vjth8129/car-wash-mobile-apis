import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess, sendList } from '../utils/api-response';
import { parsePaginationQuery } from '../utils/pagination';
import * as vehicleService from '../services/vehicle.service';
import { ForbiddenError } from '../utils/errors';

function carWashIdOf(req: Request): string {
  if (!req.user?.carWashId) throw new ForbiddenError('User is not associated with a car wash');
  return req.user.carWashId;
}

export const listVehicles = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePaginationQuery(req.query as Record<string, unknown>);
  const { search, customerId } = req.query as { search?: string; customerId?: string };
  const { rows, pagination: paginationResult } = await vehicleService.listVehicles(
    carWashIdOf(req),
    pagination,
    { search, customerId },
  );
  sendList(res, rows, paginationResult);
});

export const getVehicle = asyncHandler(async (req: Request, res: Response) => {
  const vehicle = await vehicleService.getVehicle(carWashIdOf(req), req.params.id);
  sendSuccess(res, vehicle);
});

export const createVehicle = asyncHandler(async (req: Request, res: Response) => {
  const vehicle = await vehicleService.createVehicle(carWashIdOf(req), req.body, req);
  sendSuccess(res, vehicle, 201);
});

export const updateVehicle = asyncHandler(async (req: Request, res: Response) => {
  const vehicle = await vehicleService.updateVehicle(
    carWashIdOf(req),
    req.params.id,
    req.body,
    req,
  );
  sendSuccess(res, vehicle);
});

export const deleteVehicle = asyncHandler(async (req: Request, res: Response) => {
  await vehicleService.deleteVehicle(carWashIdOf(req), req.params.id, req);
  sendSuccess(res, { message: 'Vehicle deleted successfully' });
});
