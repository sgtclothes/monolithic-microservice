// DOMAIN: Payments
// Calls the third-party Payment Gateway (100-300ms latency) and records the result.
const { paymentsTotal } = require('../metrics');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS payments (
  id           BIGSERIAL PRIMARY KEY,
  order_id     BIGINT NOT NULL,
  amount       BIGINT NOT NULL,
  status       TEXT NOT NULL,
  provider_ref TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (order_id);`;

async function migrate(db) {
  await db.query(SCHEMA);
}

// Returns a payment with status: SUCCESS | DECLINED | ERROR
async function charge(db, gateway, { orderId, amount }) {
  const { rows } = await db.query(
    `INSERT INTO payments (order_id, amount, status) VALUES ($1, $2, 'PENDING') RETURNING id`,
    [orderId, amount],
  );
  const id = rows[0].id;

  let status;
  let providerRef = null;
  let error = null;
  try {
    const res = await gateway.charge({ orderId, amount });
    status = res.status === 'SUCCESS' ? 'SUCCESS' : 'DECLINED';
    providerRef = res.reference || null;
    if (status === 'DECLINED') error = res.reason || 'declined';
  } catch (err) {
    status = 'ERROR';
    error = err.message;
  }

  await db.query('UPDATE payments SET status = $2, provider_ref = $3, error = $4, updated_at = now() WHERE id = $1', [id, status, providerRef, error]);
  paymentsTotal.inc({ status });
  return { id: Number(id), orderId: Number(orderId), amount: Number(amount), status, providerRef, error };
}

module.exports = { migrate, charge };
