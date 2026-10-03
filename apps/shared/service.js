// Shared skeleton for every MICROSERVICE:
// - its own database (a different DATABASE_URL per service)
// - migrations only for the tables that service owns
// - HTTP server + /health + /metrics
const { runClustered } = require('./cluster');
const { env, envInt } = require('./config');
const { createDb } = require('./db');
const { createApp, finalize, listen } = require('./server');

function runService({ service, domains = [], setup }) {
  const config = {
    service,
    arch: 'microservices',
    port: envInt('PORT', 3000),
    metricsPort: envInt('METRICS_PORT', 9100),
    workers: envInt('WORKERS', 1),
    databaseUrl: env('DATABASE_URL', ''),
    poolMax: envInt('DB_POOL_MAX', 5),
  };

  runClustered({
    service,
    arch: config.arch,
    workers: config.workers,
    metricsPort: config.metricsPort,
    init: config.databaseUrl
      ? async () => {
          const db = createDb({ connectionString: config.databaseUrl, max: 1 });
          await db.waitUntilReady();
          await db.withMigrationLock(async (conn) => {
            for (const m of domains) await require(`./domain/${m}`).migrate(conn);
          });
          await db.end();
        }
      : undefined,
    start: async () => {
      const db = config.databaseUrl ? createDb({ connectionString: config.databaseUrl, max: config.poolMax }) : null;
      const app = createApp({ service, healthCheck: db ? () => db.ping() : undefined });
      const onShutdown = await setup({ app, db, config });
      finalize(app);
      listen(app, config.port, async () => {
        if (onShutdown) await onShutdown();
        if (db) await db.end();
      });
    },
  });
}

module.exports = { runService };
