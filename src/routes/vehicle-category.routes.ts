import { Router } from 'express';
import * as categoryController from '../controllers/vehicle-category.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { requireSuperAdmin } from '../middlewares/authorize.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createVehicleCategorySchema,
  updateVehicleCategorySchema,
  vehicleCategoryIdParamSchema,
  listVehicleCategoriesQuerySchema,
} from '../validators/vehicle-category.validator';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /vehicle-categories:
 *   get:
 *     tags: [Vehicle categories]
 *     summary: Vehicle types (Private, Taxi, ...) that decide which service rate is charged
 *     description: Platform-wide. Any signed-in user can list them; only active ones unless includeInactive=true.
 *     parameters:
 *       - in: query
 *         name: includeInactive
 *         schema: { type: string, enum: ['true', 'false'] }
 *     responses:
 *       200: { description: List of vehicle categories }
 *   post:
 *     tags: [Vehicle categories]
 *     summary: Add a vehicle type (platform admins only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: Commercial }
 *               code: { type: string, description: Defaults to the name in UPPER_SNAKE_CASE }
 *               description: { type: string }
 *               sortOrder: { type: integer }
 *     responses:
 *       201: { description: Created }
 */
router.get(
  '/',
  validate({ query: listVehicleCategoriesQuerySchema }),
  categoryController.listVehicleCategories,
);
router.post(
  '/',
  requireSuperAdmin(),
  validate({ body: createVehicleCategorySchema }),
  categoryController.createVehicleCategory,
);

/**
 * @openapi
 * /vehicle-categories/{id}:
 *   patch:
 *     tags: [Vehicle categories]
 *     summary: Rename, reorder, deactivate or reactivate a vehicle type (platform admins only)
 *     description: Private is the default and can't be deactivated. Types are never deleted so past bookings keep them.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Updated }
 */
router.patch(
  '/:id',
  requireSuperAdmin(),
  validate({ params: vehicleCategoryIdParamSchema, body: updateVehicleCategorySchema }),
  categoryController.updateVehicleCategory,
);

export default router;
