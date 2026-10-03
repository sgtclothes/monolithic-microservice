// 3) SPIKE TEST: a sudden 10x jump within 10 seconds (mimics a FLASH SALE).
//
//   ./scripts/demo.sh k6 spike mono BASE_RATE=30 SPIKE_RATE=300
//   ./scripts/demo.sh k6 spike ms   BASE_RATE=30 SPIKE_RATE=300 HOT_PRODUCTS=5 ORDER_RATIO=0.4
//
// Questions: does the system survive? How long does it take to recover once the spike is over?
import { buildOptions, setupTokens, shopper } from './lib/common.js';

const BASE = Number(__ENV.BASE_RATE || 30);
const SPIKE = Number(__ENV.SPIKE_RATE || BASE * 10);

export const options = buildOptions('spike', {
  spike: {
    executor: 'ramping-arrival-rate',
    exec: 'run',
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: 200,
    maxVUs: Number(__ENV.MAX_VUS || 2000),
    stages: [
      { target: BASE, duration: '20s' },
      { target: BASE, duration: '1m' }, // normal
      { target: SPIKE, duration: '10s' }, // 10x SPIKE within 10 seconds
      { target: SPIKE, duration: __ENV.SPIKE_DURATION || '1m' }, // hold
      { target: BASE, duration: '10s' }, // ease off
      { target: BASE, duration: '1m30s' }, // recovery phase
      { target: 0, duration: '10s' },
    ],
  },
});

export const setup = () => setupTokens();
export const run = (data) => shopper(data);
