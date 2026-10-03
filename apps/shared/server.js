const express = require('express');
const { httpMetricsMiddleware } = require('./metrics');
const { AppError, errorHandler } = require('./errors');
const log = require('./logger');

// The same HTTP server skeleton for every app (monolith & each service).
function createApp({ service, healthCheck }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(express.json({ limit: '100kb' }));
  app.use(httpMetricsMiddleware);

  app.get('/health', async (req, res) => {
    try {
      if (healthCheck) await healthCheck();
      res.json({ status: 'ok', service, pid: process.pid });
    } catch (err) {
      res.status(503).json({ status: 'unhealthy', service, error: err.message });
    }
  });

  return app;
}

function finalize(app) {
  app.use((req, res, next) => next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`)));
  app.use(errorHandler);
}

function listen(app, port, onShutdown) {
  const server = app.listen(port, () => log.info('http server listening', { port }));
  // Longer than nginx's keepalive_timeout so upstream connections are not closed from our side first.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // Graceful shutdown: stop accepting new requests, finish the ones in flight.
  const shutdown = () => {
    log.info('shutting down');
    server.close(async () => {
      if (onShutdown) await onShutdown().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

module.exports = { createApp, finalize, listen };
