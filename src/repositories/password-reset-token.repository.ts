import { and, eq, isNull } from 'drizzle-orm';
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
