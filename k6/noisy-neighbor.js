// 5b) NOISY NEIGHBOR TEST: failure and resource isolation.
//
//   ./scripts/demo.sh k6 noisy-neighbor mono
//   ./scripts/demo.sh k6 noisy-neighbor ms
//
// Two groups of users run at the same time:
//   * "browsers"    : light, steady load on GET /products
//   * "login_storm" : from second 60, hundreds of logins/sec (password hashing = CPU-bound)
//
// Monolith      : one process shares its CPU -> GET /products gets slow TOO.
// Microservices : only user-service saturates -> GET /products (product-service) stays fast,
//                 but logins fail much earlier because user-service only has 0.3 CPU.
import { buildOptions, setupTokens, browseProducts, login } from './lib/common.js';

// LOGIN_RATE must be ABOVE the monolith's login capacity (about 2 cores / hash time),
// otherwise the monolith absorbs the storm and nothing visible happens.
// 250/s saturates 2 cores on a fast CPU (~15ms per hash). Lower it on slow VPSs if needed.
const LOGIN_RATE = Number(__ENV.LOGIN_RATE || 250);

export const options = buildOptions('noisy-neighbor', {
  browsers: {
    executor: 'constant-arrival-rate',
    exec: 'browse',
    rate: Number(__ENV.BROWSE_RATE || 50),
    timeUnit: '1s',
    duration: '4m',
    preAllocatedVUs: 50,
    maxVUs: 500,
  },
  login_storm: {
    executor: 'ramping-arrival-rate',
    exec: 'storm',
    startTime: '60s',
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: 100,
    maxVUs: Number(__ENV.MAX_VUS || 1000),
    stages: [
      { target: LOGIN_RATE, duration: '20s' },
      { target: LOGIN_RATE, duration: '1m30s' },
      { target: 0, duration: '10s' },
    ],
  },
});

export const setup = () => setupTokens(1);
export const browse = () => browseProducts();
export const storm = () => login();
