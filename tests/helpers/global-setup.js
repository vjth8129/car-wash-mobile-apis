const { execSync } = require('child_process');

module.exports = async function globalSetup() {
  const env = { ...process.env, NODE_ENV: 'test' };
  execSync('npx tsx src/db/migrate.ts', { stdio: 'inherit', env });
  execSync('npx tsx tests/helpers/reset-and-seed.ts', { stdio: 'inherit', env });
};
