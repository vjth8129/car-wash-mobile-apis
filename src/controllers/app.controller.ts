import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess } from '../utils/api-response';
import * as appService from '../services/app.service';
import * as paymentQrService from '../services/payment-qr.service';

export const getMenu = asyncHandler(async (req: Request, res: Response) => {
  const result = await appService.getMenuForUser(req.user!);
  sendSuccess(res, result);
});

export const getConfig = asyncHandler(async (req: Request, res: Response) => {
  const config = await appService.getAppConfig(req.user?.carWashId ?? null);
  sendSuccess(res, config);
});

export const getPaymentQr = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await paymentQrService.getPaymentQr(req.user!));
});

export const setPaymentQr = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await paymentQrService.setPaymentQr(req.user!, req.body, req));
});

export const removePaymentQr = asyncHandler(async (req: Request, res: Response) => {
  await paymentQrService.removePaymentQr(req.user!, req);
  sendSuccess(res, { message: 'Payment QR removed' });
});
