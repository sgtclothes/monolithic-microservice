const orders = require('../../shared/domain/orders');
const { requireAuth } = require('../../shared/auth');

module.exports = function createOrdersModule({ db }, { products, payments, notifications }) {
  // MONOLITH version of the "ports": every step is a function call in the same process.
  const ports = {
    // Decrement stock + create the order in ONE ACID transaction.
    // If the order insert fails, the database rolls back the stock automatically.
    reserveStockAndCreateOrder: (userId, lines) =>
      db.tx(async (tx) => {
        const snapshot = await products.reserveStock(tx, lines);
        return orders.insertOrder(tx, userId, snapshot);
      }),
    charge: (order) => payments.charge({ orderId: order.id, amount: order.total }),
    cancel: (order, lines, status) =>
      db.tx(async (tx) => {
        await products.releaseStock(tx, lines);
        await orders.setStatus(tx, order.id, status);
      }),
    markPaid: (order) => orders.setStatus(db, order.id, 'PAID'),
    notify: (msg) => notifications.notifyOrderPaid(msg),
  };

  return {
    routes(app) {
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
    },
  };
};
