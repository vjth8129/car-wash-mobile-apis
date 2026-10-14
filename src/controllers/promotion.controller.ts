import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendList, sendSuccess } from '../utils/api-response';
import { parsePaginationQuery } from '../utils/pagination';
import * as promotionService from '../services/promotion.service';
import { ForbiddenError } from '../utils/errors';
import type { PromotionStatus } from '../db/schema';

function carWashIdOf(req: Request): string {
  if (!req.user?.carWashId) throw new ForbiddenError('User is not associated with a car wash');
  return req.user.carWashId;
}

export const listPromotions = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePaginationQuery(req.query as Record<string, unknown>);
  const { status } = req.query as { status?: PromotionStatus };
  const { rows, pagination: result } = await promotionService.listPromotions(
    carWashIdOf(req),
    pagination,
    { status },
  );
  sendList(res, rows, result);
});

export const getPromotion = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await promotionService.getPromotion(carWashIdOf(req), req.params.id));
});

export const createPromotion = asyncHandler(async (req: Request, res: Response) => {
  const created = await promotionService.createPromotion(carWashIdOf(req), req.user!.id, req.body);
  sendSuccess(res, await promotionService.getPromotion(carWashIdOf(req), created.id), 201);
});

export const cancelPromotion = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await promotionService.cancelPromotion(carWashIdOf(req), req.params.id));
});
