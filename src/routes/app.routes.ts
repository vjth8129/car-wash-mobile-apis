import { Router } from 'express';
import * as appController from '../controllers/app.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { optionalAuthenticate } from '../middlewares/optional-authenticate.middleware';

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

export default router;
