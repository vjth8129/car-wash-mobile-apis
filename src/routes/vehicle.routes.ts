import { Router } from 'express';
import * as vehicleController from '../controllers/vehicle.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { requirePermission } from '../middlewares/authorize.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createVehicleSchema,
  updateVehicleSchema,
  vehicleIdParamSchema,
  listVehiclesQuerySchema,
} from '../validators/vehicle.validator';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /vehicles:
 *   get:
 *     tags: [Vehicles]
 *     summary: List vehicles within the current user's car wash
 *     parameters:
 *       - in: query
 *         name: customerId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of vehicles }
 *   post:
 *     tags: [Vehicles]
 *     summary: Add a vehicle for a customer
 *     description: The referenced customerId must belong to the caller's own car wash.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, registrationNumber]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               registrationNumber: { type: string }
 *               brand: { type: string }
 *               model: { type: string }
 *               vehicleType: { type: string, enum: [SEDAN, SUV, HATCHBACK, TRUCK, VAN, MOTORCYCLE, OTHER] }
 *     responses:
 *       201: { description: Vehicle created }
 */
router.get(
  '/',
  requirePermission(PERMISSIONS.VEHICLES_VIEW),
  validate({ query: listVehiclesQuerySchema }),
  vehicleController.listVehicles,
);
router.post(
  '/',
  requirePermission(PERMISSIONS.VEHICLES_CREATE),
  validate({ body: createVehicleSchema }),
  vehicleController.createVehicle,
);

/**
 * @openapi
 * /vehicles/{id}:
 *   get:
 *     tags: [Vehicles]
 *     summary: Get a vehicle by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Vehicle detail }
 *   patch:
 *     tags: [Vehicles]
 *     summary: Update a vehicle
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Vehicle updated }
 *   delete:
 *     tags: [Vehicles]
 *     summary: Delete a vehicle
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Vehicle deleted }
 */
router.get(
  '/:id',
  requirePermission(PERMISSIONS.VEHICLES_VIEW),
  validate({ params: vehicleIdParamSchema }),
  vehicleController.getVehicle,
);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.VEHICLES_UPDATE),
  validate({ params: vehicleIdParamSchema, body: updateVehicleSchema }),
  vehicleController.updateVehicle,
);
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.VEHICLES_DELETE),
  validate({ params: vehicleIdParamSchema }),
  vehicleController.deleteVehicle,
);

export default router;
