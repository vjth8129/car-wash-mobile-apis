import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess, sendList } from '../utils/api-response';
import { parsePaginationQuery } from '../utils/pagination';
import * as carWashService from '../services/car-wash.service';

export const listCarWashes = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePaginationQuery(req.query as Record<string, unknown>);
  const { search, status } = req.query as { search?: string; status?: string };
  const { rows, pagination: paginationResult } = await carWashService.listCarWashes(pagination, {
    search,
    status,
  });
  sendList(res, rows, paginationResult);
});

export const getPlatformStats = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await carWashService.getPlatformStats());
});

export const getCarWash = asyncHandler(async (req: Request, res: Response) => {
  const carWash = await carWashService.getCarWash(req.params.id, req.user);
  sendSuccess(res, carWash);
});

export const createCarWash = asyncHandler(async (req: Request, res: Response) => {
  const carWash = await carWashService.createCarWash(req.body, req);
  sendSuccess(res, carWash, 201);
});

export const updateCarWash = asyncHandler(async (req: Request, res: Response) => {
  const carWash = await carWashService.updateCarWash(req.params.id, req.body, req.user!, req);
  sendSuccess(res, carWash);
});

export const deleteCarWash = asyncHandler(async (req: Request, res: Response) => {
  await carWashService.deleteCarWash(req.params.id, req);
  sendSuccess(res, { message: 'Car wash deactivated successfully' });
});

export const selfSignup = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await carWashService.selfSignup(req.body, req), 201);
});
