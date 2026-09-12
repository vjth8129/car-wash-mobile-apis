import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess } from '../utils/api-response';
import { getCarWashSummary, getPlatformSummary } from '../repositories/report.repository';
import { ForbiddenError } from '../utils/errors';
import { SYSTEM_ROLES } from '../constants/roles';

export const getSummary = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.carWashId) throw new ForbiddenError('User is not associated with a car wash');
  const summary = await getCarWashSummary(req.user.carWashId);
  sendSuccess(res, summary);
});

export const getPlatformStats = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.roleName !== SYSTEM_ROLES.SUPER_ADMIN) {
    throw new ForbiddenError('Only a platform administrator can view platform-wide statistics');
  }
  const summary = await getPlatformSummary();
  sendSuccess(res, summary);
});
