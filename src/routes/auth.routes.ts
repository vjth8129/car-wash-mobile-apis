import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { validate } from '../middlewares/validate.middleware';
import { authRateLimiter, forgotPasswordRateLimiter } from '../middlewares/rate-limit.middleware';
import {
  loginSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from '../validators/auth.validator';

const router = Router();

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Login with username and password
 *     description: Authenticates a user and returns a short-lived access token and a refresh token.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string, example: owner }
 *               password: { type: string, format: password, example: "Owner@123" }
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken: { type: string }
 *                     refreshToken: { type: string }
 *                     user:
 *                       type: object
 *                       properties:
 *                         id: { type: string, format: uuid }
 *                         username: { type: string }
 *                         name: { type: string }
 *                         role: { type: string }
 *                         carWashId: { type: string, format: uuid, nullable: true }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/login', authRateLimiter, validate({ body: loginSchema }), authController.login);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Authentication]
 *     summary: Exchange a refresh token for a new access + refresh token pair
 *     description: Implements refresh-token rotation - the presented refresh token is revoked and a new one is issued.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: New token pair issued
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/refresh', authRateLimiter, validate({ body: refreshSchema }), authController.refresh);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Authentication]
 *     summary: Revoke a refresh token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post('/logout', validate({ body: logoutSchema }), authController.logout);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Authentication]
 *     summary: Get the current authenticated user's session context
 *     description: Returns the user profile, role, resolved permissions, and car wash - used by the client to initialize its session.
 *     responses:
 *       200:
 *         description: Current user context
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/me', authenticate, authController.me);

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Request a password reset code
 *     description: Sends a 6-digit code to the user's email (logged by the server when MAIL_PROVIDER=console or, outside production, when the user has no email). Redeem it with POST /auth/reset-password. Always returns a generic success message regardless of whether the username exists, to avoid user enumeration. Rate-limited.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               username: { type: string }
 *     responses:
 *       200:
 *         description: Generic acknowledgement
 */
router.post(
  '/forgot-password',
  forgotPasswordRateLimiter,
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword,
);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Reset password using the code from /auth/forgot-password
 *     description: The code is single-use, expires after RESET_TOKEN_EXPIRES_IN and is burned after 5 wrong attempts. Outside production the dev code (DEV_RESET_CODE, default 1111) is also accepted once a code has been requested.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, code, newPassword]
 *             properties:
 *               username: { type: string }
 *               code: { type: string, example: "482913" }
 *               newPassword: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post(
  '/reset-password',
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Change your own password
 *     description: Required when login/me returns mustChangePassword=true (an admin set the password); until then other endpoints return 403 PASSWORD_CHANGE_REQUIRED. Signs out other sessions and returns a fresh token pair.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string, format: password }
 *               newPassword: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Password changed; body contains new accessToken and refreshToken
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post(
  '/change-password',
  authRateLimiter,
  authenticate,
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);

export default router;
