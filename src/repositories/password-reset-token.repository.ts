import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { passwordResetTokens, PasswordResetToken, NewPasswordResetToken } from '../db/schema';

export async function createPasswordResetToken(
  data: NewPasswordResetToken,
): Promise<PasswordResetToken> {
  const [row] = await db.insert(passwordResetTokens).values(data).returning();
  return row;
}

export async function findValidPasswordResetTokenByHash(
  tokenHash: string,
): Promise<PasswordResetToken | undefined> {
  return db.query.passwordResetTokens.findFirst({
    where: and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)),
  });
}

/** The user's newest unused, unexpired reset request. */
export async function findActiveResetTokenForUser(
  userId: string,
): Promise<PasswordResetToken | undefined> {
  return db.query.passwordResetTokens.findFirst({
    where: and(
      eq(passwordResetTokens.userId, userId),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, new Date()),
    ),
    orderBy: [desc(passwordResetTokens.createdAt)],
  });
}

/** Records a wrong code; returns the new attempt count. */
export async function incrementResetTokenAttempts(id: string): Promise<number> {
  const [row] = await db
    .update(passwordResetTokens)
    .set({ attempts: sql`${passwordResetTokens.attempts} + 1` })
    .where(eq(passwordResetTokens.id, id))
    .returning({ attempts: passwordResetTokens.attempts });
  return row?.attempts ?? 0;
}

export async function markPasswordResetTokenUsed(id: string): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, id));
}

export async function invalidateActiveResetTokensForUser(userId: string): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
}
