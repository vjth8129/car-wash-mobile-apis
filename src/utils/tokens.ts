import crypto from 'crypto';

/**
 * Generates a high-entropy opaque token (used for refresh tokens and password reset
 * tokens). Only the sha256 hash of this value is ever persisted - the raw value is
 * handed to the client / reset link and cannot be recovered from the database.
 */
export function generateOpaqueToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
