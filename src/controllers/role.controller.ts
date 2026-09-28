import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess } from '../utils/api-response';
import * as roleService from '../services/role.service';

export const listRoles = asyncHandler(async (req: Request, res: Response) => {
  const roles = await roleService.listRoles(req.user!);
  sendSuccess(res, roles);
});

export const getRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await roleService.getRole(req.user!, req.params.id);
  sendSuccess(res, role);
});

export const createRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await roleService.createRole(req.user!, req.body, req);
  sendSuccess(res, role, 201);
});

export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await roleService.updateRole(req.user!, req.params.id, req.body, req);
  sendSuccess(res, role);
});

export const resetRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await roleService.resetRole(req.user!, req.params.id, req);
  sendSuccess(res, role);
});

export const deleteRole = asyncHandler(async (req: Request, res: Response) => {
  await roleService.deleteRole(req.user!, req.params.id, req);
  sendSuccess(res, { message: 'Role deleted successfully' });
});
