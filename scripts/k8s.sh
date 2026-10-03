#!/usr/bin/env bash
# =====================================================================
#  TokoKu on Kubernetes (tested on k3s; kind / minikube also work).
#  Run it from the repo root:  ./scripts/k8s.sh help
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

IMAGES=(monolith services/user-service services/product-service services/order-service services/payment-service services/notification-service thirdparty-mock)
KUSTOMIZE="kubectl kustomize --load-restrictor=LoadRestrictionsNone"

info() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }

image_name() { echo "tokoku/$(basename "$1"):latest"; }

cmd_build() {
  for dir in "${IMAGES[@]}"; do
    info "build $(image_name "$dir")"
    docker build -q --build-arg APP_DIR="$dir" -t "$(image_name "$dir")" apps/ >/dev/null
  done
}

# Loads local images into the cluster without a registry.
cmd_load() {
  local names=()
  for dir in "${IMAGES[@]}"; do names+=("$(image_name "$dir")"); done
  if command -v k3s >/dev/null 2>&1; then
    info "import images into k3s (containerd)"
    docker save "${names[@]}" | sudo k3s ctr images import -
  elif command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -q .; then
    info "load images into kind"
    kind load docker-image "${names[@]}"
  elif command -v minikube >/dev/null 2>&1; then
    info "load images into minikube"
    for n in "${names[@]}"; do minikube image load "$n"; done
  else
    echo "Could not find k3s/kind/minikube. Push the images to your registry, then change the image fields in k8s/*/*.yaml"
    exit 1
  fi
}

cmd_apply() {
  local what=${1:-all}
  info "apply infra (thirdparty-mock)"
  $KUSTOMIZE k8s/infra | kubectl apply -f -
  if [[ $what == all || $what == mono ]]; then
    info "apply monolith"
    $KUSTOMIZE k8s/monolith | kubectl apply -f -
  fi
  if [[ $what == all || $what == ms ]]; then
    info "apply microservices"
    $KUSTOMIZE k8s/microservices | kubectl apply -f -
  fi
  if kubectl get crd podmonitors.monitoring.coreos.com >/dev/null 2>&1; then
    kubectl apply -f k8s/monitoring/podmonitors.yaml 2>/dev/null || true
  fi
  cmd_status
}

cmd_monitoring() {
  info "install kube-prometheus-stack (Helm)"
  helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null
  helm repo update >/dev/null
  helm upgrade --install kps prometheus-community/kube-prometheus-stack \
    --namespace monitoring --create-namespace -f k8s/monitoring/kps-values.yaml --wait
  info "import the TokoKu dashboards into Grafana"
  kubectl -n monitoring create configmap tokoku-dashboards \
    --from-file=monitoring/grafana/dashboards/tokoku-overview.json \
    --from-file=monitoring/grafana/dashboards/tokoku-compare.json \
    --dry-run=client -o yaml | kubectl label --local -f - grafana_dashboard=1 -o yaml | kubectl apply -f -
  kubectl create namespace tokoku-mono --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace tokoku-ms --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace tokoku-infra --dry-run=client -o yaml | kubectl apply -f -
  kubectl apply -f k8s/monitoring/podmonitors.yaml
  echo "Grafana: http://<NODE-IP>:30030 (admin/tokoku) | Prometheus: http://<NODE-IP>:30090"
}

cmd_k6() {
  # Runs k6 from this machine (ideally a machine SEPARATE from the cluster).
  #   ./scripts/k8s.sh k6 load mono <NODE-IP> RATE=100
  local test=${1:?scenario} arch=${2:?mono|ms} node=${3:?node IP} ; shift 3
  local port=30081 name=monolith
  [[ $arch == ms ]] && port=30082 name=microservices
  local envs=() kv
  for kv in "$@"; do envs+=(-e "$kv"); done
  mkdir -p k6/results
  docker run --rm -i --user 0 -v "$PWD/k6:/scripts" -w /scripts \
    -e K6_PROMETHEUS_RW_SERVER_URL="http://$node:30090/api/v1/write" \
    -e K6_PROMETHEUS_RW_TREND_STATS="p(50),p(95),p(99),avg,max" \
    grafana/k6:1.1.0 run --out experimental-prometheus-rw \
    --summary-export "results/$(date +%Y%m%d-%H%M%S)-$name-$test.json" \
    -e BASE_URL="http://$node:$port/api" -e ARCH="$name" -e MOCK_URL="http://$node:30040" -e TEST_NAME="$test" \
    ${envs[@]+"${envs[@]}"} "$test.js"
}

cmd_scale() {
  # ./scripts/k8s.sh scale ms order-service 3   |   ./scripts/k8s.sh scale mono monolith 2
  local ns=tokoku-mono
  [[ ${1:?mono|ms} == ms ]] && ns=tokoku-ms
  kubectl -n "$ns" scale deployment "${2:?deployment}" --replicas="${3:?replicas}"
  kubectl -n "$ns" get pods -l app="$2" -o wide
}

cmd_status() {
  for ns in tokoku-infra tokoku-mono tokoku-ms; do
    kubectl get ns "$ns" >/dev/null 2>&1 || continue
    echo; info "namespace $ns"
    kubectl -n "$ns" get pods,hpa -o wide 2>/dev/null
  done
  cat <<'EOF'

  Storefront monolith      : http://<NODE-IP>:30081
  Storefront microservices : http://<NODE-IP>:30082
  Chaos panel              : http://<NODE-IP>:30040
EOF
}

cmd_delete() {
  local what=${1:-all}
  [[ $what == all || $what == ms ]] && { $KUSTOMIZE k8s/microservices | kubectl delete --ignore-not-found -f -; }
  [[ $what == all || $what == mono ]] && { $KUSTOMIZE k8s/monolith | kubectl delete --ignore-not-found -f -; }
  [[ $what == all ]] && { $KUSTOMIZE k8s/infra | kubectl delete --ignore-not-found -f -; }
  return 0
}

case "${1:-help}" in
  build) cmd_build ;;
  load) cmd_load ;;
  deploy) shift; cmd_build; cmd_load; cmd_apply "${1:-all}" ;;
  apply) shift; cmd_apply "${1:-all}" ;;
  monitoring) cmd_monitoring ;;
  k6) shift; cmd_k6 "$@" ;;
  scale) shift; cmd_scale "$@" ;;
  status) cmd_status ;;
  delete) shift; cmd_delete "${1:-all}" ;;
  *)
    cat <<'EOF'
Usage: ./scripts/k8s.sh <command>

  monitoring                    Install kube-prometheus-stack + the TokoKu dashboards (once)
  deploy [all|mono|ms]          build images -> load into the cluster -> apply manifests
  build | load | apply [..]     The deploy steps, one at a time
  status                        Pods and HPAs per namespace
  scale <mono|ms> <deploy> <N>  Manual scaling (the HPA will also adjust automatically)
  k6 <scenario> <mono|ms> <NODE-IP> [K=V..]   Load test against the cluster NodePorts
  delete [all|mono|ms]          Delete the resources
EOF
    ;;
esac
