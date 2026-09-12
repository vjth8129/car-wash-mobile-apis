import { Request } from 'express';
import { db } from '../db';
import { refreshTokens, passwordResetTokens, users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { findUserByUsername, findUserById, updateLastLogin } from '../repositories/user.repository';
import { getPermissionKeysForRole } from '../repositories/permission.repository';
import {
  createRefreshToken,
  findRefreshTokenById,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
} from '../repositories/refresh-token.repository';
import {
  createPasswordResetToken,
  findValidPasswordResetTokenByHash,
  invalidateActiveResetTokensForUser,
} from '../repositories/password-reset-token.repository';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateOpaqueToken, hashToken } from '../utils/tokens';
import { signAccessToken } from '../utils/jwt';
import { parseDurationMs } from '../utils/duration';
import { env } from '../config/env';
import { UnauthorizedError, ValidationError } from '../utils/errors';
import { sendPasswordResetEmail } from '../utils/mailer';
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
  name: string;
  carWashId: string | null;
  role: { id: string; name: string };
}) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role.name,
    carWashId: user.carWashId,
  };
}

export async function login(username: string, password: string, req?: Request) {
  const user = await findUserByUsername(username);
  if (!user) {
    throw new UnauthorizedError('Invalid username or password');
  }
  if (user.status !== 'ACTIVE') {
    throw new UnauthorizedError('Invalid username or password');
  }
  if (user.carWash && user.carWash.status !== 'ACTIVE') {
    throw new UnauthorizedError('Invalid username or password');
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
    throw new UnauthorizedError('Invalid username or password');
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
  const permissions = await getPermissionKeysForRole(user.roleId);
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: { id: user.role.id, name: user.role.name },
    permissions,
    carWash: user.carWash ? { id: user.carWash.id, name: user.carWash.name } : null,
  };
}

export async function forgotPassword(username: string, req?: Request): Promise<void> {
  const user = await findUserByUsername(username);
  // Always behave identically whether or not the username exists, to avoid user enumeration.
  if (!user || user.status !== 'ACTIVE') {
    logger.debug({ username }, 'Forgot-password requested for unknown/inactive username');
    return;
  }

  await invalidateActiveResetTokensForUser(user.id);

  const secret = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + parseDurationMs(env.RESET_TOKEN_EXPIRES_IN));
  const row = await createPasswordResetToken({
    userId: user.id,
    tokenHash: hashToken(secret),
    expiresAt,
  });
  const resetToken = buildRefreshTokenString(row.id, secret);
  const resetLink = `${env.APP_PUBLIC_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;

  if (user.email) {
    await sendPasswordResetEmail(user.email, resetLink).catch((err) => {
      logger.error({ err }, 'Failed to send password reset email');
    });
  } else {
    logger.info(
      { userId: user.id, resetLink },
      '[dev] Password reset link (user has no email on file)',
    );
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
  token: string,
  newPassword: string,
  req?: Request,
): Promise<void> {
  const parsed = parseRefreshTokenString(token);
  if (!parsed) {
    throw new ValidationError('Invalid or expired reset token');
  }
  const row = await findValidPasswordResetTokenByHash(hashToken(parsed.secret));
  if (!row || row.id !== parsed.id || row.expiresAt.getTime() < Date.now()) {
    throw new ValidationError('Invalid or expired reset token');
  }

  const passwordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, row.userId));
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));
  });

  await revokeAllRefreshTokensForUser(row.userId);

  await recordAuditLog({
    req,
    userId: row.userId,
    action: AUDIT_ACTIONS.PASSWORD_RESET,
    entityType: 'USER',
    entityId: row.userId,
  });
}
