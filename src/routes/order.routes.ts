import { Router } from 'express';
import * as orderController from '../controllers/order.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { requirePermission } from '../middlewares/authorize.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createOrderSchema,
  updateOrderStatusSchema,
  orderIdParamSchema,
  listOrdersQuerySchema,
} from '../validators/order.validator';
import { PERMISSIONS } from '../constants/permissions';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /orders:
 *   get:
 *     tags: [Orders]
 *     summary: List car wash jobs/orders
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [CREATED, WASHING, READY, COMPLETED, CANCELLED] }
 *     responses:
 *       200: { description: List of orders }
 *   post:
 *     tags: [Orders]
 *     summary: Check a booking in and create its order/job
 *     description: Atomically creates the order and (if the booking was PENDING) confirms the booking.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookingId]
 *             properties:
 *               bookingId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Order created }
 */
router.get(
  '/',
  requirePermission(PERMISSIONS.ORDERS_VIEW),
  validate({ query: listOrdersQuerySchema }),
  orderController.listOrders,
);
router.post(
  '/',
  requirePermission(PERMISSIONS.ORDERS_CREATE),
  validate({ body: createOrderSchema }),
  orderController.createOrder,
);

/**
 * @openapi
 * /orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Get an order by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Order detail }
 *   patch:
 *     tags: [Orders]
 *     summary: Advance the order/job workflow status
 *     description: Valid transitions - CREATED ("Waiting")→WASHING→READY→COMPLETED, or →CANCELLED from any non-terminal state. CHECKED_IN is accepted as a legacy alias for WASHING (older app builds). The linked booking's status is kept in sync in the same transaction.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [WASHING, READY, COMPLETED, CANCELLED] }
 *     responses:
 *       200: { description: Order updated }
 */
router.get(
  '/:id',
  requirePermission(PERMISSIONS.ORDERS_VIEW),
  validate({ params: orderIdParamSchema }),
  orderController.getOrder,
);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.ORDERS_UPDATE),
  validate({ params: orderIdParamSchema, body: updateOrderStatusSchema }),
  orderController.updateOrderStatus,
);

export default router;
