import { Request } from 'express';
import { db } from '../db';
import { refreshTokens, passwordResetTokens, users } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  findUserByUsername,
  findUserByPhone,
  findUserById,
  updateLastLogin,
} from '../repositories/user.repository';
import { looksLikePhone, normalizePhone } from '../utils/phone';
import type { AccountIdentifier } from '../validators/auth.validator';
import { getEffectivePermissionKeys } from '../repositories/permission.repository';
import {
  createRefreshToken,
  findRefreshTokenById,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
} from '../repositories/refresh-token.repository';
import crypto from 'crypto';
import {
  createPasswordResetToken,
  findActiveResetTokenForUser,
  incrementResetTokenAttempts,
  invalidateActiveResetTokensForUser,
} from '../repositories/password-reset-token.repository';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateOpaqueToken, hashToken } from '../utils/tokens';
import { signAccessToken } from '../utils/jwt';
import { parseDurationMs } from '../utils/duration';
import { env } from '../config/env';
import { CarWashNotActiveError, UnauthorizedError, ValidationError } from '../utils/errors';
import { sendPasswordResetCodeEmail } from '../utils/mailer';
import { recordAuditLog, AUDIT_ACTIONS } from './audit-log.service';
import { logger } from '../config/logger';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

function buildRefreshTokenString(id: string, secret: string): string {
  return `${id}.${secret}`;
}

function parseRefreshTokenString(token: string): { id: string; secret: string } | null {
  const idx = token.indexOf('.');
  if (idx <= 0) return null;
  return { id: token.slice(0, idx), secret: token.slice(idx + 1) };
}

async function issueTokensForUser(
  userId: string,
  carWashId: string | null,
  roleId: string,
  roleName: string,
  req?: Request,
): Promise<AuthTokens> {
  const accessToken = signAccessToken({ sub: userId, carWashId, roleId, roleName });

  const secret = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + parseDurationMs(env.REFRESH_TOKEN_EXPIRES_IN));
  const row = await createRefreshToken({
    userId,
    tokenHash: hashToken(secret),
    expiresAt,
    userAgent: req?.headers['user-agent']?.slice(0, 250),
    ipAddress: req?.ip,
  });

  return { accessToken, refreshToken: buildRefreshTokenString(row.id, secret) };
}

function serializeUser(user: {
  id: string;
  username: string;
  phone: string | null;
  name: string;
  carWashId: string | null;
  mustChangePassword: boolean;
  role: { id: string; name: string };
}) {
  return {
    id: user.id,
    username: user.username,
    phone: user.phone,
    name: user.name,
    role: user.role.name,
    carWashId: user.carWashId,
    mustChangePassword: user.mustChangePassword,
  };
}

/** Wrong codes allowed per reset request before it is burned. */
const MAX_RESET_CODE_ATTEMPTS = 5;

/** Codes are short, so the hash is bound to the user to stop cross-account lookups. */
function hashResetCode(userId: string, code: string): string {
  return hashToken(`${userId}:${code}`);
}

function codesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Finds the account a sign-in / password-reset request refers to: by mobile number, or by
 * username for older accounts without one. A phone typed into the username field (clients
 * predating phone login) is matched as a phone too.
 */
async function findAccount({ phone, username }: AccountIdentifier) {
  if (phone) {
    const normalized = normalizePhone(phone);
    return normalized ? findUserByPhone(normalized) : undefined;
  }
  if (!username) return undefined;
  const byUsername = await findUserByUsername(username);
  if (byUsername || !looksLikePhone(username)) return byUsername;
  const normalized = normalizePhone(username);
  return normalized ? findUserByPhone(normalized) : undefined;
}

const INVALID_CREDENTIALS = 'Invalid mobile number or password';

export async function login(identifier: AccountIdentifier, password: string, req?: Request) {
  const user = await findAccount(identifier);
  if (!user) {
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }
  if (user.status !== 'ACTIVE') {
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    await recordAuditLog({
      req,
      userId: user.id,
      carWashId: user.carWashId,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: 'USER',
      entityId: user.id,
    });
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }
  // Only once the password is right do we say why the car wash can't be used.
  if (user.carWash && user.carWash.status !== 'ACTIVE') {
    throw new CarWashNotActiveError(user.carWash.status);
  }

  const tokens = await issueTokensForUser(
    user.id,
    user.carWashId,
    user.roleId,
    user.role.name,
    req,
  );
  await updateLastLogin(user.id);
  await recordAuditLog({
    req,
    userId: user.id,
    carWashId: user.carWashId,
    action: AUDIT_ACTIONS.LOGIN,
    entityType: 'USER',
    entityId: user.id,
  });

  return { ...tokens, user: serializeUser(user) };
}

