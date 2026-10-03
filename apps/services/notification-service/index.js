// =====================================================================
//  notification-service: sends order confirmation emails
//  Database: notification_db (notifications table only)
//
//  Two ways to receive work:
//   1. ASYNC (default): consumes `order.paid` events from RabbitMQ.
//      If the email provider or this service is down, events wait in the queue
//      and are reprocessed automatically -> checkout is NOT affected.
//   2. SYNC: HTTP endpoint /internal/notifications called directly
//      by order-service (NOTIFICATION_MODE=sync in order-service).
// =====================================================================
const { runService } = require('../../shared/service');
const notifications = require('../../shared/domain/notifications');
const { createThirdPartyClient } = require('../../shared/thirdparty');
const { createEventBus } = require('../../shared/events');
const { requireAuth } = require('../../shared/auth');
const log = require('../../shared/logger');

runService({
  service: 'notification-service',
  domains: ['notifications'],
  async setup({ app, db }) {
    const { emailProvider } = createThirdPartyClient();
    const send = (msg, mode) => notifications.sendOrderConfirmation(db, emailProvider, msg, { mode });

    // ==== Event consumer (async) ====
    // Subscribing runs in the background (retries automatically until the broker is ready).
    const bus = createEventBus();
    bus.subscribe('notification.order-paid', 'order.paid', (event) => send(event, 'async'), {
      prefetch: Number(process.env.CONSUMER_PREFETCH || 20),
      retryDelayMs: Number(process.env.NOTIFICATION_RETRY_DELAY_MS || 2000),
    }).catch((err) => log.error('failed to subscribe to event', { err: err.message }));

    // ==== Internal API (sync) ====
    app.post('/internal/notifications', async (req, res) => {
      await send(req.body, 'sync');
      res.status(201).json({ sent: true });
    });

    // ==== Public API ====
    app.get('/api/notifications', requireAuth, async (req, res) => {
      res.json({ items: await notifications.listByOrder(db, req.query.order_id, req.user.id) });
    });

    return () => bus.close();
  },
});
