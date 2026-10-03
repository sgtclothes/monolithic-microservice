const payments = require('../../shared/domain/payments');

module.exports = function createPaymentsModule({ db, thirdParty }) {
  return {
    charge: ({ orderId, amount }) => payments.charge(db, thirdParty.paymentGateway, { orderId, amount }),
  };
};
