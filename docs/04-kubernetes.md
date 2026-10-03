# 4. Kubernetes (k3s)

Versi Kubernetes memperlihatkan scale out yang sebenarnya: replika tersebar ke beberapa **node**, dan **HPA** menambah atau mengurangi replika secara otomatis berdasarkan CPU.

```text
k8s/
  infra/           namespace tokoku-infra : thirdparty-mock (NodePort 30040)
  monolith/        namespace tokoku-mono  : postgres, monolith (+HPA), gateway (NodePort 30081)
  microservices/   namespace tokoku-ms    : postgres, rabbitmq, 5 service (+HPA), gateway (NodePort 30082)
  monitoring/      kube-prometheus-stack values + PodMonitor
```

Manifest memakai **kustomize** dan mengambil file nginx/storefront/SQL langsung dari folder `gateway/` dan `db/`, jadi tidak ada duplikasi.
Resource `requests = limits` disamakan dengan versi Docker Compose (QoS *Guaranteed*).

## 4.1 Install k3s

Satu node:

```bash
curl -sfL https://get.k3s.io | sh -
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config && sudo chown $USER ~/.kube/config
kubectl get nodes
```

Tambah worker node (opsional, supaya scale out lintas mesin terlihat). Di server, jalankan `sudo cat /var/lib/rancher/k3s/server/node-token`. Lalu di node baru:

```bash
curl -sfL https://get.k3s.io | K3S_URL=https://<IP-SERVER>:6443 K3S_TOKEN=<TOKEN> sh -
```

k3s sudah menyertakan **metrics-server** (dibutuhkan HPA) dan storage `local-path` (untuk PostgreSQL). Install juga Docker (untuk build image) dan Helm:

```bash
curl -fsSL https://get.docker.com | sh
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

## 4.2 Monitoring

```bash
./scripts/k8s.sh monitoring
```

Perintah ini meng-install **kube-prometheus-stack** dengan [k8s/monitoring/kps-values.yaml](../k8s/monitoring/kps-values.yaml): Prometheus menerima remote write dari k6 dan scrape setiap 5 detik. Setelah itu dashboard TokoKu di-import dan PodMonitor diterapkan.

- Grafana: `http://<NODE-IP>:30030` (admin / tokoku)
- Prometheus: `http://<NODE-IP>:30090`

Dashboard **TokoKu: Live Demo** dan **Monolith vs Microservices** bisa dipakai apa adanya, karena label `job`/`svc` disamakan lewat relabeling.
Untuk resource per pod, gunakan dashboard bawaan **Kubernetes / Compute Resources / Namespace (Pods)**. Dashboard cAdvisor versi Docker memakai label Docker sehingga tidak di-import.

## 4.3 Deploy

```bash
./scripts/k8s.sh deploy all      # build image -> import ke k3s -> apply
./scripts/k8s.sh status
```

- Monolith: `http://<NODE-IP>:30081`
- Microservices: `http://<NODE-IP>:30082`
- Chaos panel: `http://<NODE-IP>:30040`

> **Memakai registry?** Push image `tokoku/*:latest` ke registry Anda, lalu ganti field `image:` (atau tambahkan blok `images:` di `kustomization.yaml`), kemudian jalankan `./scripts/k8s.sh apply`.

Agar pengujian adil di cluster kecil, deploy satu arsitektur saja dengan `./scripts/k8s.sh deploy mono`, lalu `./scripts/k8s.sh delete mono` sebelum `deploy ms`.

## 4.4 Load test ke cluster

Dari mesin **di luar** cluster:

```bash
./scripts/k8s.sh k6 load mono <NODE-IP> RATE=100
./scripts/k8s.sh k6 scaling ms <NODE-IP> RATE=150
```

## 4.5 Demo HPA (autoscaling)

HPA sudah terpasang untuk `monolith` (maks 4), `order-service` (maks 5), `product-service`, `user-service` (maks 4), dan `payment-service` (maks 3), dengan target CPU **70% dari request**.

```bash
# terminal 1
watch -n2 kubectl -n tokoku-ms get hpa,pods
# terminal 2
./scripts/k8s.sh k6 scaling ms <NODE-IP> RATE=150 DURATION=8m
```

**Tunjukkan:**
- `TARGETS` di HPA naik melewati 70%, lalu `REPLICAS` order-service bertambah **sendiri**. Service lain tetap 1 replika.
- Di Grafana, *Active replicas* bertambah, p95 POST /orders turun, dan error tetap ~0 (rolling, tanpa downtime).
- Bandingkan dengan monolit: setiap replika baru meminta **2 CPU + 1 GiB**. Kalau node tidak punya ruang, pod akan `Pending`. Ini contoh nyata batas kapasitas dan biaya.

> Kalau ingin scale **manual** (`./scripts/k8s.sh scale ms order-service 3`), hapus HPA-nya dulu (`kubectl -n tokoku-ms delete hpa order-service`). Kalau tidak, HPA akan mengembalikan jumlah replika.

## 4.6 Catatan desain

- **Gateway nginx + headless Service.** nginx me-resolve `*-headless` lewat kube-dns setiap 5 detik, jadi beban dibagi **per request** ke semua pod dan pod baru langsung terlihat. Kalau gateway memakai ClusterIP biasa dengan koneksi keep-alive, koneksi cenderung "menempel" ke pod lama dan replika baru kurang mendapat beban.
- **Probe**: `readinessProbe` `/health` memeriksa koneksi DB, sehingga pod baru hanya menerima trafik setelah siap. Inilah yang membuat scaling dan rolling update tanpa downtime.
- **`enableServiceLinks: false`** mencegah Kubernetes menyuntikkan ratusan env var `*_PORT` yang bisa bentrok dengan konfigurasi aplikasi.
- **thirdparty-mock harus 1 replika** karena konfigurasi chaos disimpan di memori.
