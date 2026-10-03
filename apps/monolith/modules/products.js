const products = require('../../shared/domain/products');

module.exports = function createProductsModule({ db }) {
  return {
    // Internal module API -> called by the orders module via function call (no network).
    reserveStock: (tx, items) => products.reserve(tx, items),
    releaseStock: (tx, items) => products.release(tx, items),

    routes(app) {
      app.get('/api/products', async (req, res) => {
        res.json(await products.list(db, req.query));
      });
      app.get('/api/products/:id', async (req, res) => {
        res.json(await products.get(db, req.params.id));
      });
    },
  };
};