export async function refreshTokensForClient(refreshToken: string, req?: Request) {
  const parsed = parseRefreshTokenString(refreshToken);
  if (!parsed) {
    throw new UnauthorizedError('Invalid refresh token');
  }
  const row = await findRefreshTokenById(parsed.id);
  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
  if (hashToken(parsed.secret) !== row.tokenHash) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  const user = await findUserById(row.userId);
  if (!user || user.status !== 'ACTIVE') {
    throw new UnauthorizedError('User account is not active');
  }
  if (user.carWash && user.carWash.status !== 'ACTIVE') {
    throw new CarWashNotActiveError(user.carWash.status);
  }

  const secret = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + parseDurationMs(env.REFRESH_TOKEN_EXPIRES_IN));

  const newTokens = await db.transaction(async (tx) => {
    const [newRow] = await tx
      .insert(refreshTokens)
      .values({
        userId: user.id,
        tokenHash: hashToken(secret),
        expiresAt,
        userAgent: req?.headers['user-agent']?.slice(0, 250),
        ipAddress: req?.ip,
      })
      .returning();
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedByTokenId: newRow.id })
      .where(eq(refreshTokens.id, row.id));
    return newRow;
  });

  const accessToken = signAccessToken({
    sub: user.id,
    carWashId: user.carWashId,
    roleId: user.roleId,
    roleName: user.role.name,
  });

  await recordAuditLog({
    req,
    userId: user.id,
    carWashId: user.carWashId,
    action: AUDIT_ACTIONS.TOKEN_REFRESHED,
    entityType: 'USER',
    entityId: user.id,
  });

  return { accessToken, refreshToken: buildRefreshTokenString(newTokens.id, secret) };
}

export async function logout(refreshToken: string, req?: Request): Promise<void> {
  const parsed = parseRefreshTokenString(refreshToken);
  if (!parsed) return;
  const row = await findRefreshTokenById(parsed.id);
  if (row && !row.revokedAt) {
    await revokeRefreshToken(row.id);
    await recordAuditLog({
      req,
      userId: row.userId,
      action: AUDIT_ACTIONS.LOGOUT,
      entityType: 'USER',
      entityId: row.userId,
    });
  }
}

export async function getCurrentUserContext(userId: string) {
  const user = await findUserById(userId);
  if (!user) {
    throw new UnauthorizedError('User no longer exists');
  }
  const permissions = await getEffectivePermissionKeys(user.roleId, user.carWashId);
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: { id: user.role.id, name: user.role.name },
    permissions,
    carWash: user.carWash ? { id: user.carWash.id, name: user.carWash.name } : null,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function forgotPassword(identifier: AccountIdentifier, req?: Request): Promise<void> {
  const user = await findAccount(identifier);
  // Always behave identically whether or not the account exists, to avoid user enumeration.
  if (!user || user.status !== 'ACTIVE') {
    logger.debug(identifier, 'Forgot-password requested for unknown/inactive account');
    return;
  }

  await invalidateActiveResetTokensForUser(user.id);

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + parseDurationMs(env.RESET_TOKEN_EXPIRES_IN));
  await createPasswordResetToken({
    userId: user.id,
    tokenHash: hashResetCode(user.id, code),
    expiresAt,
  });

  if (user.email) {
    await sendPasswordResetCodeEmail(user.email, code).catch((err) => {
      logger.error({ err }, 'Failed to send password reset code');
    });
  } else if (env.NODE_ENV !== 'production') {
    logger.info({ userId: user.id, code }, '[dev] Password reset code (user has no email on file)');
  } else {
    logger.warn({ userId: user.id }, 'Password reset requested but the user has no email on file');
  }

  await recordAuditLog({
    req,
    userId: user.id,
    carWashId: user.carWashId,
    action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
    entityType: 'USER',
    entityId: user.id,
  });
}

export async function resetPassword(
  input: AccountIdentifier & { code: string; newPassword: string },
  req?: Request,
): Promise<void> {
  const invalid = () => new ValidationError('Invalid or expired code');

  const user = await findAccount(input);
  if (!user || user.status !== 'ACTIVE') throw invalid();

  // A code must have been requested (and still be live) - this includes the dev code.
  const row = await findActiveResetTokenForUser(user.id);
  if (!row) throw invalid();

  const isDevCode = !!env.DEV_RESET_CODE && input.code === env.DEV_RESET_CODE;
  if (!isDevCode && !codesMatch(hashResetCode(user.id, input.code), row.tokenHash)) {
    const attempts = await incrementResetTokenAttempts(row.id);
    if (attempts >= MAX_RESET_CODE_ATTEMPTS) {
      await invalidateActiveResetTokensForUser(user.id);
    }
    throw invalid();
  }

  const passwordHash = await hashPassword(input.newPassword);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));
  });

  await revokeAllRefreshTokensForUser(user.id);

  await recordAuditLog({
    req,
    userId: user.id,
    carWashId: user.carWashId,
    action: AUDIT_ACTIONS.PASSWORD_RESET,
    entityType: 'USER',
    entityId: user.id,
    metadata: isDevCode ? { devCode: true } : undefined,
  });
}

/**
 * The signed-in user changes their own password (required after an admin set it).
 * Other sessions are signed out; the caller gets a fresh token pair.
 */
export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
  req?: Request,
) {
  const user = await findUserById(userId);
  if (!user) throw new UnauthorizedError('User no longer exists');

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new ValidationError('Current password is incorrect');
  }
  if (input.currentPassword === input.newPassword) {
    throw new ValidationError('Choose a password different from the current one');
  }

  const passwordHash = await hashPassword(input.newPassword);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, user.id));
  await revokeAllRefreshTokensForUser(user.id);

  await recordAuditLog({
    req,
    userId: user.id,
    carWashId: user.carWashId,
    action: AUDIT_ACTIONS.PASSWORD_RESET,
    entityType: 'USER',
    entityId: user.id,
    metadata: { selfService: true },
  });

  return issueTokensForUser(user.id, user.carWashId, user.roleId, user.role.name, req);
}
