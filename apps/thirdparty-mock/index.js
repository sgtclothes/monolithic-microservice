// =====================================================================
//  thirdparty-mock: simulated THIRD-PARTY services used by both architectures
//   - Payment Gateway  POST /payments/charge   (default delay 100-300ms)
//   - Email Provider   POST /email/send        (default delay 20-60ms)
//
//  Their behavior can be changed during the demo (fault injection) via:
//   - Web panel        : http://localhost:4000
//   - API              : POST /admin/config  {"payment":{...},"email":{...}}
//   - Preset           : POST /admin/preset/:name  (normal, payment-slow, payment-flaky, email-down, email-slow)
// =====================================================================
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const client = require('prom-client');

client.register.setDefaultLabels({ service: 'thirdparty-mock', arch: 'external' });
client.collectDefaultMetrics();

const requests = new client.Counter({
  name: 'thirdparty_requests_total',
  help: 'Requests to the (simulated) third-party services',
  labelNames: ['api', 'result'],
});
const latency = new client.Histogram({
  name: 'thirdparty_latency_seconds',
  help: 'Latency simulated by the third party',
  labelNames: ['api'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5, 10],
});

const PRESETS = {
  normal: {
    payment: { minDelayMs: 100, maxDelayMs: 300, failRate: 0, declineRate: 0 },
    email: { minDelayMs: 20, maxDelayMs: 60, failRate: 0, down: false },
  },
  'payment-slow': { payment: { minDelayMs: 2000, maxDelayMs: 3000 } },
  'payment-flaky': { payment: { failRate: 0.3 } },
  'email-down': { email: { down: true } },
  'email-slow': { email: { minDelayMs: 1500, maxDelayMs: 2500 } },
};

let config = structuredClone(PRESETS.normal);

function applyConfig(patch, base = config) {
  return {
    payment: { ...base.payment, ...(patch.payment || {}) },
    email: { ...base.email, ...(patch.email || {}) },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = ({ minDelayMs, maxDelayMs }) => minDelayMs + Math.random() * Math.max(0, maxDelayMs - minDelayMs);

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// ==== Payment Gateway ====
app.post('/payments/charge', async (req, res) => {
  const cfg = config.payment;
  const end = latency.startTimer({ api: 'payment' });
  await sleep(randomDelay(cfg));
  end();
  if (Math.random() < cfg.failRate) {
    requests.inc({ api: 'payment', result: 'error' });
    return res.status(503).json({ error: { code: 'GATEWAY_UNAVAILABLE', message: 'Payment gateway is experiencing an outage' } });
  }
  if (Math.random() < cfg.declineRate) {
    requests.inc({ api: 'payment', result: 'declined' });
    return res.json({ status: 'DECLINED', reason: 'insufficient_funds' });
  }
  requests.inc({ api: 'payment', result: 'success' });
  res.json({ status: 'SUCCESS', reference: 'PG-' + crypto.randomUUID(), order_id: req.body.order_id, amount: req.body.amount });
});

// ==== Email Provider ====
let emailsSent = 0;
app.post('/email/send', async (req, res) => {
  const cfg = config.email;
  if (cfg.down) {
    // Simulate a dead provider: wait briefly, then fail (like a refused connection / 503).
    await sleep(50);
    requests.inc({ api: 'email', result: 'down' });
    return res.status(503).json({ error: { code: 'EMAIL_PROVIDER_DOWN', message: 'Email provider is unavailable' } });
  }
  const end = latency.startTimer({ api: 'email' });
  await sleep(randomDelay(cfg));
  end();
  if (Math.random() < cfg.failRate) {
    requests.inc({ api: 'email', result: 'error' });
    return res.status(503).json({ error: { code: 'EMAIL_SEND_FAILED', message: 'Failed to send email' } });
  }
  emailsSent++;
  requests.inc({ api: 'email', result: 'success' });
  res.json({ accepted: true, id: crypto.randomUUID(), to: req.body.to });
});

// ==== Admin / Chaos control ====
app.get('/admin/config', (req, res) => res.json({ config, presets: Object.keys(PRESETS), emailsSent }));
app.post('/admin/config', (req, res) => {
  config = applyConfig(req.body || {});
  console.log(JSON.stringify({ t: new Date().toISOString(), msg: 'config updated', config }));
  res.json({ config });
});
app.post('/admin/preset/:name', (req, res) => {
  const preset = PRESETS[req.params.name];
  if (!preset) return res.status(404).json({ error: { code: 'UNKNOWN_PRESET', message: `Available presets: ${Object.keys(PRESETS).join(', ')}` } });
  // Presets always start from the normal state so they do not stack.
  config = applyConfig(preset, structuredClone(PRESETS.normal));
  console.log(JSON.stringify({ t: new Date().toISOString(), msg: 'preset applied', preset: req.params.name }));
  res.json({ preset: req.params.name, config });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'panel.html')));

const port = Number(process.env.PORT || 4000);
const server = app.listen(port, () => console.log(`thirdparty-mock listening on :${port}`));
server.keepAliveTimeout = 65_000;
process.once('SIGTERM', () => server.close(() => process.exit(0)));
