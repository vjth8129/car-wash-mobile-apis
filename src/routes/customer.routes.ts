import { Router } from 'express';
import * as customerController from '../controllers/customer.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { requirePermission } from '../middlewares/authorize.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createCustomerSchema,
  updateCustomerSchema,
  customerIdParamSchema,
  listCustomersQuerySchema,
} from '../validators/customer.validator';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /customers:
 *   get:
 *     tags: [Customers]
 *     summary: List customers within the current user's car wash
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
 *     responses:
 *       200: { description: List of customers }
 *   post:
 *     tags: [Customers]
 *     summary: Create a customer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone]
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               address: { type: string }
 *     responses:
 *       201: { description: Customer created }
 */
router.get(
  '/',
  requirePermission(PERMISSIONS.CUSTOMERS_VIEW),
  validate({ query: listCustomersQuerySchema }),
  customerController.listCustomers,
);
router.post(
  '/',
  requirePermission(PERMISSIONS.CUSTOMERS_CREATE),
  validate({ body: createCustomerSchema }),
  customerController.createCustomer,
);

/**
 * @openapi
 * /customers/{id}:
 *   get:
 *     tags: [Customers]
 *     summary: Get a customer by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Customer detail }
 *   patch:
 *     tags: [Customers]
 *     summary: Update a customer
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Customer updated }
 *   delete:
 *     tags: [Customers]
 *     summary: Delete (deactivate) a customer
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Customer deleted }
 */
router.get(
  '/:id',
  requirePermission(PERMISSIONS.CUSTOMERS_VIEW),
  validate({ params: customerIdParamSchema }),
  customerController.getCustomer,
);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.CUSTOMERS_UPDATE),
  validate({ params: customerIdParamSchema, body: updateCustomerSchema }),
  customerController.updateCustomer,
);
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.CUSTOMERS_DELETE),
  validate({ params: customerIdParamSchema }),
  customerController.deleteCustomer,
);

export default router;
