// =====================================================================
//  order-service: checkout ORCHESTRATOR
//  Database: order_db (orders & order_items tables)
//
//  Calls other services over the network:
//   - product-service  (HTTP)  : reserve / release stock
//   - payment-service  (HTTP)  : charge
//   - notification     (event) : publish `order.paid` to RabbitMQ  [NOTIFICATION_MODE=async]
//                      (HTTP)  : direct call                      [NOTIFICATION_MODE=sync]
//
//  Since there is no longer one shared database transaction, consistency is kept
//  with the SAGA pattern: every step has a COMPENSATION if a later step fails.
// =====================================================================
const { runService } = require('../../shared/service');
const orders = require('../../shared/domain/orders');
const { requireAuth } = require('../../shared/auth');
const { callJson } = require('../../shared/http');
const { createEventBus } = require('../../shared/events');
const { AppError } = require('../../shared/errors');
const { eventsPublished } = require('../../shared/metrics');
const log = require('../../shared/logger');

const PRODUCT_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3000';
const PAYMENT_URL = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3000';
const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3000';
const NOTIFICATION_MODE = process.env.NOTIFICATION_MODE || 'async';

runService({
  service: 'order-service',
  domains: ['orders'],
  async setup({ app, db }) {
    // The broker connection is made in the background: if RabbitMQ is down,
    // order-service keeps serving checkouts (events that fail to publish are recorded in logs & metrics).
    const bus = NOTIFICATION_MODE === 'async' ? createEventBus() : null;
    if (bus) bus.connect();

    const productApi = {
      reserve: (items) => callJson('product-service', 'POST', `${PRODUCT_URL}/internal/stock/reserve`, { items }),
      release: (items) => callJson('product-service', 'POST', `${PRODUCT_URL}/internal/stock/release`, { items }),
    };

    // MICROSERVICES version of the "ports": every step is a network call.
    const ports = {
      async reserveStockAndCreateOrder(userId, lines) {
        const { lines: snapshot } = await productApi.reserve(lines); // step 1 (product_db)
        try {
          return await db.tx((tx) => orders.insertOrder(tx, userId, snapshot)); // step 2 (order_db)
        } catch (err) {
          // Saga compensation: there is no cross-database rollback, so return the stock manually.
          await productApi.release(lines).catch((e) => log.error('stock release compensation failed', { err: e.message }));
          throw err;
        }
      },
      charge: (order) =>
        callJson('payment-service', 'POST', `${PAYMENT_URL}/internal/payments`, { order_id: order.id, amount: order.total }),
      async cancel(order, lines, status) {
        await productApi.release(lines).catch((e) => log.error('stock release compensation failed', { err: e.message }));
        await orders.setStatus(db, order.id, status);
      },
      markPaid: (order) => orders.setStatus(db, order.id, 'PAID'),
      async notify(msg) {
        if (NOTIFICATION_MODE === 'sync') {
          // Synchronous call: if notification-service or the email provider is down, checkout fails too.
          await callJson('notification-service', 'POST', `${NOTIFICATION_URL}/internal/notifications`, msg);
          return;
        }
        // Event-driven: just announce "order.paid". If the broker cannot be
        // reached, the order still succeeds (in production, use the Outbox Pattern).
        try {
          await bus.publish('order.paid', msg);
          eventsPublished.inc({ event: 'order.paid', result: 'ok' });
        } catch (err) {
          eventsPublished.inc({ event: 'order.paid', result: 'failed' });
          log.error('failed to publish order.paid event', { orderId: msg.orderId, err: err.message });
        }
      },
    };

    app.post('/api/orders', requireAuth, async (req, res) => {
      const result = await orders.checkout({ userId: req.user.id, email: req.user.email, items: (req.body || {}).items }, ports);
      res.status(201).json(result);
    });
    app.get('/api/orders', requireAuth, async (req, res) => {
      res.json({ items: await orders.listByUser(db, req.user.id) });
    });
    app.get('/api/orders/:id', requireAuth, async (req, res) => {
      res.json(await orders.getForUser(db, req.params.id, req.user.id));
    });

    if (!['sync', 'async'].includes(NOTIFICATION_MODE)) throw new AppError(500, 'CONFIG', 'NOTIFICATION_MODE must be sync|async');
    return bus ? () => bus.close() : undefined;
  },
});
