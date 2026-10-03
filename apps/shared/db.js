const { Pool } = require('pg');
const { client, dbQueryDuration } = require('./metrics');
const log = require('./logger');

// Wraps pg.Pool so every query is recorded in metrics, and provides a
// transaction helper. Domain functions only need an object with `.query()`,
// so they accept either a plain pool OR a client inside a transaction.
function instrument(target) {
  return {
    async query(text, params) {
      const operation = text.trimStart().split(/\s+/, 1)[0].toUpperCase();
      const end = dbQueryDuration.startTimer({ operation });
      try {
        return await target.query(text, params);
      } finally {
        end();
      }
    },
  };
}

function createDb({ connectionString, max = 10 }) {
  const pool = new Pool({ connectionString, max, idleTimeoutMillis: 30000 });
  pool.on('error', (err) => log.error('pg pool error', { err: err.message }));

  // A full pool (waiting > 0) is a sign of a database I/O bottleneck.
  client.register.removeSingleMetric('db_pool_connections');
  new client.Gauge({
    name: 'db_pool_connections',
    help: 'Database pool connection state (total/idle/waiting)',
    labelNames: ['state'],
    collect() {
      this.set({ state: 'total' }, pool.totalCount);
      this.set({ state: 'idle' }, pool.idleCount);
      this.set({ state: 'waiting' }, pool.waitingCount);
    },
  });

  const db = instrument(pool);

  db.tx = async (fn) => {
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      const result = await fn(instrument(conn));
      await conn.query('COMMIT');
      return result;
    } catch (err) {
      await conn.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  };

  db.ping = () => pool.query('SELECT 1');
  db.end = () => pool.end();

  // Wait until the database is ready (the postgres container can start more slowly).
  db.waitUntilReady = async (attempts = 60) => {
    for (let i = 1; i <= attempts; i++) {
      try {
        await pool.query('SELECT 1');
        return;
      } catch (err) {
        log.warn('database not ready yet, retrying...', { attempt: i, err: err.message });
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw new Error('Database is unreachable');
  };

  // Migrations + seeding are guarded by an advisory lock so many replicas can start at once safely.
  db.withMigrationLock = async (fn) => {
    const conn = await pool.connect();
    try {
      await conn.query('SELECT pg_advisory_lock(424242)');
      return await fn(instrument(conn));
    } finally {
      await conn.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
      conn.release();
    }
  };

  return db;
}

module.exports = { createDb };
