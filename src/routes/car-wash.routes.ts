import { Router } from 'express';
import * as carWashController from '../controllers/car-wash.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import {
  requirePermission,
  requireCarWashAccess,
  requireSuperAdmin,
} from '../middlewares/authorize.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  onboardCarWashSchema,
  updateCarWashSchema,
  carWashIdParamSchema,
  listCarWashesQuerySchema,
} from '../validators/car-wash.validator';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /car-washes:
 *   get:
 *     tags: [Car Washes]
 *     summary: List all car washes (platform-level)
 *     description: Only platform administrators (SUPER_ADMIN, via CAR_WASH_VIEW) may list the global car wash directory.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ACTIVE, INACTIVE, SUSPENDED] }
 *     responses:
 *       200: { description: List of car washes }
 *   post:
 *     tags: [Car Washes]
 *     summary: Onboard a new car wash (tenant), optionally with its first owner
 *     description: With `owner`, the car wash and an OWNER account are created together. The owner signs in with their mobile number and must change the given password on first sign-in.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name: { type: string }
 *               code: { type: string, example: SPARKLE001 }
 *               owner:
 *                 type: object
 *                 required: [name, phone, username, password]
 *                 properties:
 *                   name: { type: string }
 *                   phone: { type: string, example: "+919000000201" }
 *                   username: { type: string }
 *                   password: { type: string, format: password }
 *                   email: { type: string, format: email }
 *     responses:
 *       201: { description: Car wash created }
 */
// Listing the global directory and creating tenants are platform-admin-only:
// permission checks alone are not enough here since even a scoped CAR_WASH_VIEW
// permission must never let a tenant user enumerate every other tenant.
router.get(
  '/',
  requireSuperAdmin(),
  requirePermission(PERMISSIONS.CAR_WASH_VIEW),
  validate({ query: listCarWashesQuerySchema }),
  carWashController.listCarWashes,
);
router.post(
  '/',
  requireSuperAdmin(),
  requirePermission(PERMISSIONS.CAR_WASH_CREATE),
  validate({ body: onboardCarWashSchema }),
  carWashController.createCarWash,
);

/**
 * @openapi
 * /car-washes/stats:
 *   get:
 *     tags: [Car Washes]
 *     summary: Platform-wide counts for the admin portal dashboard
 *     description: Car washes by status, tenant users (total / active) and orders (today / last 30 days). Platform admins only.
 *     responses:
 *       200: { description: Platform stats }
 */
router.get(
  '/stats',
  requireSuperAdmin(),
  requirePermission(PERMISSIONS.CAR_WASH_VIEW),
  carWashController.getPlatformStats,
);

/**
 * @openapi
 * /car-washes/{id}:
 *   get:
 *     tags: [Car Washes]
 *     summary: Get car wash details
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Car wash detail }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *   patch:
 *     tags: [Car Washes]
 *     summary: Update car wash details or status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Car wash updated }
 *   delete:
 *     tags: [Car Washes]
 *     summary: Disable a car wash (soft delete)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Car wash disabled }
 */
// GET/PATCH by id: a car wash's own OWNER (holding CAR_WASH_VIEW/UPDATE) may view/update
// only their own car wash; requireCarWashAccess enforces that (SUPER_ADMIN bypasses it).
router.get(
  '/:id',
  requirePermission(PERMISSIONS.CAR_WASH_VIEW),
  validate({ params: carWashIdParamSchema }),
  requireCarWashAccess((req) => req.params.id),
  carWashController.getCarWash,
);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.CAR_WASH_UPDATE),
  validate({ params: carWashIdParamSchema, body: updateCarWashSchema }),
  requireCarWashAccess((req) => req.params.id),
  carWashController.updateCarWash,
);
router.delete(
  '/:id',
  requireSuperAdmin(),
  requirePermission(PERMISSIONS.CAR_WASH_DELETE),
  validate({ params: carWashIdParamSchema }),
  carWashController.deleteCarWash,
);

export default router;
