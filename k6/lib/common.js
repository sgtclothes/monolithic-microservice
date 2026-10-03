// Shared helpers for every k6 scenario.
// Every request gets a `name` tag (per endpoint) plus the global `arch` and `test` tags
// so results can be split in Grafana and in the final summary.
import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8081/api').replace(/\/$/, '');
export const MOCK_URL = (__ENV.MOCK_URL || 'http://localhost:4000').replace(/\/$/, '');
export const ARCH = __ENV.ARCH || (/8082|gateway-ms|30082|microservices/.test(BASE_URL) ? 'microservices' : 'monolith');
const PRODUCT_COUNT = Number(__ENV.PRODUCT_COUNT || 1000);
// HOT_PRODUCTS=5 -> every order goes to the first 5 products only (simulates a flash sale / row lock contention)
const HOT_PRODUCTS = Number(__ENV.HOT_PRODUCTS || 0);
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const rand = (n) => Math.floor(Math.random() * n);

export function buildOptions(testName, scenarios, extraThresholds = {}) {
  return {
    scenarios,
    tags: { arch: ARCH, test: testName },
    // The `url` tag is deliberately left out: /products/1..1000 would turn into thousands of
    // time series in Prometheus. Grouping per endpoint uses the `name` tag instead.
    systemTags: ['status', 'method', 'name', 'group', 'check', 'error_code', 'scenario', 'expected_response'],
    summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
    thresholds: {
      // SLO targets (they may be breached; that is exactly what we want to see in a stress test)
      http_req_failed: ['rate<0.01'],
      'http_req_duration{name:GET /products}': ['p(95)<500'],
      'http_req_duration{name:GET /products/:id}': ['p(95)<500'],
      'http_req_duration{name:POST /orders}': ['p(95)<1500'],
      'http_req_duration{name:POST /users/login}': ['p(95)<1000'],
      'http_req_failed{name:POST /orders}': ['rate<0.01'],
      'http_req_failed{name:GET /products}': ['rate<0.01'],
      ...extraThresholds,
    },
  };
}

// Called once in setup(): logs in a few seed users to get tokens.
export function setupTokens(n = Number(__ENV.USERS || 30)) {
  const info = http.get(`${BASE_URL}/info`, { tags: { name: 'setup' } });
  console.log(`Target: ${BASE_URL} | architecture: ${ARCH} | /info: ${info.body}`);
  const tokens = [];
  for (let i = 1; i <= n; i++) {
    const res = http.post(`${BASE_URL}/users/login`, JSON.stringify({ email: `user${i}@tokoku.test`, password: 'password123' }), {
      headers: JSON_HEADERS,
      tags: { name: 'setup' },
    });
    if (res.status === 200) tokens.push(res.json('token'));
  }
  if (tokens.length === 0) throw new Error(`Login to ${BASE_URL} failed. Make sure the app is running.`);
  return { tokens };
}

function randomProductId() {
  return 1 + rand(HOT_PRODUCTS > 0 ? HOT_PRODUCTS : PRODUCT_COUNT);
}

export function browseProducts() {
  const res = http.get(`${BASE_URL}/products?page=${1 + rand(20)}&limit=20`, { tags: { name: 'GET /products' } });
  check(res, { 'GET /products 200': (r) => r.status === 200 });
}

export function viewProduct() {
  const res = http.get(`${BASE_URL}/products/${randomProductId()}`, { tags: { name: 'GET /products/:id' } });
  check(res, { 'GET /products/:id 200': (r) => r.status === 200 });
}

export function placeOrder(data) {
  const token = data.tokens[rand(data.tokens.length)];
  const items = [{ product_id: randomProductId(), qty: 1 + rand(2) }];
  if (Math.random() < 0.5) items.push({ product_id: randomProductId(), qty: 1 });
  const res = http.post(`${BASE_URL}/orders`, JSON.stringify({ items }), {
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
    tags: { name: 'POST /orders' },
  });
  check(res, { 'POST /orders 201': (r) => r.status === 201 });
}

export function login() {
  const res = http.post(`${BASE_URL}/users/login`, JSON.stringify({ email: `user${1 + rand(1000)}@tokoku.test`, password: 'password123' }), {
    headers: JSON_HEADERS,
    tags: { name: 'POST /users/login' },
  });
  check(res, { 'POST /users/login 200': (r) => r.status === 200 });
}

// A realistic (read-heavy) mix of shopper behavior:
//   60% browse the catalog, 25% view a product, 15% checkout
// ORDER_RATIO can be changed, e.g. ORDER_RATIO=0.5 for a checkout-heavy load.
const ORDER_RATIO = Number(__ENV.ORDER_RATIO || 0.15);
export function shopper(data, orderRatio = ORDER_RATIO) {
  const r = Math.random();
  if (r < orderRatio) placeOrder(data);
  else if (r < orderRatio + (1 - orderRatio) * 0.3) viewProduct();
  else browseProducts();
}

// Fault injection through the third-party panel (thirdparty-mock)
export function setChaos(preset) {
  const res = http.post(`${MOCK_URL}/admin/preset/${preset}`, null, { tags: { name: 'chaos' } });
  console.log(`[chaos] preset "${preset}" -> HTTP ${res.status}`);
}
