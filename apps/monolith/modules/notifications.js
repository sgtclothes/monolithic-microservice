const notifications = require('../../shared/domain/notifications');
const { requireAuth } = require('../../shared/auth');
const { notificationBacklog } = require('../../shared/metrics');
const log = require('../../shared/logger');

const RETRY_DELAY_MS = Number(process.env.NOTIFICATION_RETRY_DELAY_MS || 2000);
const MAX_ATTEMPTS = Number(process.env.NOTIFICATION_MAX_ATTEMPTS || 30);

module.exports = function createNotificationsModule({ db, thirdParty, config }) {
  const mode = config.notificationMode;
  const send = (msg) => notifications.sendOrderConfirmation(db, thirdParty.emailProvider, msg, { mode });

  // ASYNC mode in the monolith: in-memory queue + background retries.
  // Orders do not wait for the email, BUT the queue is lost if the process restarts/crashes
  // (compare with the durable RabbitMQ queue in the microservices version).
  function enqueue(msg) {
    notificationBacklog.inc();
    const attempt = async (n) => {
      try {
        await send(msg);
        notificationBacklog.dec();
      } catch (err) {
        if (n >= MAX_ATTEMPTS) {
          notificationBacklog.dec();
          log.error('notification dropped after max retries', { orderId: msg.orderId });
          return;
        }
        setTimeout(() => attempt(n + 1), RETRY_DELAY_MS);
      }
    };
    setImmediate(() => attempt(1));
  }

  return {
    // SYNC mode (monolith default): checkout WAITS until the email is sent.
    // If the email provider is down -> checkout fails too.
    notifyOrderPaid: async (msg) => (mode === 'async' ? enqueue(msg) : send(msg)),

    routes(app) {
      app.get('/api/notifications', requireAuth, async (req, res) => {
        res.json({ items: await notifications.listByOrder(db, req.query.order_id, req.user.id) });
      });
    },
  };
};
