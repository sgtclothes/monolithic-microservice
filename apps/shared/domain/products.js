// DOMAIN: Products & Stock
// GET /products is the READ-HEAVY endpoint (pure baseline, 1 query).
const { AppError } = require('../errors');

const CATEGORIES = ['electronics', 'fashion', 'home', 'sports', 'books', 'beauty', 'toys', 'automotive', 'food', 'health'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price       INTEGER NOT NULL,
  stock       INTEGER NOT NULL CHECK (stock >= 0),
  description TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category, id);`;

// Deterministic seed -> monolith and microservices data are IDENTICAL.
async function migrate(db, { seedProducts = Number(process.env.SEED_PRODUCTS || 1000), seedStock = Number(process.env.SEED_STOCK || 1000000000) } = {}) {
  await db.query(SCHEMA);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM products');
  if (rows[0].n > 0) return;
  await db.query(
    `INSERT INTO products (sku, name, category, price, stock, description)
     SELECT 'SKU-' || lpad(n::text, 5, '0'),
            'TokoKu Product #' || n,
            ($1::text[])[1 + (n % ${CATEGORIES.length})],
            ((n * 7919) % 490 + 10) * 1000,
            $3,
            'Description of product #' || n || '. ' || repeat('Quality item, official warranty. ', 3)
     FROM generate_series(1, $2) AS n`,
    [CATEGORIES, seedProducts, seedStock],
  );
}

async function list(db, { page = 1, limit = 20, category } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(100, Math.max(1, Number(limit) || 20));
  const { rows } = await db.query(
    `SELECT id, sku, name, category, price, stock, description FROM products
     WHERE ($1::text IS NULL OR category = $1)
     ORDER BY id LIMIT $2 OFFSET $3`,
    [category || null, l, (p - 1) * l],
  );
  return { page: p, limit: l, items: rows };
}

async function get(db, id) {
  const { rows } = await db.query('SELECT id, sku, name, category, price, stock, description FROM products WHERE id = $1', [Number(id) || 0]);
  if (!rows[0]) throw new AppError(404, 'PRODUCT_NOT_FOUND', `Product ${id} not found`);
  return rows[0];
}

// Atomically decrements stock and returns a SNAPSHOT of name & price at transaction time.
// Must be called inside a DB transaction (db.tx).
// Items are sorted by id to prevent deadlocks between transactions.
async function reserve(tx, items) {
  const sorted = [...items].sort((a, b) => a.productId - b.productId);
  const lines = [];
  for (const { productId, qty } of sorted) {
    const { rows } = await tx.query(
      `UPDATE products SET stock = stock - $2, updated_at = now()
       WHERE id = $1 AND stock >= $2 RETURNING id, name, price`,
      [productId, qty],
    );
    if (!rows[0]) {
      const exists = await tx.query('SELECT 1 FROM products WHERE id = $1', [productId]);
      if (!exists.rows[0]) throw new AppError(404, 'PRODUCT_NOT_FOUND', `Product ${productId} not found`);
      throw new AppError(409, 'OUT_OF_STOCK', `Insufficient stock for product ${productId}`);
    }
    lines.push({ productId, name: rows[0].name, unitPrice: rows[0].price, qty });
  }
  return lines;
}

// Compensation: return the stock (e.g. when payment fails).
async function release(tx, items) {
  const sorted = [...items].sort((a, b) => a.productId - b.productId);
  for (const { productId, qty } of sorted) {
    await tx.query('UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1', [productId, qty]);
  }
}

module.exports = { CATEGORIES, migrate, list, get, reserve, release };
