const crypto = require('node:crypto');
const { AppError } = require('./errors');

// Simple JWT-style token (payload.signature, HMAC-SHA256).
// Because it is stateless, order-service only needs to verify the signature with
// the same secret. It does NOT need to call user-service on every request.
const SECRET = process.env.JWT_SECRET || 'tokoku-demo-secret';
const TTL_SECONDS = 24 * 3600;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function signToken(user) {
  const payload = b64(JSON.stringify({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS }));
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (data.exp < Date.now() / 1000) return null;
  return { id: data.sub, email: data.email };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const user = verifyToken(header.replace(/^Bearer\s+/i, ''));
  if (!user) return next(new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
  req.user = user;
  next();
}

module.exports = { signToken, verifyToken, requireAuth };
