const { createApp, finalize, listen } = require('../shared/server');
const { createDb } = require('../shared/db');
const { createThirdPartyClient } = require('../shared/thirdparty');

function start(config) {
  // ONE connection pool shared by every module.
  const db = createDb({ connectionString: config.databaseUrl, max: config.poolMax });
  const thirdParty = createThirdPartyClient();
  const ctx = { db, thirdParty, config };

  // Modular monolith: modules are cleanly separated in code, but deployed as a single unit.
  const users = require('./modules/users')(ctx);
  const products = require('./modules/products')(ctx);
  const payments = require('./modules/payments')(ctx);
  const notifications = require('./modules/notifications')(ctx);
  const orders = require('./modules/orders')(ctx, { products, payments, notifications });

  const app = createApp({ service: config.service, healthCheck: () => db.ping() });
  for (const m of [users, products, orders, notifications]) m.routes(app);
  finalize(app);

  listen(app, config.port, () => db.end());
}

module.exports = { start };
