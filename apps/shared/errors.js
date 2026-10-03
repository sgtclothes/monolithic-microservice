const log = require('./logger');

// Business error with an HTTP status. Used identically by the monolith and the
// microservices, so error responses to clients are the same in both architectures.
class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    if (err.status >= 500) log.warn('request failed', { path: req.path, code: err.code, err: err.message });
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } });
  }
  log.error('unhandled error', { path: req.path, err: err.message, stack: err.stack });
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}

module.exports = { AppError, errorHandler };
