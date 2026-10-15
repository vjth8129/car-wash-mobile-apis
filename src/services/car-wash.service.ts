import * as carWashRepo from '../repositories/car-wash.repository';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/errors';
import { buildPagination } from '../utils/api-response';
import { PaginationQuery } from '../utils/pagination';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { AuthenticatedUser } from '../types/express';
import { SYSTEM_ROLES } from '../constants/roles';
import { Request } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { carWashes, users } from '../db/schema';
import { findRoleByName } from '../repositories/role.repository';
import { findUserByUsername } from '../repositories/user.repository';
import { hashPassword } from '../utils/password';
import { assertPhoneAvailable } from './user.service';

import type { z } from 'zod';
import type { onboardCarWashSchema, selfSignupSchema } from '../validators/car-wash.validator';

interface ListFilters {
  search?: string;
  status?: string;
}

export async function listCarWashes(pagination: PaginationQuery, filters: ListFilters) {
  const { rows, total } = await carWashRepo.listCarWashes({ ...pagination, ...filters });
  return { rows, pagination: buildPagination(pagination.page, pagination.limit, total) };
}

export async function getCarWash(id: string, user?: AuthenticatedUser) {
  const carWash = await carWashRepo.findCarWashById(id);
  if (!carWash) throw new NotFoundError('Car wash not found');
  // Platform admins reviewing a sign-up also need to see who the owner is.
  if (user?.roleName === SYSTEM_ROLES.SUPER_ADMIN) {
    return { ...carWash, owners: await carWashRepo.findCarWashOwners(id) };
  }
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

  const { carWash: carWashFields, address } = carWashRepo.splitAddress(carWashInput);
  const { carWash: created, ownerUser } = await db.transaction(async (tx) => {
    const [carWash] = await tx
      .insert(carWashes)
      .values({ ...carWashFields, code })
      .returning();
    await carWashRepo.upsertCarWashAddress(carWash.id, address, tx);
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
  const carWash = (await carWashRepo.findCarWashById(created.id))!;

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

export const SIGNUP_PENDING_MESSAGE =
  'Thanks for signing up! Your details are under review. Your account will be activated within 2 hours.';

const CODE_ATTEMPTS = 20;

/** A unique code from the name: "Aqua Shine Car Wash" -> "AQUASHINE", then AQUASHINE2, ... */
async function generateCarWashCode(name: string): Promise<string> {
  const base =
    name
      .toUpperCase()
      .replace(/\b(CAR|WASH|THE|AND)\b/g, '')
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12) || 'CARWASH';
  for (let i = 1; i <= CODE_ATTEMPTS; i++) {
    const code = i === 1 ? base : `${base}${i}`;
    if (!(await carWashRepo.findCarWashByCode(code))) return code;
  }
  return `${base}${crypto.randomInt(1000, 1_000_000)}`;
}

/** A unique username from the mobile number: +919876543210 -> "9876543210". */
async function generateOwnerUsername(phone: string): Promise<string> {
  const base = phone.replace(/\D/g, '').slice(-10);
  for (let i = 1; i <= CODE_ATTEMPTS; i++) {
    const username = i === 1 ? base : `${base}-${i}`;
    if (!(await findUserByUsername(username))) return username;
  }
  return `${base}-${crypto.randomInt(1000, 1_000_000)}`;
}

/**
 * An owner signs their car wash up from the app. The car wash and its OWNER account are created
 * together, but the car wash is PENDING: nobody can sign in until a platform admin reviews the
 * details (GSTIN, location) and activates it. The owner chose their own password, so unlike an
 * admin onboarding they aren't asked to change it.
 */
export async function selfSignup(input: z.infer<typeof selfSignupSchema>, req?: Request) {
  const { owner, ...carWashInput } = input;
  await assertPhoneAvailable(owner.phone);
  const ownerRole = await findRoleByName(SYSTEM_ROLES.OWNER, null);
  if (!ownerRole) throw new NotFoundError('OWNER role not found');
  const [code, username, passwordHash] = await Promise.all([
    generateCarWashCode(carWashInput.name),
    generateOwnerUsername(owner.phone),
    hashPassword(owner.password),
  ]);

  const { carWash: carWashFields, address } = carWashRepo.splitAddress(carWashInput);
  const { carWash, ownerUser } = await db.transaction(async (tx) => {
    const [carWash] = await tx
      .insert(carWashes)
      .values({ ...carWashFields, code, status: 'PENDING', source: 'SELF_SIGNUP' })
      .returning();
    await carWashRepo.upsertCarWashAddress(carWash.id, address, tx);
    const [ownerUser] = await tx
      .insert(users)
      .values({
        carWashId: carWash.id,
        roleId: ownerRole.id,
        username,
        phone: owner.phone,
        email: owner.email,
        name: owner.name,
        passwordHash,
      })
      .returning();
    return { carWash, ownerUser };
  });

  await recordAuditLog({
    req,
    userId: ownerUser.id,
    carWashId: carWash.id,
    action: AUDIT_ACTIONS.CAR_WASH_SELF_SIGNUP,
    entityType: 'CAR_WASH',
    entityId: carWash.id,
    metadata: { name: carWash.name, code: carWash.code, gstNumber: carWash.gstNumber },
  });

  return {
    carWash: { id: carWash.id, name: carWash.name, code: carWash.code, status: carWash.status },
    owner: { name: ownerUser.name, phone: ownerUser.phone },
    message: SIGNUP_PENDING_MESSAGE,
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
  const reviewed = carWash.status === 'PENDING' && input.status && input.status !== 'PENDING';
  await recordAuditLog({
    req,
    action: reviewed
      ? input.status === 'ACTIVE'
        ? AUDIT_ACTIONS.CAR_WASH_APPROVED
        : AUDIT_ACTIONS.CAR_WASH_REJECTED
      : AUDIT_ACTIONS.CAR_WASH_UPDATED,
    entityType: 'CAR_WASH',
    entityId: id,
    metadata: input.status ? { from: carWash.status, to: input.status } : undefined,
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
