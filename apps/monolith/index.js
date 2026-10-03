// =====================================================================
//  TokoKu MONOLITH
//  One application, one process (optionally several workers), one database.
//  Every module (user, product, order, payment, notification) lives here
//  and they call each other through plain FUNCTION CALLS.
// =====================================================================
const { runClustered } = require('../shared/cluster');
const { env, envInt } = require('../shared/config');
const { createDb } = require('../shared/db');

const config = {
  service: 'monolith',
  arch: 'monolith',
  port: envInt('PORT', 3000),
  metricsPort: envInt('METRICS_PORT', 9100),
  workers: envInt('WORKERS', 2),
  databaseUrl: env('DATABASE_URL', 'postgres://tokoku:tokoku@localhost:5432/tokoku'),
  poolMax: envInt('DB_POOL_MAX', 10), // per worker
  notificationMode: env('NOTIFICATION_MODE', 'sync'), // sync | async
};

runClustered({
  service: config.service,
  arch: config.arch,
  workers: config.workers,
  metricsPort: config.metricsPort,
  // Migrations for every table (one shared database) run once in the primary process.
  init: async () => {
    const db = createDb({ connectionString: config.databaseUrl, max: 1 });
    await db.waitUntilReady();
    await db.withMigrationLock(async (conn) => {
      for (const m of ['users', 'products', 'orders', 'payments', 'notifications']) {
        await require(`../shared/domain/${m}`).migrate(conn);
      }
    });
    await db.end();
  },
  start: () => require('./app').start(config),
});
