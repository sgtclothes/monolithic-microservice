const users = require('../../shared/domain/users');
const { requireAuth } = require('../../shared/auth');

module.exports = function createUsersModule({ db }) {
  return {
    routes(app) {
      app.post('/api/users/register', async (req, res) => {
        res.status(201).json(await users.register(db, req.body || {}));
      });
      app.post('/api/users/login', async (req, res) => {
        res.json(await users.login(db, req.body || {}));
      });
      app.get('/api/users/me', requireAuth, async (req, res) => {
        res.json(await users.getById(db, req.user.id));
      });
    },
  };
};
