// 4) SOAK TEST: moderate load over a long time to detect memory leaks,
//    leaked connections, or slow performance degradation.
//
//   ./scripts/demo.sh k6 soak mono RATE=50 DURATION=1h
//
// Watch the "Memory (RSS) per service" and "DB pool: waiting connections" panels. They should stay flat, not keep climbing.
import { buildOptions, setupTokens, shopper } from './lib/common.js';

const RATE = Number(__ENV.RATE || 50);

export const options = buildOptions('soak', {
  soak: {
    executor: 'constant-arrival-rate',
    exec: 'run',
    rate: RATE,
    timeUnit: '1s',
    duration: __ENV.DURATION || '1h',
    preAllocatedVUs: Math.min(RATE * 2, 300),
    maxVUs: Number(__ENV.MAX_VUS || 1000),
  },
});

export const setup = () => setupTokens();
export const run = (data) => shopper(data);
