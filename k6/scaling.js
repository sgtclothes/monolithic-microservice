// 6) SCALING TEST: heavy checkout load, then scale out WHILE the test is running.
//
//   Terminal 1:  ./scripts/demo.sh k6 scaling ms RATE=120
//   Terminal 2 (after ~1-2 minutes, once order-service is saturated):
//                ./scripts/demo.sh scale ms order-service 3
//
//   Compare with the monolith:
//   Terminal 1:  ./scripts/demo.sh k6 scaling mono RATE=120
//   Terminal 2:  ./scripts/demo.sh scale mono 2      (duplicates the WHOLE app)
//
// Watch: POST /orders latency drops, the replica count goes up, and so does the total
// CPU/memory used (Containers dashboard) -> work out RPS per core.
import { buildOptions, setupTokens, shopper } from './lib/common.js';

const RATE = Number(__ENV.RATE || 120);

export const options = buildOptions('scaling', {
  checkout_heavy: {
    executor: 'ramping-arrival-rate',
    exec: 'run',
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: 200,
    maxVUs: Number(__ENV.MAX_VUS || 2000),
    stages: [
      { target: RATE, duration: '30s' },
      { target: RATE, duration: __ENV.DURATION || '6m' },
      { target: 0, duration: '10s' },
    ],
  },
});

export const setup = () => setupTokens();
// Default 50% checkout (ORDER_RATIO) so the bottleneck sits in the order flow
const ORDER_RATIO = Number(__ENV.ORDER_RATIO || 0.5);
export const run = (data) => shopper(data, ORDER_RATIO);
