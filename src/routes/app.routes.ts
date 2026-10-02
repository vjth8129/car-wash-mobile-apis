import { Router } from 'express';
import * as appController from '../controllers/app.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { optionalAuthenticate } from '../middlewares/optional-authenticate.middleware';
import { requirePermission } from '../middlewares/authorize.middleware';
import { validate } from '../middlewares/validate.middleware';
import { setPaymentQrSchema } from '../validators/payment-qr.validator';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

/**
 * @openapi
 * /app/menu:
 *   get:
 *     tags: [App]
 *     summary: Get the dynamic application menu for the current user
 *     description: >
 *       The mobile/web client never hardcodes menu items - this endpoint resolves the full
 *       nested menu tree based on the authenticated user's resolved permissions and returns
 *       only the items they are allowed to see.
 *     responses:
 *       200:
 *         description: Menu tree
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     menus:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           key: { type: string }
 *                           title: { type: string }
 *                           icon: { type: string, nullable: true }
 *                           route: { type: string, nullable: true }
 *                           permission: { type: string, nullable: true }
 *                           children: { type: array, items: {} }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/menu', authenticate, appController.getMenu);

/**
 * @openapi
 * /app/config:
 *   get:
 *     tags: [App]
 *     summary: Get dynamic app configuration (branding, currency, timezone, feature flags)
 *     description: When called with a valid access token, values are tailored to the caller's car wash; otherwise platform defaults are returned.
 *     security: []
 *     responses:
 *       200: { description: App configuration }
 */
router.get('/config', optionalAuthenticate, appController.getConfig);

/**
 * @openapi
 * /app/payment-qr:
 *   get:
 *     tags: [App]
 *     summary: The payment QR for the caller's car wash
 *     description: Any signed-in car wash user can fetch it to show a customer. Returns null when none has been uploaded.
 *     responses:
 *       200:
 *         description: Payment QR or null
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     image: { type: string, description: "data:image/...;base64,..." }
 *                     note: { type: string, nullable: true, example: "sparkle@okicici" }
 *                     updatedAt: { type: string, format: date-time }
 *   put:
 *     tags: [App]
 *     summary: Upload or replace the car wash's payment QR
 *     description: Requires CAR_WASH_UPDATE (owners by default). Always applies to the caller's own car wash.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image: { type: string, description: "PNG/JPEG/WebP data URI, up to ~560 KB" }
 *               note: { type: string, maxLength: 100, description: "Shown under the QR, e.g. the UPI ID" }
 *     responses:
 *       200: { description: Saved payment QR }
 *   delete:
 *     tags: [App]
 *     summary: Remove the car wash's payment QR
 *     description: Requires CAR_WASH_UPDATE.
 *     responses:
 *       200: { description: Removed }
 */
router.get('/payment-qr', authenticate, appController.getPaymentQr);
router.put(
  '/payment-qr',
  authenticate,
  requirePermission(PERMISSIONS.CAR_WASH_UPDATE),
  validate({ body: setPaymentQrSchema }),
  appController.setPaymentQr,
);
router.delete(
  '/payment-qr',
  authenticate,
  requirePermission(PERMISSIONS.CAR_WASH_UPDATE),
  appController.removePaymentQr,
);

export default router;
