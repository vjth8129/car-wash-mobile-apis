import { Router } from 'express';
import * as reportController from '../controllers/report.controller';
import { authenticate } from '../middlewares/authenticate.middleware';
import { requirePermission } from '../middlewares/authorize.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { validate } from '../middlewares/validate.middleware';
import {
  audienceQuerySchema,
  exportDownloadQuerySchema,
  salesExportSchema,
  salesReportQuerySchema,
} from '../validators/report.validator';

const router = Router();

/**
 * @openapi
 * /reports/sales/export:
 *   get:
 *     tags: [Reports]
 *     summary: Download a sales report file (from a link made by POST /reports/sales/export-link)
 *     description: No bearer token - the link's token (valid 5 minutes) authorises it.
 *     security: []
 *     parameters:
 *       - { in: query, name: token, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The PDF or Excel file }
 *       401: { description: Link expired or invalid }
 */
router.get(
  '/sales/export',
  validate({ query: exportDownloadQuerySchema }),
  reportController.downloadSalesExport,
);

router.use(authenticate);

/**
 * @openapi
 * /reports/sales/export-link:
 *   post:
 *     tags: [Reports]
 *     summary: Make a 5-minute download link for the sales report as PDF or Excel
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [format, from, to]
 *             properties:
 *               format: { type: string, enum: [pdf, xlsx] }
 *               from: { type: string, format: date }
 *               to: { type: string, format: date }
 *               serviceId: { type: string, format: uuid }
 *               categoryId: { type: string, format: uuid }
 *               vehicleType: { type: string }
 *               paymentStatus: { type: string, enum: [PAID, UNPAID] }
 *     responses:
 *       201: { description: '{ path, filename, expiresAt } - path is relative to /api/v1' }
 */
router.post(
  '/sales/export-link',
  requirePermission(PERMISSIONS.REPORTS_VIEW),
  validate({ body: salesExportSchema }),
  reportController.createSalesExportLink,
);

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
 * /reports/sales:
 *   get:
 *     tags: [Reports]
 *     summary: Sales analytics for a date range
 *     description: >
 *       Completed washes between two local dates (the car wash's timezone), with totals, the
 *       previous period of the same length for comparison, revenue over time, and splits by
 *       service, vehicle category, body type, payment and hour, plus the newest transactions.
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: to, required: true, schema: { type: string, format: date } }
 *       - in: query
 *         name: groupBy
 *         description: Chart bucket; picked from the range length when left out
 *         schema: { type: string, enum: [hour, day, week, month] }
 *       - { in: query, name: serviceId, schema: { type: string, format: uuid } }
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - in: query
 *         name: vehicleType
 *         schema: { type: string, enum: [SEDAN, SUV, HATCHBACK, TRUCK, VAN, MOTORCYCLE, OTHER] }
 *       - { in: query, name: paymentStatus, schema: { type: string, enum: [PAID, UNPAID] } }
 *       - { in: query, name: limit, description: Transactions to include (0-500), schema: { type: integer, default: 100 } }
 *     responses:
 *       200: { description: Sales report }
 */
router.get(
  '/sales',
  requirePermission(PERMISSIONS.REPORTS_VIEW),
  validate({ query: salesReportQuerySchema }),
  reportController.getSales,
);

/**
 * @openapi
 * /reports/customers:
 *   get:
 *     tags: [Reports]
 *     summary: Customers behind a slice of sales (promotion audience)
 *     description: >
 *       The customers whose completed washes match the same filters as /reports/sales, with
 *       their visits, spend and vehicles in the range - newest visit first, at most 2000.
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: to, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: serviceId, schema: { type: string, format: uuid } }
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - in: query
 *         name: vehicleType
 *         schema: { type: string, enum: [SEDAN, SUV, HATCHBACK, TRUCK, VAN, MOTORCYCLE, OTHER] }
 *       - { in: query, name: paymentStatus, schema: { type: string, enum: [PAID, UNPAID] } }
 *       - { in: query, name: minVisits, schema: { type: integer, default: 1 } }
 *       - in: query
 *         name: notReturned
 *         description: Only customers with no wash since the range ended
 *         schema: { type: string, enum: ['true', 'false'] }
 *     responses:
 *       200: { description: Matching customers }
 */
router.get(
  '/customers',
  requirePermission(PERMISSIONS.REPORTS_VIEW),
  validate({ query: audienceQuerySchema }),
  reportController.getAudience,
);

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
