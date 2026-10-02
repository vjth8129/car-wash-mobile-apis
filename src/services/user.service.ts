import * as userRepo from '../repositories/user.repository';
import * as roleRepo from '../repositories/role.repository';
import { revokeAllRefreshTokensForUser } from '../repositories/refresh-token.repository';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/errors';
import { hashPassword } from '../utils/password';
import { getEffectivePermissionKeys } from '../repositories/permission.repository';
import { buildPagination } from '../utils/api-response';
import { PaginationQuery } from '../utils/pagination';
import { AuthenticatedUser } from '../types/express';
import { SYSTEM_ROLES } from '../constants/roles';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { Request } from 'express';
import { findCarWashById } from '../repositories/car-wash.repository';

function isSuperAdmin(user: AuthenticatedUser): boolean {
  return user.roleName === SYSTEM_ROLES.SUPER_ADMIN;
}

function serializeUser(user: any) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

async function assertCanAssignRole(
  actingUser: AuthenticatedUser,
  roleId: string,
  targetCarWashId: string | null = actingUser.carWashId,
) {
  const role = await roleRepo.findRoleById(roleId);
  if (!role) throw new NotFoundError('Role not found');

  if (role.name === SYSTEM_ROLES.SUPER_ADMIN && !isSuperAdmin(actingUser)) {
    throw new ForbiddenError('Only a platform administrator can assign the SUPER_ADMIN role');
  }
  // A platform admin works across car washes: the role must fit the user's car wash.
  if (isSuperAdmin(actingUser)) {
    if ((role.name === SYSTEM_ROLES.SUPER_ADMIN) !== (targetCarWashId === null)) {
      throw new ForbiddenError(
        'SUPER_ADMIN is only for platform users, and platform users must be SUPER_ADMIN',
      );
    }
    if (role.carWashId !== null && role.carWashId !== targetCarWashId) {
      throw new ForbiddenError('That role belongs to a different car wash');
    }
  }

  if (!isSuperAdmin(actingUser)) {
    if (role.carWashId !== null && role.carWashId !== actingUser.carWashId) {
      throw new ForbiddenError('You cannot assign a role belonging to another car wash');
    }
    // What the role grants in the acting user's car wash (their override, if any).
    const rolePermissionKeys = await getEffectivePermissionKeys(role.id, actingUser.carWashId);
    const notOwned = rolePermissionKeys.filter(
      (key: string) => !actingUser.permissions.includes(key),
    );
    if (notOwned.length > 0) {
      throw new ForbiddenError(
        `Cannot assign a role with permissions you do not hold: ${notOwned.join(', ')}`,
      );
    }
  }
  return role;
}

/** Phone numbers are the sign-in identifier, so they must be unique across every car wash. */
export async function assertPhoneAvailable(phone: string, exceptUserId?: string) {
  const existing = await userRepo.findUserByPhone(phone);
  if (existing && existing.id !== exceptUserId) {
    throw new ConflictError('This mobile number is already registered to another user');
  }
}

function assertSameTenant(actingUser: AuthenticatedUser, targetCarWashId: string | null) {
  if (isSuperAdmin(actingUser)) return;
  if (targetCarWashId !== actingUser.carWashId) {
    throw new ForbiddenError('You do not have access to this user');
  }
}

export async function listUsers(
  actingUser: AuthenticatedUser,
  pagination: PaginationQuery,
  filters: { search?: string; status?: string; carWashId?: string },
) {
  const { carWashId: requestedCarWashId, ...rest } = filters;
  // Tenant users always see their own car wash; platform admins may pick one (or see all).
  const carWashId = isSuperAdmin(actingUser) ? (requestedCarWashId ?? null) : actingUser.carWashId;
  const { rows, total } = await userRepo.listUsers({ carWashId, ...pagination, ...rest });
  return {
    rows: rows.map(serializeUser),
    pagination: buildPagination(pagination.page, pagination.limit, total),
  };
}

export async function getUser(actingUser: AuthenticatedUser, id: string) {
  const user = await userRepo.findUserById(id);
  if (!user) throw new NotFoundError('User not found');
  assertSameTenant(actingUser, user.carWashId);
  return serializeUser(user);
}

