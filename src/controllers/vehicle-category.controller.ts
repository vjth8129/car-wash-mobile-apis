import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess } from '../utils/api-response';
import * as categoryService from '../services/vehicle-category.service';

export const listVehicleCategories = asyncHandler(async (req: Request, res: Response) => {
  const rows = await categoryService.listVehicleCategories(req.query.includeInactive === 'true');
  sendSuccess(res, rows);
});

export const createVehicleCategory = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await categoryService.createVehicleCategory(req.body, req), 201);
});

export const updateVehicleCategory = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await categoryService.updateVehicleCategory(req.params.id, req.body, req));
});
