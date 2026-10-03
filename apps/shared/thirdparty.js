const { callJson } = require('./http');

// Client for THIRD-PARTY services (simulated by the thirdparty-mock container):
// - Payment Gateway  : 100-300ms latency (adjustable during the demo)
// - Email Provider   : low latency, can be taken "down" for fault tests
// Both architectures use exactly the same third party -> a fair comparison.
function createThirdPartyClient(baseUrl = process.env.THIRDPARTY_URL || 'http://thirdparty-mock:4000') {
  return {
    paymentGateway: {
      charge: ({ orderId, amount }) =>
        callJson('payment-gateway', 'POST', `${baseUrl}/payments/charge`, { order_id: orderId, amount }),
    },
    emailProvider: {
      send: ({ to, subject, body }) => callJson('email-provider', 'POST', `${baseUrl}/email/send`, { to, subject, body }),
    },
  };
}

module.exports = { createThirdPartyClient };
