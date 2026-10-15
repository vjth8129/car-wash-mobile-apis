import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  JWT_RESET_SECRET: z.string().min(1, 'JWT_RESET_SECRET is required'),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  /** How long a forgot-password code stays valid. */
  RESET_TOKEN_EXPIRES_IN: z.string().default('30m'),
  /**
   * A fixed code accepted by /auth/reset-password (after a code was requested) so testers
   * don't need email. Defaults to 1111 outside production; empty disables it. Setting it
   * in production lets anyone who can request a code reset any account - testing only.
   */
  DEV_RESET_CODE: z.string().optional(),
  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z.string().default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  /** Per-IP limit for unauthenticated requests. */
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  /** Per-user limit for authenticated requests (many staff can share one IP on a shop's Wi-Fi). */
  RATE_LIMIT_USER_MAX: z.coerce.number().default(1000),
  /** Per-IP limit for login / refresh / reset-password / change-password. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(20),
  FORGOT_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().default(5),
  /** Per-IP car wash self sign-ups per hour. */
  SIGNUP_RATE_LIMIT_MAX: z.coerce.number().default(5),
  MAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  MAIL_FROM: z.string().default('no-reply@carwash.local'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  APP_PUBLIC_URL: z.string().default('http://localhost:3000'),
  /** Promotion messages: "console" logs them (nothing is delivered); a real SMS/WhatsApp provider plugs in here. */
  MESSAGE_PROVIDER: z.enum(['console']).default('console'),
  /** How often scheduled promotions are checked for (ms); 0 turns the sender off. */
  PROMOTION_POLL_MS: z.coerce.number().default(30000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  DEV_RESET_CODE:
    parsed.data.DEV_RESET_CODE ?? (parsed.data.NODE_ENV === 'production' ? '' : '1111'),
};
export type Env = typeof env;
