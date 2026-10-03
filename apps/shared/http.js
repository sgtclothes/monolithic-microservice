const { AppError } = require('./errors');
const { outboundDuration } = require('./metrics');

const DEFAULT_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 5000);

// Calls another service / third party over HTTP+JSON.
// - Node's built-in fetch (undici) already uses keep-alive -> connections are reused.
// - Upstream errors (e.g. 409 out of stock) are passed through with the same status & code,
//   so the microservices behave exactly like the monolith from the client's point of view.
// - Timeout / connection failure -> 503 UPSTREAM_UNAVAILABLE.
async function callJson(target, method, url, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const end = outboundDuration.startTimer({ target, method });
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'timeout' : 'conn_error';
    end({ status: reason });
    throw new AppError(503, 'UPSTREAM_UNAVAILABLE', `${target} is unreachable (${reason})`);
  }

  const text = await res.text();
  end({ status: String(res.status) });
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = data && data.error;
    throw new AppError(res.status, (e && e.code) || 'UPSTREAM_ERROR', (e && e.message) || `${target} responded with ${res.status}`);
  }
  return data;
}

module.exports = { callJson };
