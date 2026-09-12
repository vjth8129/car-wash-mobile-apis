import { Router } from 'express';
import { checkDatabaseConnection } from '../db';
import { asyncHandler } from '../utils/async-handler';

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Overall health check including database connectivity
 *     security: []
 *     responses:
 *       200: { description: Service and dependencies are healthy }
 *       503: { description: A dependency is unavailable }
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const dbConnected = await checkDatabaseConnection();
    res.status(dbConnected ? 200 : 503).json({
      status: dbConnected ? 'ok' : 'error',
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }),
);

/**
 * @openapi
 * /health/live:
 *   get:
 *     tags: [Health]
 *     summary: Liveness probe - the process is up
 *     security: []
 *     responses:
 *       200: { description: Process is alive }
 */
router.get('/live', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * @openapi
 * /health/ready:
 *   get:
 *     tags: [Health]
 *     summary: Readiness probe - dependencies (database) are reachable
 *     security: []
 *     responses:
 *       200: { description: Ready to serve traffic }
 *       503: { description: Not ready }
 */
router.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const dbConnected = await checkDatabaseConnection();
    res.status(dbConnected ? 200 : 503).json({
      status: dbConnected ? 'ok' : 'error',
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }),
);

export default router;
