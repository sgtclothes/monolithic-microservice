// =====================================================================
//  product-service: product catalog (read-heavy) + stock management
//  Database: product_db (products table only)
//
//  /internal/* endpoints are NOT exposed through the gateway; they are only
//  called by other services (order-service) on the internal network.
// =====================================================================
const { runService } = require('../../shared/service');
const products = require('../../shared/domain/products');

runService({
  service: 'product-service',
  domains: ['products'],
  setup({ app, db }) {
    // ==== Public API ====
    app.get('/api/products', async (req, res) => {
      res.json(await products.list(db, req.query));
    });
    app.get('/api/products/:id', async (req, res) => {
      res.json(await products.get(db, req.params.id));
    });

    // ==== Internal API (called by order-service) ====
    // Body: { items: [{productId, qty}] } -> { lines: [{productId, name, unitPrice, qty}] }
    app.post('/internal/stock/reserve', async (req, res) => {
      const lines = await db.tx((tx) => products.reserve(tx, req.body.items || []));
      res.json({ lines });
    });
    app.post('/internal/stock/release', async (req, res) => {
      await db.tx((tx) => products.release(tx, req.body.items || []));
      res.json({ released: true });
    });
  },
});
