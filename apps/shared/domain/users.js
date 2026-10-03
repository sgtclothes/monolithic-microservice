// DOMAIN: Users (registration & login)
// Password hashing (PBKDF2) is deliberately expensive -> the login endpoint is
// a real example of a CPU-BOUND workload. Used in the "noisy neighbor" scenario.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { AppError } = require('../errors');
const { signToken } = require('../auth');
const { loginsTotal } = require('../metrics');

const pbkdf2 = promisify(crypto.pbkdf2);
const ITERATIONS = Number(process.env.PASSWORD_HASH_ITERATIONS || 100000);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

async function hashPassword(password, iterations = ITERATIONS) {
  const salt = crypto.randomBytes(16);
  const hash = await pbkdf2(password, salt, iterations, 32, 'sha256');
  return `pbkdf2_sha256$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [, iterations, salt, hash] = stored.split('$');
  const calc = await pbkdf2(password, Buffer.from(salt, 'base64'), Number(iterations), 32, 'sha256');
  return crypto.timingSafeEqual(calc, Buffer.from(hash, 'base64'));
}

// Seed: user1@tokoku.test ... userN@tokoku.test, password: password123
async function migrate(db, { seedUsers = Number(process.env.SEED_USERS || 1000) } = {}) {
  await db.query(SCHEMA);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  const hash = await hashPassword('password123');
  await db.query(
    `INSERT INTO users (name, email, password_hash)
     SELECT 'Customer ' || n, 'user' || n || '@tokoku.test', $1 FROM generate_series(1, $2) AS n`,
    [hash, seedUsers],
  );
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email };
}

async function register(db, { name, email, password }) {
  if (!name || !email || !password || String(password).length < 6) {
    throw new AppError(400, 'VALIDATION', 'name, email, and password (min 6 characters) are required');
  }
  const hash = await hashPassword(String(password));
  try {
    const { rows } = await db.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [String(name), String(email).toLowerCase(), hash],
    );
    return publicUser(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new AppError(409, 'EMAIL_TAKEN', 'Email is already registered');
    throw err;
  }
}

async function login(db, { email, password }) {
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [String(email || '').toLowerCase()]);
  const user = rows[0];
  if (!user || !(await verifyPassword(String(password || ''), user.password_hash))) {
    loginsTotal.inc({ result: 'failed' });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  }
  loginsTotal.inc({ result: 'success' });
  return { token: signToken(user), user: publicUser(user) };
}

async function getById(db, id) {
  const { rows } = await db.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  return rows[0];
}

module.exports = { migrate, register, login, getById };
