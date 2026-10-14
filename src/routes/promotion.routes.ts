import { Router } from 'express';
import * as promotionController from '../controllers/promotion.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { requirePermission } from '../middlewares/authorize.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createPromotionSchema,
  listPromotionsQuerySchema,
  promotionIdParamSchema,
} from '../validators/promotion.validator';
import { PERMISSIONS } from '../constants/permissions';

// Promotions sit with the owner's reports, so they use the same permission.
const router = Router();
router.use(authenticate, requirePermission(PERMISSIONS.REPORTS_VIEW));

/**
 * @openapi
 * /promotions:
 *   get:
 *     tags: [Promotions]
 *     summary: List promotions, newest first
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [SCHEDULED, SENDING, SENT, FAILED, CANCELLED] }
 *     responses:
 *       200: { description: Promotions }
 *   post:
 *     tags: [Promotions]
 *     summary: Create a promotion for a group of customers, sent now or at a scheduled time
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, message, customerIds]
 *             properties:
 *               title: { type: string }
 *               message: { type: string, description: '{name} is replaced with the first name' }
 *               channel: { type: string, enum: [WHATSAPP, SMS] }
 *               customerIds: { type: array, items: { type: string, format: uuid } }
 *               sendAt: { type: string, format: date-time, nullable: true, description: Left out = now }
 *               audienceLabel: { type: string }
 *               audience: { type: object }
 *     responses:
 *       201: { description: Promotion created }
 */
router.get('/', validate({ query: listPromotionsQuerySchema }), promotionController.listPromotions);
router.post('/', validate({ body: createPromotionSchema }), promotionController.createPromotion);

/**
 * @openapi
 * /promotions/{id}:
 *   get:
 *     tags: [Promotions]
 *     summary: A promotion with each recipient and how their message went
 *     responses:
 *       200: { description: Promotion }
 * /promotions/{id}/cancel:
 *   post:
 *     tags: [Promotions]
 *     summary: Cancel a scheduled promotion before it is sent
 *     responses:
 *       200: { description: Cancelled }
 *       409: { description: Already sent or cancelled }
 */
router.get('/:id', validate({ params: promotionIdParamSchema }), promotionController.getPromotion);
router.post(
  '/:id/cancel',
  validate({ params: promotionIdParamSchema }),
  promotionController.cancelPromotion,
);

export default router;
