// All Prometheus metrics are defined in one place so names & labels are
// identical in the monolith and the microservices -> Grafana dashboards can
// compare both simply by filtering on the `arch` label.
const client = require('prom-client');

function setupMetrics({ service, arch }) {
  client.register.setDefaultLabels({ service, arch });
  // CPU, memory, event loop lag, GC, etc. per Node.js process
  client.collectDefaultMetrics({ eventLoopMonitoringPrecision: 10 });
}

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10];

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests RECEIVED by this service',
  labelNames: ['method', 'route', 'status_code'],
  buckets: LATENCY_BUCKETS,
});

const outboundDuration = new client.Histogram({
  name: 'outbound_request_duration_seconds',
  help: 'Duration of OUTBOUND HTTP requests (to other services / third parties), i.e. the cost of a "network hop"',
  labelNames: ['target', 'method', 'status'],
  buckets: LATENCY_BUCKETS,
});

const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration',
  labelNames: ['operation'],
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

const ordersTotal = new client.Counter({
  name: 'tokoku_orders_total',
  help: 'Number of orders by final status',
  labelNames: ['status'],
});

const paymentsTotal = new client.Counter({
  name: 'tokoku_payments_total',
  help: 'Number of payment attempts by result',
  labelNames: ['status'],
});

const notificationsTotal = new client.Counter({
  name: 'tokoku_notifications_total',
  help: 'Number of email notification send attempts',
  labelNames: ['status', 'mode'],
});

const loginsTotal = new client.Counter({
  name: 'tokoku_logins_total',
  help: 'Number of logins by result',
  labelNames: ['result'],
});

const eventsPublished = new client.Counter({
  name: 'tokoku_events_published_total',
  help: 'Events published to the message broker',
  labelNames: ['event', 'result'],
});

const notificationBacklog = new client.Gauge({
  name: 'tokoku_notification_backlog',
  help: 'Notifications still waiting to be sent (in-process queue, monolith async mode)',
});

function routeLabel(req) {
  // Use the route pattern (/api/products/:id), not the raw URL, to keep label cardinality low.
  return req.route ? req.route.path : 'unmatched';
}

function httpMetricsMiddleware(req, res, next) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: routeLabel(req), status_code: res.statusCode });
  });
  next();
}

module.exports = {
  client,
  setupMetrics,
  httpMetricsMiddleware,
  outboundDuration,
  dbQueryDuration,
  ordersTotal,
  paymentsTotal,
  notificationsTotal,
  loginsTotal,
  eventsPublished,
  notificationBacklog,
};
