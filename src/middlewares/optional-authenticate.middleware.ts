import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { findUserById } from '../repositories/user.repository';
import { getPermissionKeysForRole } from '../repositories/permission.repository';
import { asyncHandler } from '../utils/async-handler';

/** Like `authenticate`, but proceeds as an anonymous request instead of rejecting when no/invalid token is present. */
export const optionalAuthenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return next();
    }
    try {
      const payload = verifyAccessToken(header.slice('Bearer '.length));
      const user = await findUserById(payload.sub);
      if (user && user.status === 'ACTIVE') {
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
      }
    } catch {
      // Invalid/expired token on an optional-auth route: treat as anonymous rather than failing.
    }
    next();
  },
);
