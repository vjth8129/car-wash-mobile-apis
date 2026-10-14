import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess } from '../utils/api-response';
import {
  getCarWashSummary,
  getPlatformSummary,
  getSalesReport,
  getCustomerAudience,
} from '../repositories/report.repository';
import { findCarWashById } from '../repositories/car-wash.repository';
import type {
  AudienceQuery,
  SalesExportQuery,
  SalesReportQuery,
} from '../validators/report.validator';
import { createExportLink, renderExport } from '../services/sales-export.service';
import { ForbiddenError } from '../utils/errors';
import { SYSTEM_ROLES } from '../constants/roles';

export const getSummary = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.carWashId) throw new ForbiddenError('User is not associated with a car wash');
  const summary = await getCarWashSummary(req.user.carWashId);
  sendSuccess(res, summary);
});

export const getSales = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.carWashId) throw new ForbiddenError('User is not associated with a car wash');
  const carWash = await findCarWashById(req.user.carWashId);
  const query = req.query as unknown as SalesReportQuery;
  const report = await getSalesReport({
    ...query,
    carWashId: req.user.carWashId,
    timezone: carWash?.timezone ?? 'Asia/Kolkata',
  });
  sendSuccess(res, report);
});

/** The customers behind a slice of sales: who a promotion can be sent to. */
export const getAudience = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.carWashId) throw new ForbiddenError('User is not associated with a car wash');
  const carWash = await findCarWashById(req.user.carWashId);
  const query = req.query as unknown as AudienceQuery;
  const audience = await getCustomerAudience({
    ...query,
    carWashId: req.user.carWashId,
    timezone: carWash?.timezone ?? 'Asia/Kolkata',
  });
  sendSuccess(res, audience);
});

/** A short-lived link the app opens to download the sales report as PDF or Excel. */
export const createSalesExportLink = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.carWashId) throw new ForbiddenError('User is not associated with a car wash');
  sendSuccess(
    res,
    createExportLink(req.user.carWashId, req.user.id, req.body as SalesExportQuery),
    201,
  );
});

/** The file itself; authorised by the link's token, since a browser download can't send headers. */
export const downloadSalesExport = asyncHandler(async (req: Request, res: Response) => {
  const file = await renderExport(String(req.query.token));
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.body);
});

export const getPlatformStats = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.roleName !== SYSTEM_ROLES.SUPER_ADMIN) {
    throw new ForbiddenError('Only a platform administrator can view platform-wide statistics');
  }
  const summary = await getPlatformSummary();
  sendSuccess(res, summary);
});
