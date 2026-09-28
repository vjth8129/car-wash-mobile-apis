import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess } from '../utils/api-response';
import * as authService from '../services/auth.service';
import { UnauthorizedError } from '../utils/errors';

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body;
  const result = await authService.login(username, password, req);
  sendSuccess(res, result);
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  const result = await authService.refreshTokensForClient(refreshToken, req);
  sendSuccess(res, result);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken, req);
  sendSuccess(res, { message: 'Logged out successfully' });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const context = await authService.getCurrentUserContext(req.user.id);
  sendSuccess(res, context);
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { username } = req.body;
  await authService.forgotPassword(username, req);
  sendSuccess(res, {
    message: 'If an account with that username exists, a reset code has been sent.',
  });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { username, code, newPassword } = req.body;
  await authService.resetPassword({ username, code, newPassword }, req);
  sendSuccess(res, { message: 'Password has been reset successfully' });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const tokens = await authService.changePassword(req.user.id, req.body, req);
  sendSuccess(res, { message: 'Password changed successfully', ...tokens });
});
