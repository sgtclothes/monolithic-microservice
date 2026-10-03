#!/usr/bin/env bash
# =====================================================================
#  TokoKu demo helper: one entry point for every demo step.
#  Run it from the repo root:  ./scripts/demo.sh help
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: do not rewrite paths like /scripts

INFRA="docker compose -f docker-compose.infra.yml"
MONO="docker compose -f docker-compose.monolith.yml"
MS="docker compose -f docker-compose.microservices.yml"

c_info() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
c_warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }

arch_compose() {
  case "${1:-}" in
    mono | monolith) echo "$MONO" ;;
    ms | micro | microservices) echo "$MS" ;;
    *) echo "Architecture must be 'mono' or 'ms'" >&2; exit 1 ;;
  esac
}

arch_url() {
  case "$1" in
    mono | monolith) echo "http://gateway-mono/api" ;;
    ms | micro | microservices) echo "http://gateway-ms/api" ;;
  esac
}

arch_name() {
  case "$1" in
    mono | monolith) echo "monolith" ;;
    *) echo "microservices" ;;
  esac
}

wait_http() {
  # 127.0.0.1 instead of localhost: on Docker Desktop (Windows/macOS) the IPv6 ::1 port
  # forwarding can stall under heavy load while the app itself is fine.
  local url=${1/localhost/127.0.0.1} name=$2 code last=""
  printf 'Waiting for %s to be ready' "$name"
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null) || true
    if [[ $code == 2* ]]; then echo ' OK'; return 0; fi
    last=$code
    printf '.'; sleep 2
  done
  echo
  c_warn "$name is not responding at $url yet (last HTTP status: ${last:-none}, 000 = no connection/timeout)"
  c_warn "The container may still be fine: check 'docker compose -f docker-compose.<mono|microservices>.yml logs' and Grafana."
}

cmd_up() {
  local what=${1:-all}
  # Network shared by all three compose projects (infra, mono, ms)
  docker network inspect tokoku >/dev/null 2>&1 || docker network create tokoku >/dev/null
  if [[ $what == all || $what == infra ]]; then
    c_info "Starting infra (Prometheus, Grafana, cAdvisor, thirdparty-mock)"
    $INFRA up -d --build
  fi
  if [[ $what == all || $what == mono ]]; then
    c_info "Starting the MONOLITH architecture (http://localhost:8081)"
    $MONO up -d --build
    wait_http "http://localhost:${MONO_PORT:-8081}/api/products?limit=1" "monolith"
  fi
  if [[ $what == all || $what == ms ]]; then
    c_info "Starting the MICROSERVICES architecture (http://localhost:8082)"
    $MS up -d --build
    wait_http "http://localhost:${MS_PORT:-8082}/api/products?limit=1" "microservices"
  fi
  cmd_urls
}

cmd_urls() {
  cat <<EOF

  Storefront monolith      : http://localhost:${MONO_PORT:-8081}
  Storefront microservices : http://localhost:${MS_PORT:-8082}
  Grafana                  : http://localhost:3000   (admin / ${GRAFANA_PASSWORD:-tokoku})
  Prometheus               : http://localhost:9090
  cAdvisor                 : http://localhost:8080
  Chaos panel (3rd party)  : http://localhost:4000
  RabbitMQ management      : http://localhost:15672  (tokoku / tokoku)
EOF
}

cmd_only() {
  # Only one architecture running -> no fighting over CPU during tests
  case "$1" in
    mono) $MS stop; $MONO up -d ;;
    ms) $MONO stop; $MS up -d ;;
    *) echo "usage: only mono|ms"; exit 1 ;;
  esac
}

cmd_down() {
  local what=${1:-all} flag=${2:-}
  [[ $what == all || $what == ms ]] && $MS down $flag
  [[ $what == all || $what == mono ]] && $MONO down $flag
  [[ $what == all || $what == infra ]] && $INFRA down $flag
  return 0
}

