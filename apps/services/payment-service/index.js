// =====================================================================
//  payment-service: processes payments through a third-party Payment Gateway
//  Database: payment_db (payments table only)
// =====================================================================
const { runService } = require('../../shared/service');
const payments = require('../../shared/domain/payments');
const { createThirdPartyClient } = require('../../shared/thirdparty');

runService({
  service: 'payment-service',
  domains: ['payments'],
  setup({ app, db }) {
    const { paymentGateway } = createThirdPartyClient();

    // ==== Internal API (called by order-service) ====
    // Body: { order_id, amount } -> payment { id, status: SUCCESS|DECLINED|ERROR, ... }
    app.post('/internal/payments', async (req, res) => {
      const { order_id: orderId, amount } = req.body || {};
      res.status(201).json(await payments.charge(db, paymentGateway, { orderId, amount }));
    });
  },
});
