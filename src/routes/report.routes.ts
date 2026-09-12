import { Router } from 'express';
import * as reportController from '../controllers/report.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { requirePermission } from '../middlewares/authorize.middleware';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /reports/summary:
 *   get:
 *     tags: [Reports]
 *     summary: Operational summary for the current user's car wash
 *     responses:
 *       200: { description: Car wash summary stats }
 */
router.get('/summary', requirePermission(PERMISSIONS.REPORTS_VIEW), reportController.getSummary);

/**
 * @openapi
 * /reports/platform:
 *   get:
 *     tags: [Reports]
 *     summary: Platform-wide statistics (SUPER_ADMIN only)
 *     responses:
 *       200: { description: Platform-wide stats }
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.get(
  '/platform',
  requirePermission(PERMISSIONS.REPORTS_VIEW),
  reportController.getPlatformStats,
);

export default router;