cmd_k6() {
  local test=${1:?scenario name, e.g. load|stress|spike|soak|fault|noisy-neighbor|scaling|smoke}
  local arch=${2:?mono|ms}
  shift 2
  local envs=() kv
  for kv in "$@"; do envs+=(-e "$kv"); done
  local stamp result
  stamp=$(date +%Y%m%d-%H%M%S)
  result="results/${stamp}-$(arch_name "$arch")-${test}.json"
  c_info "k6 $test -> $(arch_name "$arch")  (result: k6/$result)"

  if [[ -n ${TARGET_HOST:-} ]]; then
    # SEPARATE MACHINE mode: k6 runs on this machine and hits the target VPS through its public ports.
    #   TARGET_HOST=203.0.113.10 ./scripts/demo.sh k6 load mono
    local port=${MONO_PORT:-8081}
    [[ $arch == ms* ]] && port=${MS_PORT:-8082}
    mkdir -p k6/results
    docker run --rm -i --user 0 -v "$PWD/k6:/scripts" -w /scripts \
      -e K6_PROMETHEUS_RW_SERVER_URL="http://$TARGET_HOST:9090/api/v1/write" \
      -e K6_PROMETHEUS_RW_TREND_STATS="p(50),p(95),p(99),avg,max" \
      -e K6_PROMETHEUS_RW_PUSH_INTERVAL=5s \
      grafana/k6:1.1.0 run \
      --out experimental-prometheus-rw \
      --summary-export "$result" \
      -e BASE_URL="http://$TARGET_HOST:$port/api" \
      -e MOCK_URL="http://$TARGET_HOST:4000" \
      -e ARCH="$(arch_name "$arch")" \
      -e TEST_NAME="$test" \
      ${envs[@]+"${envs[@]}"} \
      "${test}.js"
    return
  fi

  $INFRA run --rm k6 run \
    --out experimental-prometheus-rw \
    --summary-export "$result" \
    -e BASE_URL="$(arch_url "$arch")" \
    -e ARCH="$(arch_name "$arch")" \
    -e TEST_NAME="$test" \
    ${envs[@]+"${envs[@]}"} \
    "${test}.js"
}

cmd_scale() {
  # scale mono 3                    -> 3 monolith replicas
  # scale ms order-service 3        -> 3 order-service replicas only
  local arch=${1:?mono|ms}
  local compose; compose=$(arch_compose "$arch")
  if [[ $arch == mono* ]]; then
    local n=${2:?replica count}
    c_info "Scale out MONOLITH -> $n replicas (duplicates the WHOLE app)"
    $compose up -d --no-recreate --scale monolith="$n" monolith
  else
    local svc=${2:?service name} n=${3:?replica count}
    c_info "Scale out $svc -> $n replicas (other services stay the same)"
    $compose up -d --no-recreate --scale "$svc=$n" "$svc"
  fi
  sleep 2; cmd_ps "$arch"
}

cmd_scale_up() {
  # scale-up 4 4   -> monolith with 4 CPUs, 4 workers (the container is recreated, so expect downtime!)
  local cpus=${1:?CPU count} workers=${2:-$1}
  c_warn "Scale UP monolith -> ${cpus} CPU, ${workers} workers. The container will restart (watch for errors in k6/Grafana)."
  MONO_CPUS=$cpus MONO_WORKERS=$workers $MONO up -d monolith
  wait_http "http://localhost:${MONO_PORT:-8081}/api/products?limit=1" "monolith"
}

cmd_chaos() {
  local preset=${1:?normal|email-down|email-slow|payment-slow|payment-flaky}
  curl -fsS -X POST "http://localhost:4000/admin/preset/$preset"; echo
}

cmd_kill() {
  local arch=${1:?mono|ms} svc=${2:?service name}
  $(arch_compose "$arch") stop "$svc"
}

cmd_revive() {
  local arch=${1:?mono|ms} svc=${2:?service name}
  $(arch_compose "$arch") start "$svc"
}

