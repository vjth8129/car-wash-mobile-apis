import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess } from '../utils/api-response';
import * as appService from '../services/app.service';

export const getMenu = asyncHandler(async (req: Request, res: Response) => {
  const result = await appService.getMenuForUser(req.user!);
  sendSuccess(res, result);
});

export const getConfig = asyncHandler(async (req: Request, res: Response) => {
  const config = await appService.getAppConfig(req.user?.carWashId ?? null);
  sendSuccess(res, config);
});
