import { Router } from 'express';
import * as serviceController from '../controllers/service.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { requirePermission } from '../middlewares/authorize.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createServiceSchema,
  updateServiceSchema,
  serviceIdParamSchema,
  listServicesQuerySchema,
} from '../validators/service.validator';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /services:
 *   get:
 *     tags: [Services]
 *     summary: List services offered by the current user's car wash
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
 *         schema: { type: string, enum: [ACTIVE, INACTIVE] }
 *     responses:
 *       200: { description: List of services }
 *   post:
 *     tags: [Services]
 *     summary: Create a new service
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price, durationMinutes]
 *             properties:
 *               name: { type: string, example: Premium Wash }
 *               description: { type: string }
 *               price: { type: number, example: 499.00, description: Rate for private vehicles }
 *               taxiPrice: { type: number, nullable: true, example: 449.00, description: Rate for taxis; null or omitted means taxis are charged price }
 *               durationMinutes: { type: integer, example: 45 }
 *     responses:
 *       201: { description: Service created }
 */
router.get(
  '/',
  requirePermission(PERMISSIONS.SERVICES_VIEW),
  validate({ query: listServicesQuerySchema }),
  serviceController.listServices,
);
router.post(
  '/',
  requirePermission(PERMISSIONS.SERVICES_CREATE),
  validate({ body: createServiceSchema }),
  serviceController.createService,
);

/**
 * @openapi
 * /services/{id}:
 *   get:
 *     tags: [Services]
 *     summary: Get a service by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Service detail }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *   patch:
 *     tags: [Services]
 *     summary: Update a service
 *     description: Send status INACTIVE to deactivate (reversible - it stays listed under status=INACTIVE) and ACTIVE to reactivate. DELETE removes the service permanently from listings.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               price: { type: number, description: Rate for private vehicles }
 *               taxiPrice: { type: number, nullable: true, description: Rate for taxis; null = same as price }
 *               durationMinutes: { type: integer }
 *               status: { type: string, enum: [ACTIVE, INACTIVE] }
 *               sortOrder: { type: integer }
 *     responses:
 *       200: { description: Service updated }
 *   delete:
 *     tags: [Services]
 *     summary: Delete (deactivate) a service
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Service deleted }
 */
router.get(
  '/:id',
  requirePermission(PERMISSIONS.SERVICES_VIEW),
  validate({ params: serviceIdParamSchema }),
  serviceController.getService,
);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.SERVICES_UPDATE),
  validate({ params: serviceIdParamSchema, body: updateServiceSchema }),
  serviceController.updateService,
);
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.SERVICES_DELETE),
  validate({ params: serviceIdParamSchema }),
  serviceController.deleteService,
);

export default router;
