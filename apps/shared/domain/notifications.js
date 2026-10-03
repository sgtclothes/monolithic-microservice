// DOMAIN: Notifications (order confirmation email)
// Sends email through a third-party Email Provider. If the provider is down,
// this function throws -> the impact on the order depends on the ARCHITECTURE:
//   - sync  : the order fails too (coupling)
//   - async : the order still succeeds, the email is retried later
const { AppError } = require('../errors');
const { notificationsTotal } = require('../metrics');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  order_id   BIGINT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL,
  email      TEXT NOT NULL,
  status     TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

async function migrate(db) {
  await db.query(SCHEMA);
}

const formatRupiah = (n) => 'Rp' + Number(n).toLocaleString('id-ID');

async function sendOrderConfirmation(db, emailProvider, { orderId, userId, email, total }, { mode = 'sync' } = {}) {
  // Idempotent: a retry for the same order only increments `attempts`.
  await db.query(
    `INSERT INTO notifications (order_id, user_id, email, status, attempts) VALUES ($1, $2, $3, 'PENDING', 1)
     ON CONFLICT (order_id) DO UPDATE SET attempts = notifications.attempts + 1, updated_at = now()`,
    [orderId, userId, email],
  );
  try {
    await emailProvider.send({
      to: email,
      subject: `Order #${orderId} paid successfully`,
      body: `Thank you! We have received your payment of ${formatRupiah(total)} for order #${orderId}.`,
    });
  } catch (err) {
    await db.query(`UPDATE notifications SET status = 'FAILED', last_error = $2, updated_at = now() WHERE order_id = $1`, [orderId, err.message]);
    notificationsTotal.inc({ status: 'failed', mode });
    throw new AppError(502, 'NOTIFICATION_FAILED', `Failed to send confirmation email: ${err.message}`);
  }
  await db.query(`UPDATE notifications SET status = 'SENT', last_error = NULL, updated_at = now() WHERE order_id = $1`, [orderId]);
  notificationsTotal.inc({ status: 'sent', mode });
}

async function listByOrder(db, orderId, userId) {
  const { rows } = await db.query(
    'SELECT order_id, email, status, attempts, last_error, created_at, updated_at FROM notifications WHERE order_id = $1 AND user_id = $2',
    [Number(orderId) || 0, userId],
  );
  return rows;
}

module.exports = { migrate, sendOrderConfirmation, listByOrder };
