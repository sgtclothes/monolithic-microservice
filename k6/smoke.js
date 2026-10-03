// SMOKE TEST: quick check that every endpoint works before the demo.
//   ./scripts/demo.sh k6 smoke mono
//   ./scripts/demo.sh k6 smoke mono ITERATIONS=20
import { buildOptions, setupTokens, browseProducts, viewProduct, placeOrder, login } from './lib/common.js';

const ITERATIONS = Number(__ENV.ITERATIONS || 5);

export const options = buildOptions('smoke', {
  smoke: { executor: 'per-vu-iterations', vus: 1, iterations: ITERATIONS, exec: 'run' },
});

export const setup = () => setupTokens(3);

export function run(data) {
  browseProducts();
  viewProduct();
  login();
  placeOrder(data);
}
