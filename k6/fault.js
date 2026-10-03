// 5) FAULT INJECTION TEST: one dependency fails in the middle of the load.
//
//   ./scripts/demo.sh k6 fault mono FAULT=email-down
//   ./scripts/demo.sh k6 fault ms   FAULT=email-down
//   ./scripts/demo.sh k6 fault ms   FAULT=payment-slow
//
// Timeline (default):
//   0s: normal load | 60s: FAULT enabled | 150s: back to normal | 240s: done
//
// Available faults (thirdparty-mock presets): email-down, email-slow, payment-slow, payment-flaky
// To "kill a service" directly (instead of a third party), run this by hand while the test is running:
//   docker compose -f docker-compose.microservices.yml stop notification-service
import { sleep } from 'k6';
import { buildOptions, setupTokens, shopper, setChaos } from './lib/common.js';

const FAULT = __ENV.FAULT || 'email-down';
const FAULT_AT = Number(__ENV.FAULT_AT || 60);
const FAULT_FOR = Number(__ENV.FAULT_FOR || 90);
const TOTAL = FAULT_AT + FAULT_FOR + Number(__ENV.RECOVERY || 90);
const RATE = Number(__ENV.RATE || 50);

export const options = buildOptions(`fault-${FAULT}`, {
  shoppers: {
    executor: 'constant-arrival-rate',
    exec: 'run',
    rate: RATE,
    timeUnit: '1s',
    duration: `${TOTAL}s`,
    preAllocatedVUs: 100,
    maxVUs: Number(__ENV.MAX_VUS || 1000),
  },
  chaos: {
    executor: 'per-vu-iterations',
    exec: 'chaos',
    vus: 1,
    iterations: 1,
    maxDuration: `${TOTAL + 30}s`,
  },
});

export const setup = () => {
  setChaos('normal');
  return setupTokens();
};
export const run = (data) => shopper(data);

export function chaos() {
  sleep(FAULT_AT);
  setChaos(FAULT);
  sleep(FAULT_FOR);
  setChaos('normal');
}

export const teardown = () => setChaos('normal');
