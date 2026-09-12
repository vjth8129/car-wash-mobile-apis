import { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import { SYSTEM_ROLES } from '../constants/roles';

/** Generic guard: throws if req.user is missing (defense in depth alongside `authenticate`). */
export function authorize() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    next();
  };
}

/** Requires the authenticated user to hold ALL of the given permission keys. */
export function requirePermission(...permissionKeys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const missing = permissionKeys.filter((key) => !req.user!.permissions.includes(key));
    if (missing.length > 0) {
      throw new ForbiddenError(`Missing required permission(s): ${missing.join(', ')}`);
    }
    next();
  };
}

/** Requires the authenticated user to hold at least one of the given permission keys. */
export function requireAnyPermission(...permissionKeys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const hasAny = permissionKeys.some((key) => req.user!.permissions.includes(key));
    if (!hasAny) {
      throw new ForbiddenError(`Requires one of permission(s): ${permissionKeys.join(', ')}`);
    }
    next();
  };
}

/** Requires the authenticated user's role name to be one of the given role names. */
export function requireRole(...roleNames: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    if (!roleNames.includes(req.user.roleName)) {
      throw new ForbiddenError(`Requires role: ${roleNames.join(' or ')}`);
    }
    next();
  };
}

/** Convenience guard for platform-level (SUPER_ADMIN) only endpoints. */
export function requireSuperAdmin() {
  return requireRole(SYSTEM_ROLES.SUPER_ADMIN);
}

/**
 * Enforces tenant isolation: the resolved carWashId for the requested resource (usually
 * req.params.carWashId, or the authenticated user's own carWashId when the resource is
 * implicitly tenant-scoped) must match the authenticated user's carWashId. SUPER_ADMIN
 * bypasses this check since they operate at the platform level across all tenants.
 */
export function requireCarWashAccess(resolveCarWashId?: (req: Request) => string | undefined) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    if (req.user.roleName === SYSTEM_ROLES.SUPER_ADMIN) {
      return next();
    }
    const targetCarWashId = resolveCarWashId ? resolveCarWashId(req) : req.params.carWashId;
    if (!req.user.carWashId) {
      throw new ForbiddenError('User is not associated with a car wash');
    }
    if (targetCarWashId && targetCarWashId !== req.user.carWashId) {
      throw new ForbiddenError('You do not have access to this car wash');
    }
    next();
  };
}
