// =====================================================================
//  user-service: registration, login (CPU-bound: password hashing), profile
//  Database: user_db (users table only)
// =====================================================================
const { runService } = require('../../shared/service');
const users = require('../../shared/domain/users');
const { requireAuth } = require('../../shared/auth');

runService({
  service: 'user-service',
  domains: ['users'],
  setup({ app, db }) {
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
});
