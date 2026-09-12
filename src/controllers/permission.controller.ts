import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { sendSuccess } from '../utils/api-response';
import { getAllPermissions } from '../repositories/permission.repository';

export const listPermissions = asyncHandler(async (_req: Request, res: Response) => {
  const permissions = await getAllPermissions();
  sendSuccess(
    res,
    permissions.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      module: p.module,
    })),
  );
});
