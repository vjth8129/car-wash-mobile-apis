import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { UnauthorizedError } from '../utils/errors';
import { findUserById } from '../repositories/user.repository';
import { getPermissionKeysForRole } from '../repositories/permission.repository';
import { asyncHandler } from '../utils/async-handler';

/**
 * Verifies the JWT access token and attaches the authenticated user (with fresh,
 * DB-sourced role/permissions) to req.user. Permissions are re-resolved from the
 * database on every request rather than trusted from the token, so that role or
 * permission changes made by an admin take effect immediately instead of waiting
 * for the access token to expire.
 */
export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }
    const token = header.slice('Bearer '.length);

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }

    const user = await findUserById(payload.sub);
    if (!user) {
      throw new UnauthorizedError('User no longer exists');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedError('User account is not active');
    }
    if (user.carWashId && user.carWash === null) {
      // Tenant was deleted but user record wasn't cleaned up - treat as unauthenticated.
      throw new UnauthorizedError('Car wash account no longer exists');
    }
    if (user.carWash && user.carWash.status !== 'ACTIVE') {
      throw new UnauthorizedError('Car wash account is not active');
    }

    const permissions = await getPermissionKeysForRole(user.roleId);

    req.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      carWashId: user.carWashId,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions,
    };

    next();
  },
);
