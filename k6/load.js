// 1) LOAD TEST: steady "normal" load to get a BASELINE.
//
//   ./scripts/demo.sh k6 load mono  RATE=100 DURATION=3m
//   ./scripts/demo.sh k6 load ms    RATE=100 DURATION=3m
//
// "Open" model (arrival-rate): k6 sends RATE requests/sec no matter what happens
// on the server, just like real users who do not care that the server is slow.
import { buildOptions, setupTokens, shopper } from './lib/common.js';

const RATE = Number(__ENV.RATE || 100);

export const options = buildOptions('load', {
  shoppers: {
    executor: 'ramping-arrival-rate',
    exec: 'run',
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: Math.min(RATE, 200),
    maxVUs: Number(__ENV.MAX_VUS || 1000),
    stages: [
      { target: RATE, duration: __ENV.WARMUP || '30s' }, // warm-up (discard this data when analyzing)
      { target: RATE, duration: __ENV.DURATION || '3m' }, // steady load
      { target: 0, duration: '10s' }, // cooldown
    ],
  },
});

export const setup = () => setupTokens();
export const run = (data) => shopper(data);
