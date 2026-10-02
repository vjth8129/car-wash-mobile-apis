import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import { env } from '../config/env';
import { verifyAccessToken } from '../utils/jwt';

const userIdCache = new WeakMap<Request, string | null>();

/**
 * The user id from a valid access token, or null. Only used to pick a rate-limit bucket -
 * authentication itself still happens in the authenticate middleware.
 */
function rateLimitUserId(req: Request): string | null {
  if (userIdCache.has(req)) return userIdCache.get(req) ?? null;
  let userId: string | null = null;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(header.slice(7));
      if (payload.type === 'access') userId = payload.sub;
    } catch {
      // invalid/expired token: fall back to the per-IP bucket
    }
  }
  userIdCache.set(req, userId);
  return userId;
}

/**
 * Authenticated requests are limited per user (RATE_LIMIT_USER_MAX), so staff sharing one
 * public IP don't exhaust each other's quota; anonymous requests are limited per IP.
 */
export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: (req) => (rateLimitUserId(req) ? env.RATE_LIMIT_USER_MAX : env.RATE_LIMIT_MAX),
  keyGenerator: (req) => {
    const userId = rateLimitUserId(req);
    return userId ? `user:${userId}` : `ip:${req.ip}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' },
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many authentication attempts, please try again later',
    },
  },
});

export const forgotPasswordRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.FORGOT_PASSWORD_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.phone ?? req.body?.username ?? '')}`,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many password reset requests, please try again later',
    },
  },
});
