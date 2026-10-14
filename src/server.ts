import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { checkDatabaseConnection, pool } from './db';
import { startPromotionSender } from './services/promotion.service';

async function start() {
  const connected = await checkDatabaseConnection();
  if (!connected) {
    logger.error(
      'Could not connect to the database. Check DATABASE_URL and that PostgreSQL is running.',
    );
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Car Wash API listening on port ${env.PORT} (${env.NODE_ENV})`);
    logger.info(`Swagger docs available at http://localhost:${env.PORT}/api/docs`);
    if (env.DEV_RESET_CODE && env.NODE_ENV === 'production') {
      logger.warn(
        'DEV_RESET_CODE is set in production: anyone can reset a password with that code. Remove it before real use.',
      );
    }
  });

  const stopPromotionSender = startPromotionSender();

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    stopPromotionSender();
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