export async function createUser(
  actingUser: AuthenticatedUser,
  input: {
    username: string;
    password: string;
    name: string;
    email?: string;
    phone: string;
    roleId: string;
    carWashId?: string;
  },
  req?: Request,
) {
  if (!isSuperAdmin(actingUser) && !actingUser.carWashId) {
    throw new ForbiddenError('User is not associated with a car wash');
  }
  // carWashId is derived from the acting user's own session - never trusted from client
  // input - so a created user is automatically scoped to the creator's tenant. Only a
  // platform admin (who has no tenant) may name the car wash to add the user to.
  const carWashId = isSuperAdmin(actingUser) ? (input.carWashId ?? null) : actingUser.carWashId;
  if (carWashId && isSuperAdmin(actingUser) && !(await findCarWashById(carWashId))) {
    throw new NotFoundError('Car wash not found');
  }

  await assertCanAssignRole(actingUser, input.roleId, carWashId);

  const existing = await userRepo.findUserByUsername(input.username);
  if (existing) {
    throw new ConflictError(`Username "${input.username}" is already taken`);
  }
  await assertPhoneAvailable(input.phone);

  const passwordHash = await hashPassword(input.password);

  const user = await userRepo.createUser({
    username: input.username,
    passwordHash,
    name: input.name,
    email: input.email,
    phone: input.phone,
    roleId: input.roleId,
    carWashId,
    // The admin chose this password, so the user must pick their own on first sign-in.
    mustChangePassword: true,
  });

  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.USER_CREATED,
    entityType: 'USER',
    entityId: user.id,
    metadata: { username: user.username },
  });

  return getUser(actingUser, user.id);
}

export async function updateUser(
  actingUser: AuthenticatedUser,
  id: string,
  input: { name?: string; email?: string | null; phone?: string; roleId?: string },
  req?: Request,
) {
  const user = await userRepo.findUserById(id);
  if (!user) throw new NotFoundError('User not found');
  assertSameTenant(actingUser, user.carWashId);

  if (input.roleId) {
    await assertCanAssignRole(actingUser, input.roleId, user.carWashId);
  }
  if (input.phone) {
    await assertPhoneAvailable(input.phone, id);
  }

  await userRepo.updateUser(id, input);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.USER_UPDATED,
    entityType: 'USER',
    entityId: id,
  });
  return getUser(actingUser, id);
}

export async function updateUserStatus(
  actingUser: AuthenticatedUser,
  id: string,
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  req?: Request,
) {
  const user = await userRepo.findUserById(id);
  if (!user) throw new NotFoundError('User not found');
  assertSameTenant(actingUser, user.carWashId);
  if (user.role.name === SYSTEM_ROLES.SUPER_ADMIN && !isSuperAdmin(actingUser)) {
    throw new ForbiddenError('Cannot modify a platform administrator');
  }
  if (user.id === actingUser.id) {
    throw new ForbiddenError('You cannot change your own account status');
  }

  await userRepo.updateUser(id, { status });
  if (status !== 'ACTIVE') {
    await revokeAllRefreshTokensForUser(id);
  }
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
    entityType: 'USER',
    entityId: id,
    metadata: { status },
  });
  return getUser(actingUser, id);
}

export async function deleteUser(actingUser: AuthenticatedUser, id: string, req?: Request) {
  const user = await userRepo.findUserById(id);
  if (!user) throw new NotFoundError('User not found');
  assertSameTenant(actingUser, user.carWashId);
  if (user.role.name === SYSTEM_ROLES.SUPER_ADMIN && !isSuperAdmin(actingUser)) {
    throw new ForbiddenError('Cannot delete a platform administrator');
  }
  if (user.id === actingUser.id) {
    throw new ForbiddenError('You cannot delete your own account');
  }

  await userRepo.softDeleteUser(id);
  await revokeAllRefreshTokensForUser(id);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.USER_DELETED,
    entityType: 'USER',
    entityId: id,
  });
}

export async function resetUserPassword(
  actingUser: AuthenticatedUser,
  id: string,
  newPassword: string,
  req?: Request,
) {
  const user = await userRepo.findUserById(id);
  if (!user) throw new NotFoundError('User not found');
  assertSameTenant(actingUser, user.carWashId);
  if (
    user.role.name === SYSTEM_ROLES.SUPER_ADMIN &&
    !isSuperAdmin(actingUser) &&
    user.id !== actingUser.id
  ) {
    throw new ForbiddenError('Cannot reset the password of a platform administrator');
  }

  const passwordHash = await hashPassword(newPassword);
  // Someone else set it -> the user must change it at next sign-in.
  await userRepo.updateUser(id, { passwordHash, mustChangePassword: user.id !== actingUser.id });
  await revokeAllRefreshTokensForUser(id);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.PASSWORD_RESET,
    entityType: 'USER',
    entityId: id,
  });
}
