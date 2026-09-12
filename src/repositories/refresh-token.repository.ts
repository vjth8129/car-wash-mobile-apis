import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { refreshTokens, RefreshToken, NewRefreshToken } from '../db/schema';

export async function createRefreshToken(data: NewRefreshToken): Promise<RefreshToken> {
  const [row] = await db.insert(refreshTokens).values(data).returning();
  return row;
}

export async function findRefreshTokenById(id: string): Promise<RefreshToken | undefined> {
  return db.query.refreshTokens.findFirst({ where: eq(refreshTokens.id, id) });
}

export async function revokeRefreshToken(id: string, replacedByTokenId?: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), replacedByTokenId: replacedByTokenId ?? null })
    .where(eq(refreshTokens.id, id));
}

export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