cmd_reset_db() {
  local arch=${1:?mono|ms}
  local db_service=postgres-mono
  [[ $arch == mono* ]] || db_service=postgres-ms
  if ! $(arch_compose "$arch") ps --status running --services 2>/dev/null | grep -qx "$db_service"; then
    c_warn "$(arch_name "$arch") is not running, so its database cannot be reset."
    c_warn "Start it first:  ./scripts/demo.sh only $arch   (or: ./scripts/demo.sh up $arch)"
    exit 1
  fi
  c_info "Resetting $(arch_name "$arch") transaction data (orders, payments, notifications, stock)"
  # Each -c runs as its own statement: VACUUM is not allowed inside a transaction block,
  # and several statements in a single -c would run as one implicit transaction.
  if [[ $arch == mono* ]]; then
    $MONO exec -T postgres-mono psql -q -v ON_ERROR_STOP=1 -U tokoku -d tokoku \
      -c "TRUNCATE order_items, orders, payments, notifications RESTART IDENTITY" \
      -c "UPDATE products SET stock = 1000000000" \
      -c "VACUUM ANALYZE"
  else
    $MS exec -T postgres-ms psql -q -v ON_ERROR_STOP=1 -U postgres -d order_db -c "TRUNCATE order_items, orders RESTART IDENTITY" -c "VACUUM ANALYZE"
    $MS exec -T postgres-ms psql -q -v ON_ERROR_STOP=1 -U postgres -d payment_db -c "TRUNCATE payments RESTART IDENTITY" -c "VACUUM ANALYZE"
    $MS exec -T postgres-ms psql -q -v ON_ERROR_STOP=1 -U postgres -d notification_db -c "TRUNCATE notifications RESTART IDENTITY" -c "VACUUM ANALYZE"
    $MS exec -T postgres-ms psql -q -v ON_ERROR_STOP=1 -U postgres -d product_db -c "UPDATE products SET stock = 1000000000" -c "VACUUM ANALYZE"
    $MS exec -T rabbitmq rabbitmqctl purge_queue notification.order-paid >/dev/null 2>&1 || true
  fi
  echo "done"
}

cmd_ps() {
  local arch=${1:-}
  if [[ -z $arch ]]; then $MONO ps; $MS ps; $INFRA ps; else $(arch_compose "$arch") ps; fi
}

cmd_stats() {
  docker stats --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}' \
    $(docker ps --filter 'label=com.docker.compose.project' --format '{{.Names}}' | grep -E '^tokoku-(mono|ms)-')
}

cmd_compare() {
  if command -v node >/dev/null 2>&1; then
    node scripts/compare-results.js "$@"
  else
    docker run --rm -v "$PWD:/w" -w /w node:24-alpine node scripts/compare-results.js "$@"
  fi
}

cmd_help() {
  cat <<'EOF'
Usage: ./scripts/demo.sh <command> [arguments]

  up [all|infra|mono|ms]          Build and start (default: all)
  only mono|ms                    Run one architecture only and stop the other (for fair tests)
  down [all|infra|mono|ms] [-v]   Stop (-v = also delete data/volumes)
  ps [mono|ms]                    Container status
  urls                            List the important URLs
  stats                           docker stats for the app containers

  k6 <scenario> <mono|ms> [K=V..] Run a load test. Scenarios:
                                    smoke | load | stress | spike | soak | fault | noisy-neighbor | scaling
                                  Example: ./scripts/demo.sh k6 load mono RATE=150 DURATION=5m
                                  From a separate machine: TARGET_HOST=<VPS-IP> ./scripts/demo.sh k6 load mono
  compare [filter]                Comparison table of k6 results (k6/results/*.json)

  scale mono <N>                  Scale OUT the monolith to N replicas
  scale ms <service> <N>          Scale OUT one microservice (e.g. order-service 3)
  scale-up <cpus> [workers]       Scale UP the monolith (more CPU and workers; container restarts)

  chaos <preset>                  Third-party fault injection:
                                    normal | email-down | email-slow | payment-slow | payment-flaky
  kill <mono|ms> <service>        Stop one container (e.g. kill ms notification-service)
  revive <mono|ms> <service>      Start it again

  reset-db <mono|ms>              Clear transaction data and restore stock (do this before every run)
EOF
}

cmd=${1:-help}
shift || true
case "$cmd" in
  up) cmd_up "$@" ;;
  only) cmd_only "$@" ;;
  down) cmd_down "$@" ;;
  ps) cmd_ps "$@" ;;
  urls) cmd_urls ;;
  stats) cmd_stats ;;
  k6) cmd_k6 "$@" ;;
  compare) cmd_compare "$@" ;;
  scale) cmd_scale "$@" ;;
  scale-up) cmd_scale_up "$@" ;;
  chaos) cmd_chaos "$@" ;;
  kill) cmd_kill "$@" ;;
  revive) cmd_revive "$@" ;;
  reset-db) cmd_reset_db "$@" ;;
  help | -h | --help) cmd_help ;;
  *) echo "Unknown command: $cmd"; cmd_help; exit 1 ;;
esac
