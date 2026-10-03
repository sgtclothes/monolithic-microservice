// 2) STRESS TEST: raise the load step by step until the system BREAKS (breaking point).
//
//   ./scripts/demo.sh k6 stress mono  START_RATE=50 STEP=50 MAX_RATE=600 STEP_DURATION=1m
//
// Watch Grafana for the moment the phase changes:
//   linear -> saturation (latency creeps up) -> breaking (latency spikes, errors rise) -> collapse
// Breaking point = the RPS at which p95 exceeds the SLO or the error rate goes above 1%.
import { buildOptions, setupTokens, shopper } from './lib/common.js';

const START = Number(__ENV.START_RATE || 50);
const STEP = Number(__ENV.STEP || 50);
const MAX = Number(__ENV.MAX_RATE || 600);
const STEP_DURATION = __ENV.STEP_DURATION || '1m';

const stages = [{ target: START, duration: '20s' }];
for (let rate = START; rate <= MAX; rate += STEP) {
  if (rate > START) stages.push({ target: rate, duration: '10s' }); // ramp up
  stages.push({ target: rate, duration: STEP_DURATION }); // hold at this level
}
stages.push({ target: 0, duration: '20s' });

const abort = __ENV.ABORT_ON_FAIL === 'true';

export const options = buildOptions(
  'stress',
  {
    stress: {
      executor: 'ramping-arrival-rate',
      exec: 'run',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: Number(__ENV.MAX_VUS || 2000),
      stages,
    },
  },
  // ABORT_ON_FAIL=true -> stop the test automatically once the error rate is > 10% (already collapsed)
  abort ? { 'http_req_failed{scenario:stress}': [{ threshold: 'rate<0.10', abortOnFail: true, delayAbortEval: '30s' }] } : {},
);

export const setup = () => setupTokens();
export const run = (data) => shopper(data);
