import { Router } from 'express';
import * as permissionController from '../controllers/permission.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { requirePermission } from '../middlewares/authorize.middleware';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();

/**
 * @openapi
 * /permissions:
 *   get:
 *     tags: [Permissions]
 *     summary: List all available system permissions
 *     description: Used by role-management UIs to present the full permission catalog when building/editing roles.
 *     responses:
 *       200: { description: List of permissions }
 */
router.get(
  '/',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSIONS_VIEW),
  permissionController.listPermissions,
);

export default router;
