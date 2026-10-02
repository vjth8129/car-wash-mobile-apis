import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess, sendList } from '../utils/api-response';
import { parsePaginationQuery } from '../utils/pagination';
import * as userService from '../services/user.service';

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePaginationQuery(req.query as Record<string, unknown>);
  const { search, status, carWashId } = req.query as {
    search?: string;
    status?: string;
    carWashId?: string;
  };
  const { rows, pagination: paginationResult } = await userService.listUsers(
    req.user!,
    pagination,
    { search, status, carWashId },
  );
  sendList(res, rows, paginationResult);
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.getUser(req.user!, req.params.id);
  sendSuccess(res, user);
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.createUser(req.user!, req.body, req);
  sendSuccess(res, user, 201);
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateUser(req.user!, req.params.id, req.body, req);
  sendSuccess(res, user);
});

export const updateUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateUserStatus(req.user!, req.params.id, req.body.status, req);
  sendSuccess(res, user);
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  await userService.deleteUser(req.user!, req.params.id, req);
  sendSuccess(res, { message: 'User deleted successfully' });
});

export const resetUserPassword = asyncHandler(async (req: Request, res: Response) => {
  await userService.resetUserPassword(req.user!, req.params.id, req.body.newPassword, req);
  sendSuccess(res, { message: 'Password reset successfully' });
});
