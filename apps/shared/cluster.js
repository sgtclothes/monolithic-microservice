const cluster = require('node:cluster');
const http = require('node:http');
const { AggregatorRegistry } = require('prom-client');
const { setupMetrics } = require('./metrics');
const log = require('./logger');

// Node.js runs JavaScript on ONE thread. To use more than one CPU core,
// we run several worker processes (node:cluster) that share the same port.
//
// This matters for the SCALE UP demo: adding CPUs to the monolith container is
// useless if the app only uses 1 core. So WORKERS must be raised as well.
//
// - Primary process: runs DB migrations once, forks the workers, and
//   aggregates metrics from all workers on METRICS_PORT (/metrics).
// - Worker process: runs the app's HTTP server.
function runClustered({ service, arch, workers, metricsPort, init, start }) {
  if (cluster.isPrimary) {
    let shuttingDown = false;

    const boot = async () => {
      if (init) await init();
      const n = Math.max(1, workers);
      log.info('starting workers', { workers: n, arch });
      for (let i = 0; i < n; i++) cluster.fork();
    };

    cluster.on('exit', (worker, code, signal) => {
      if (shuttingDown) return;
      log.warn('worker died, restarting', { worker: worker.process.pid, code, signal });
      cluster.fork();
    });

    const aggregator = new AggregatorRegistry();
    http
      .createServer(async (req, res) => {
        if (req.url !== '/metrics') {
          res.writeHead(404).end();
          return;
        }
        try {
          const body = await aggregator.clusterMetrics();
          res.writeHead(200, { 'Content-Type': aggregator.contentType }).end(body);
        } catch (err) {
          res.writeHead(500).end(err.message);
        }
      })
      .listen(metricsPort, () => log.info('metrics endpoint listening', { port: metricsPort }));

    const stop = () => {
      shuttingDown = true;
      for (const w of Object.values(cluster.workers)) w.process.kill('SIGTERM');
      setTimeout(() => process.exit(0), 11_000).unref();
      cluster.on('exit', () => {
        if (Object.keys(cluster.workers).length === 0) process.exit(0);
      });
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);

    boot().catch((err) => {
      log.error('failed to start', { err: err.message, stack: err.stack });
      process.exit(1);
    });
  } else {
    // Required: creating an AggregatorRegistry in the worker installs the IPC listener so the
    // worker answers metric requests from the primary (without it /metrics times out -> 500).
    new AggregatorRegistry();
    setupMetrics({ service, arch });
    Promise.resolve(start()).catch((err) => {
      log.error('worker failed to start', { err: err.message, stack: err.stack });
      process.exit(1);
    });
  }
}

module.exports = { runClustered };
