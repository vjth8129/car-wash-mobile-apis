import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index';
import { logger } from '../config/logger';

async function run() {
  logger.info('Running database migrations...');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  logger.info('Migrations completed successfully.');
  await pool.end();
}

run().catch((err) => {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
});
