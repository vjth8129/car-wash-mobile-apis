import * as carWashRepo from '../repositories/car-wash.repository';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/errors';
import { buildPagination } from '../utils/api-response';
import { PaginationQuery } from '../utils/pagination';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { AuthenticatedUser } from '../types/express';
import { SYSTEM_ROLES } from '../constants/roles';
import { Request } from 'express';
import { db } from '../db';
import { carWashes, users } from '../db/schema';
import { findRoleByName } from '../repositories/role.repository';
import { findUserByUsername } from '../repositories/user.repository';
import { hashPassword } from '../utils/password';
import { assertPhoneAvailable } from './user.service';

import type { z } from 'zod';
import type { onboardCarWashSchema } from '../validators/car-wash.validator';

interface ListFilters {
  search?: string;
  status?: string;
}

export async function listCarWashes(pagination: PaginationQuery, filters: ListFilters) {
  const { rows, total } = await carWashRepo.listCarWashes({ ...pagination, ...filters });
  return { rows, pagination: buildPagination(pagination.page, pagination.limit, total) };
}

export async function getCarWash(id: string) {
  const carWash = await carWashRepo.findCarWashById(id);
  if (!carWash) throw new NotFoundError('Car wash not found');
  return carWash;
}

export function getPlatformStats() {
  return carWashRepo.getPlatformStats();
}

/**
 * Onboards a tenant. With `owner`, the car wash and its first OWNER account are created
 * together (one transaction), so the new car wash is immediately usable: the owner signs in
 * with their mobile number, is asked to pick their own password, and can add their staff.
 */
export async function createCarWash(input: z.infer<typeof onboardCarWashSchema>, req?: Request) {
  const { owner, ...carWashInput } = input;
  const code = carWashInput.code.toUpperCase();
  const existing = await carWashRepo.findCarWashByCode(code);
  if (existing) {
    throw new ConflictError(`A car wash with code "${input.code}" already exists`);
  }

  let ownerRoleId: string | undefined;
  let passwordHash: string | undefined;
  if (owner) {
    if (await findUserByUsername(owner.username)) {
      throw new ConflictError(`Username "${owner.username}" is already taken`);
    }
    await assertPhoneAvailable(owner.phone);
    const ownerRole = await findRoleByName(SYSTEM_ROLES.OWNER, null);
    if (!ownerRole) throw new NotFoundError('OWNER role not found');
    ownerRoleId = ownerRole.id;
    passwordHash = await hashPassword(owner.password);
  }

  const { carWash, ownerUser } = await db.transaction(async (tx) => {
    const [carWash] = await tx
      .insert(carWashes)
      .values({ ...carWashInput, code })
      .returning();
    if (!owner) return { carWash, ownerUser: undefined };
    const [ownerUser] = await tx
      .insert(users)
      .values({
        carWashId: carWash.id,
        roleId: ownerRoleId!,
        username: owner.username,
        phone: owner.phone,
        email: owner.email,
        name: owner.name,
        passwordHash: passwordHash!,
        // The platform admin chose this password; the owner replaces it on first sign-in.
        mustChangePassword: true,
      })
      .returning();
    return { carWash, ownerUser };
  });

  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.CAR_WASH_CREATED,
    entityType: 'CAR_WASH',
    entityId: carWash.id,
    metadata: { name: carWash.name, code: carWash.code },
  });
  if (!ownerUser) return carWash;

  await recordAuditLog({
    req,
    carWashId: carWash.id,
    action: AUDIT_ACTIONS.USER_CREATED,
    entityType: 'USER',
    entityId: ownerUser.id,
    metadata: { username: ownerUser.username, onboarding: true },
  });
  return {
    ...carWash,
    owner: {
      id: ownerUser.id,
      name: ownerUser.name,
      username: ownerUser.username,
      phone: ownerUser.phone,
    },
  };
}

export async function updateCarWash(
  id: string,
  input: any,
  user: AuthenticatedUser,
  req?: Request,
) {
  const carWash = await carWashRepo.findCarWashById(id);
  if (!carWash) throw new NotFoundError('Car wash not found');
  if (input.status && user.roleName !== SYSTEM_ROLES.SUPER_ADMIN) {
    throw new ForbiddenError('Only a platform administrator can change a car wash status');
  }
  if (input.code && input.code.toUpperCase() !== carWash.code) {
    const existing = await carWashRepo.findCarWashByCode(input.code.toUpperCase());
    if (existing) throw new ConflictError(`A car wash with code "${input.code}" already exists`);
  }
  const updated = await carWashRepo.updateCarWash(id, {
    ...input,
    code: input.code ? input.code.toUpperCase() : undefined,
    // Reactivating a deleted (deactivated) car wash brings it back.
    ...(input.status === 'ACTIVE' ? { deletedAt: null } : {}),
  });
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.CAR_WASH_UPDATED,
    entityType: 'CAR_WASH',
    entityId: id,
  });
  return updated;
}

export async function deleteCarWash(id: string, req?: Request) {
  const carWash = await carWashRepo.findCarWashById(id);
  if (!carWash) throw new NotFoundError('Car wash not found');
  await carWashRepo.softDeleteCarWash(id);
  await recordAuditLog({
    req,
    action: AUDIT_ACTIONS.CAR_WASH_DELETED,
    entityType: 'CAR_WASH',
    entityId: id,
  });
}
