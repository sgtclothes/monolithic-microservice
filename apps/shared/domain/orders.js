// DOMAIN: Orders + the CHECKOUT flow
//
// `checkout()` is the ONLY definition of the checkout business flow, used by
// the monolith AND order-service. The only difference is the injected
// "ports" (adapters):
//
//   step                            monolith (function call)             microservices (network)
//   =============================   ==================================   ======================================
//   reserveStockAndCreateOrder      1 ACID transaction (stock+order)     HTTP to product-service + local insert
//                                                                        (+ compensation if the insert fails)
//   charge                          call the payments module             HTTP to payment-service
//   cancel (compensation)           1 ACID transaction                   HTTP stock release + local update
//   notify                          sync / in-process background         RabbitMQ event / sync HTTP
//
// This way the performance comparison truly compares ARCHITECTURES,
// not differences in logic implementation.
const crypto = require('node:crypto');
const { AppError } = require('../errors');
const { ordersTotal } = require('../metrics');

// Note: order_items.product_name & unit_price are a SNAPSHOT taken at transaction time
// (not a JOIN to the products table).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  status     TEXT NOT NULL,
  total      BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, id DESC);
CREATE TABLE IF NOT EXISTS order_items (
  order_id     BIGINT NOT NULL REFERENCES orders(id),
  product_id   INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  unit_price   INTEGER NOT NULL,
  qty          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);`;

const FRAUD_CHECK_ROUNDS = Number(process.env.FRAUD_CHECK_ROUNDS || 2000);

async function migrate(db) {
  await db.query(SCHEMA);
}

// Validate & normalize input: [{product_id, qty}] -> [{productId, qty}]
function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 10) {
    throw new AppError(400, 'VALIDATION', 'items must contain 1 to 10 products');
  }
  const merged = new Map();
  for (const it of items) {
    const productId = Number(it && (it.product_id ?? it.productId));
    const qty = Number(it && it.qty);
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(qty) || qty < 1 || qty > 5) {
      throw new AppError(400, 'VALIDATION', 'Each item needs a product_id (int) and a qty (1 to 5)');
    }
    merged.set(productId, (merged.get(productId) || 0) + qty);
  }
  return [...merged].map(([productId, qty]) => ({ productId, qty }));
}

// Simulates CPU-heavy "fraud scoring / promo calculation" (synchronous, blocks the
// event loop). Tuned via FRAUD_CHECK_ROUNDS. This is what makes POST /orders
// CPU-bound enough for scaling effects to show clearly in Grafana.
function fraudCheck(userId, items, rounds = FRAUD_CHECK_ROUNDS) {
  let digest = Buffer.from(JSON.stringify({ userId, items }));
  for (let i = 0; i < rounds; i++) digest = crypto.createHash('sha256').update(digest).digest();
  return digest[0]; // dummy score
}

async function insertOrder(tx, userId, lines) {
  const total = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const { rows } = await tx.query(
    `INSERT INTO orders (user_id, status, total) VALUES ($1, 'PENDING', $2) RETURNING id, user_id, status, total, created_at`,
    [userId, total],
  );
  const order = rows[0];
  await tx.query(
    `INSERT INTO order_items (order_id, product_id, product_name, unit_price, qty)
     SELECT $1, * FROM unnest($2::int[], $3::text[], $4::int[], $5::int[])`,
    [order.id, lines.map((l) => l.productId), lines.map((l) => l.name), lines.map((l) => l.unitPrice), lines.map((l) => l.qty)],
  );
  return { id: Number(order.id), userId: order.user_id, status: order.status, total: Number(order.total), createdAt: order.created_at, items: lines };
}

async function setStatus(db, orderId, status) {
  await db.query('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1', [orderId, status]);
}

async function listByUser(db, userId, limit = 20) {
  const { rows } = await db.query('SELECT id, status, total, created_at FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT $2', [userId, limit]);
  return rows.map((r) => ({ ...r, id: Number(r.id), total: Number(r.total) }));
}

async function getForUser(db, orderId, userId) {
  const { rows } = await db.query('SELECT id, user_id, status, total, created_at, updated_at FROM orders WHERE id = $1 AND user_id = $2', [Number(orderId) || 0, userId]);
  if (!rows[0]) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  const items = await db.query('SELECT product_id, product_name, unit_price, qty FROM order_items WHERE order_id = $1', [rows[0].id]);
  return { ...rows[0], id: Number(rows[0].id), total: Number(rows[0].total), items: items.rows };
}

/**
 * Checkout flow: check products -> decrement stock -> create order -> pay -> send notification.
 * @param {{userId:number, email:string, items:any[]}} input
 * @param {{reserveStockAndCreateOrder, charge, cancel, markPaid, notify}} ports
 */
async function checkout({ userId, email, items }, ports) {
  const lines = validateItems(items);
  fraudCheck(userId, lines);

  const order = await ports.reserveStockAndCreateOrder(userId, lines);

  let payment;
  try {
    payment = await ports.charge(order);
  } catch (err) {
    await ports.cancel(order, lines, 'PAYMENT_ERROR');
    ordersTotal.inc({ status: 'payment_error' });
    throw err;
  }
  if (payment.status !== 'SUCCESS') {
    await ports.cancel(order, lines, 'PAYMENT_FAILED');
    ordersTotal.inc({ status: 'payment_failed' });
    if (payment.status === 'DECLINED') throw new AppError(402, 'PAYMENT_DECLINED', 'Payment declined');
    throw new AppError(502, 'PAYMENT_GATEWAY_ERROR', `Payment gateway error: ${payment.error}`);
  }

  await ports.markPaid(order);

  try {
    await ports.notify({ orderId: order.id, userId, email, total: order.total });
  } catch (err) {
    // In SYNC mode, an email failure fails the whole checkout request.
    ordersTotal.inc({ status: 'notification_failed' });
    throw err;
  }

  ordersTotal.inc({ status: 'paid' });
  return { order: { ...order, status: 'PAID' }, payment };
}

module.exports = { migrate, validateItems, fraudCheck, insertOrder, setStatus, listByUser, getForUser, checkout };
