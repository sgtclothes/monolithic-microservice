#!/usr/bin/env node
// Reads k6 results (k6/results/*.json from --summary-export) and prints a
// Markdown comparison table, ready to paste into slides or a report.
//
//   node scripts/compare-results.js            # all results
//   node scripts/compare-results.js load       # only files whose name contains "load"
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'k6', 'results');
const filter = process.argv[2] || '';
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f.includes(filter)).sort() : [];

if (files.length === 0) {
  console.log(`No results in ${dir} yet. Run this first: ./scripts/demo.sh k6 load mono`);
  process.exit(0);
}

const ms = (v) => (v === undefined ? '-' : `${Math.round(v * 1) / 1}`);
const pct = (v) => (v === undefined ? '-' : `${(v * 100).toFixed(2)}%`);

const rows = files.map((file) => {
  const m = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).metrics || {};
  const [, date, time, arch, ...rest] = file.replace('.json', '').match(/^(\d{8})-(\d{6})-([a-z]+)-(.*)$/) || [];
  const d = m.http_req_duration || {};
  const sub = (name) => m[`http_req_duration{name:${name}}`] || {};
  return {
    run: date ? `${date.slice(4, 6)}/${date.slice(6)} ${time.slice(0, 2)}:${time.slice(2, 4)}` : file,
    arch: arch || '?',
    test: rest.join('-') || '?',
    rps: m.http_reqs ? m.http_reqs.rate.toFixed(1) : '-',
    err: pct(m.http_req_failed && m.http_req_failed.value),
    p50: ms(d.med),
    p95: ms(d['p(95)']),
    p99: ms(d['p(99)']),
    products: ms(sub('GET /products')['p(95)']),
    orders: ms(sub('POST /orders')['p(95)']),
    login: ms(sub('POST /users/login')['p(95)']),
  };
});

const cols = [
  ['run', 'Time'],
  ['test', 'Scenario'],
  ['arch', 'Architecture'],
  ['rps', 'RPS'],
  ['err', 'Error'],
  ['p50', 'p50 (ms)'],
  ['p95', 'p95 (ms)'],
  ['p99', 'p99 (ms)'],
  ['products', 'p95 GET /products'],
  ['orders', 'p95 POST /orders'],
  ['login', 'p95 login'],
];
console.log('| ' + cols.map((c) => c[1]).join(' | ') + ' |');
console.log('|' + cols.map(() => '---').join('|') + '|');
for (const r of rows) console.log('| ' + cols.map(([k]) => r[k]).join(' | ') + ' |');
console.log('\nNote: latency is measured on the client side (k6), including the gateway. Repeat each scenario >= 3x and take the median.');
