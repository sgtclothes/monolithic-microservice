# 2. Panduan Live Demo (Runbook Webinar)

Panduan ini mengikuti **objective webinar** dan rancangan demo di catatan persiapan:
baseline → stress → scale up → microservices → scale out granular → fault injection → kapan *tidak* perlu microservices.

> Angka RPS di bawah adalah **titik awal**. Kapasitas tiap VPS berbeda, jadi **lakukan gladi** (lihat [2.2](#22-gladi-kalibrasi-angka-beban)) dan catat angka yang cocok untuk mesin Anda di [tabel kalibrasi](#tabel-kalibrasi-isi-saat-gladi).

---

## 2.1 Persiapan (H-1)

### Topologi yang disarankan

| Mesin | Spesifikasi | Isi | Koneksi |
|---|---|---|---|
| VPS-1 "load generator" | 2 vCPU / 2 GB | k6 (Docker) | mengirim HTTP ke VPS-2 port 8081/8082, dan remote write metrik k6 ke Prometheus VPS-2 port 9090 |
| VPS-2 "system under test" | 4 vCPU / 8 GB | infra + monolith + microservices (Docker Compose) | presenter membuka Grafana di port 3000 |

Kenapa dua mesin? Kalau k6 berjalan di mesin yang sama, k6 ikut memakan CPU sistem yang diuji, sehingga hasilnya bias. Satu mesin tetap boleh untuk latihan atau demo konsep, asalkan keterbatasan ini disebutkan ke peserta.

### Setup VPS-2 (system under test)

```bash
# Ubuntu 22.04/24.04
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
git clone <repo-ini> tokoku && cd tokoku
cp .env.example .env            # ubah GRAFANA_PASSWORD!
./scripts/demo.sh up
./scripts/demo.sh k6 smoke mono && ./scripts/demo.sh k6 smoke ms
```

**Firewall**: buka `3000` (Grafana) untuk publik. Buka `8081`, `8082`, `9090`, dan `4000` **hanya untuk IP VPS-1**, karena Prometheus dan chaos panel tidak memakai autentikasi.

```bash
sudo ufw allow 22/tcp && sudo ufw allow 3000/tcp
sudo ufw allow from <IP-VPS-1> to any port 8081,8082,9090,4000 proto tcp
sudo ufw enable
```

> Docker mem-publish port lewat iptables dan bisa melewati aturan `ufw`. Untuk proteksi yang pasti, pakai firewall dari panel penyedia VPS, atau ubah mapping port di compose menjadi `127.0.0.1:9090:9090` lalu akses lewat SSH tunnel.

### Setup VPS-1 (load generator)

```bash
curl -fsSL https://get.docker.com | sh
git clone <repo-ini> tokoku && cd tokoku
docker pull grafana/k6:1.1.0
TARGET_HOST=<IP-VPS-2> ./scripts/demo.sh k6 smoke mono
```

Semua perintah `k6` di bawah dijalankan di VPS-1 dengan awalan `TARGET_HOST=<IP-VPS-2>`. Untuk memudahkan, jalankan `export TARGET_HOST=<IP-VPS-2>` sekali. Perintah lain (`scale`, `chaos`, `kill`, dll.) dijalankan di VPS-2.

### Layout layar saat presentasi

| Layar | Isi |
|---|---|
| Kiri (besar) | Grafana **TokoKu: Live Demo**, refresh 5s, rentang waktu `Last 15 minutes` |
| Kanan atas | Terminal VPS-1 (k6) |
| Kanan bawah | Terminal VPS-2 (scale / chaos / `./scripts/demo.sh stats`) |
| Tab cadangan | Storefront 8081 & 8082, Chaos panel :4000, RabbitMQ :15672, dashboard *Containers* & *Compare* |

## 2.2 Gladi: kalibrasi angka beban

1. `./scripts/demo.sh only mono`, lalu jalankan `./scripts/demo.sh k6 stress mono START_RATE=25 STEP=25 MAX_RATE=800 STEP_DURATION=45s ABORT_ON_FAIL=true`.
2. Di Grafana, catat **RPS saat p95 mulai naik tajam** (saturasi) dan **RPS saat error > 1%** (patah). Sebut angka terakhir ini `B_mono`.
3. Ulangi untuk microservices (`only ms`) dan dapatkan `B_ms`.
4. Gunakan angka ini untuk demo:
   - load/baseline = **±40% B**
   - stress = mulai 40% B, naik sampai **1.5× B**
   - scaling test = **±1.2× kapasitas order** (lihat panel *Checkout results per second* saat jenuh)

#### Tabel kalibrasi (isi saat gladi)

| Parameter | Monolith | Microservices |
|---|---|---|
| Spesifikasi VPS | | |
| Saturasi mulai (RPS) | | |
| Breaking point `B` (RPS) | | |
| Bottleneck yang terlihat | | |
| RATE untuk load | | |
| RATE untuk scaling | | |

---

## 2.3 Alur demo

Perkiraan total **45-60 menit**. Setiap langkah berisi apa yang dijalankan, apa yang ditunjukkan, dan poin bicara.
Jalankan `./scripts/demo.sh reset-db <arch>` sebelum setiap pengukuran penting.

### Langkah 0: Perkenalkan aplikasinya (5 menit)

- Buka http://VPS:8081 dan http://VPS:8082. Tampilannya identik, hanya badge arsitekturnya yang berbeda.
- Login dengan `user1@tokoku.test` / `password123`, masukkan produk ke keranjang, lalu checkout. Status email akan berubah menjadi `SENT`.
- Tunjukkan baris info di kanan atas storefront: `served by 172.x.x.x:3000` menunjukkan replika mana yang melayani.
- Buka kode [apps/shared/domain/orders.js](../apps/shared/domain/orders.js) dan jelaskan bahwa *alur checkout ditulis sekali*. Lalu bandingkan [apps/monolith/modules/orders.js](../apps/monolith/modules/orders.js) (function call + 1 transaksi) dengan [apps/services/order-service/index.js](../apps/services/order-service/index.js) (HTTP + event + kompensasi).

**Poin bicara:** "Logika bisnisnya sama persis. Yang berbeda hanya cara modul berbicara satu sama lain. Itulah yang akan kita ukur."

### Langkah 1: Baseline monolit (5 menit)

```bash
# VPS-2
./scripts/demo.sh only mono && ./scripts/demo.sh reset-db mono
# VPS-1
./scripts/demo.sh k6 load mono RATE=<40% B_mono> DURATION=2m
```

**Tunjukkan:**
- Latency p95 datar (fase **linear**).
- Panel *CPU used (cores) per service* jauh di bawah limit 2 core.
- *DB pool: waiting connections* = 0 dan *event loop lag* rendah.

**Poin bicara:** fase linear berarti resource masih longgar. Pakai p95/p99, jangan rata-rata, karena rata-rata bisa menipu.

### Langkah 2: Naikkan beban sampai patah (8 menit)

```bash
./scripts/demo.sh k6 stress mono START_RATE=<40% B> STEP=<10% B> MAX_RATE=<1.5× B> STEP_DURATION=45s
```

**Tunjukkan, sesuai urutan pengecekan bottleneck:**
1. Dashboard *Containers*: **CPU vs LIMIT** monolith mendekati 100% dan **throttling** naik. Ini bottleneck komputasi.
2. *Event loop lag p99* melonjak. Semua request di proses itu ikut antre, termasuk GET /products yang ringan.
3. Kalau *DB pool: waiting connections* > 0 sementara CPU belum penuh, berarti bottleneck I/O database.
4. Latency k6 melonjak lalu error naik. Itu **breaking point**.

**Poin bicara:** tunjukkan empat fase *linear → saturasi → patah → collapse* langsung di grafik. Korelasi visual antara CPU dan latency lebih meyakinkan daripada tabel angka.

### Langkah 3: Scale UP monolit (5 menit)

Jalankan beban konstan sedikit di atas `B_mono`, lalu tambah CPU di tengah jalan:

```bash
# VPS-1
./scripts/demo.sh k6 load mono RATE=<1.2× B_mono> DURATION=4m
# VPS-2, setelah ±1 menit
./scripts/demo.sh scale-up 4 4
```

**Tunjukkan:**
- **Downtime**: container dibuat ulang, sehingga muncul lonjakan error di k6 selama beberapa detik.
- Setelah naik, p95 kembali stabil dan CPU terpakai bisa melewati 2 core.

**Poin bicara:**
- Scale up itu sederhana (tidak perlu ubah kode), tapi butuh restart dan dibatasi spek mesin terbesar.
- Aplikasinya **harus bisa memakai** core tambahan. Di Node.js caranya dengan menambah `WORKERS`. Coba `./scripts/demo.sh scale-up 4 1` untuk memperlihatkan bahwa CPU 4 core tapi 1 worker tidak memberi peningkatan.
- Kembalikan ke kondisi awal dengan `./scripts/demo.sh scale-up 2 2`.

### Langkah 3b (opsional): Scale OUT monolit

```bash
./scripts/demo.sh scale mono 2
```

**Tunjukkan:** panel *Active replicas* = 2 dan *Memory* menjadi dua kali lipat, karena **semua** modul ikut digandakan termasuk yang tidak sibuk. Header `served by` di storefront bergantian antar IP.

**Poin bicara:** di **satu VPS**, scale out hanya membantu kalau masih ada CPU host yang menganggur. Scale out yang sebenarnya berarti menambah **node** (lihat [Kubernetes](04-kubernetes.md)). Kembalikan dengan `./scripts/demo.sh scale mono 1`.

### Langkah 4: Microservices dengan beban yang sama (8 menit)

```bash
# VPS-2
./scripts/demo.sh only ms && ./scripts/demo.sh reset-db ms
# VPS-1
./scripts/demo.sh k6 stress ms START_RATE=<40% B> STEP=<10% B> MAX_RATE=<1.5× B> STEP_DURATION=45s
```

**Tunjukkan:**
- *CPU used (cores) per service*: hanya beberapa service yang mendekati limit (biasanya **order-service**), sementara yang lain longgar.
- *Throughput per service*: product-service menerima trafik publik **dan** trafik internal (`/internal/stock/*`) dari order-service. Ini amplifikasi trafik.
- *Network hop cost*: latency panggilan order-service → product/payment-service.
- Bandingkan latency GET /products di beban rendah: monolit biasanya sedikit lebih cepat karena tidak ada hop tambahan.

**Poin bicara:** hipotesisnya, monolit lebih cepat di beban ringan dan microservices unggul saat butuh scaling per service. Mana yang terbukti di mesin ini?

### Langkah 5: Scale out hanya service yang bottleneck (7 menit)

```bash
# VPS-1
./scripts/demo.sh k6 scaling ms RATE=<±1.2× kapasitas order>
# VPS-2, setelah ±1.5 menit saat p95 POST /orders tinggi
./scripts/demo.sh scale ms order-service 3
```

**Tunjukkan:**
- Replika order-service naik menjadi 3 **tanpa downtime** (tidak ada lonjakan error).
- p95 POST /orders turun, sementara service lain tidak berubah.
- Dashboard *Compare*: panel **Efficiency: requests per CPU-second**.

Ulangi untuk monolit: `k6 scaling mono` lalu `scale mono 2`, yang menggandakan seluruh aplikasi.

**Poin bicara:** scaling granular berarti kita hanya membayar untuk bagian yang sibuk. Tapi kalau bebannya merata ke semua fitur, keuntungan ini kecil.

> Kalau setelah order-service di-scale bottleneck pindah ke payment-service atau database, **itu juga bagus untuk ditunjukkan**: bottleneck selalu berpindah, jadi scaling adalah proses iteratif.

### Langkah 6: Fault injection (8 menit)

**6a. Email provider mati** (otomatis: mati di detik 60, pulih di detik 150):

```bash
./scripts/demo.sh k6 fault mono FAULT=email-down RATE=<40% B>
./scripts/demo.sh k6 fault ms   FAULT=email-down RATE=<40% B>
```

| Yang diamati | Monolith (sync) | Microservices (event) |
|---|---|---|
| Error POST /orders selama gangguan | naik tajam (502 NOTIFICATION_FAILED) | tetap ~0 |
| Panel *Notification queue (backlog)* | - | RabbitMQ `ready` menumpuk, lalu terkuras setelah pulih |
| Status email di storefront | - | `FAILED (2x)` lalu `SENT (3x)` |

**Poin bicara (penting dan jujur):** isolasi kegagalan ini datang dari **desain asinkron**, bukan semata-mata karena "microservices". Buktikan dengan dua variasi:
- Monolit juga bisa async: set `MONO_NOTIFICATION_MODE=async` di `.env`, lalu `docker compose -f docker-compose.monolith.yml up -d monolith`. Checkout aman, tapi antrean **hilang kalau proses restart**.
- Microservices juga bisa rapuh: set `MS_NOTIFICATION_MODE=sync` (*distributed monolith*), lalu `docker compose -f docker-compose.microservices.yml up -d order-service`. Hasilnya sama buruknya dengan monolit.

**6b. Matikan service secara langsung:**

```bash
./scripts/demo.sh kill ms notification-service     # saat load test berjalan
# amati: checkout tetap sukses, antrean RabbitMQ bertambah
./scripts/demo.sh revive ms notification-service   # antrean terkuras
```

**6c. Dependensi sinkron yang lambat** (`FAULT=payment-slow`): kedua arsitektur sama-sama lambat di POST /orders. Microservices bukan solusi ajaib, karena pembayaran tetap harus ditunggu. Yang membantu di sini adalah timeout, circuit breaker, dan antrean.

### Langkah 7: Noisy neighbor (5 menit)

```bash
./scripts/demo.sh k6 noisy-neighbor mono LOGIN_RATE=250
./scripts/demo.sh k6 noisy-neighbor ms   LOGIN_RATE=250
```

Login storm (hashing password yang mahal CPU) dimulai di detik 60.

**Tunjukkan:** latency p95 **GET /products**.
- Monolit: ikut naik, karena satu proses dan CPU-nya dipakai bersama.
- Microservices: GET /products tetap cepat, dan yang jenuh hanya user-service. Tapi login di microservices tumbang jauh lebih cepat (banyak timeout), karena user-service hanya punya 0.3 core sedangkan login di monolith bisa memakai seluruh 2 core. Sampaikan ini sebagai trade-off isolasi.

**Poin bicara:** di monolit, satu fitur yang rakus resource bisa mengganggu fitur lain. Mitigasinya tidak harus microservices: bisa dengan rate limiting, worker pool terpisah, atau memisahkan **hanya** fitur tersebut (strangler fig).

### Langkah 8: Penutup, kapan TIDAK perlu microservices (5 menit)

```bash
./scripts/demo.sh compare
```

Tempelkan tabel hasilnya ke slide, lalu bahas:
- Overhead microservices: lebih banyak container, RabbitMQ, memory total, network hop, dan kerumitan Saga. Tunjukkan dashboard *Containers* → *Total memory per architecture*.
- Sinyal **belum perlu** microservices: tim kecil, beban merata, scale up masih murah, dan downtime singkat masih bisa ditoleransi.
- Aturan praktis: *scale up dan optimasi kode dulu sampai mentok secara ekonomis. Scale out kalau butuh HA atau granularitas. Microservices baru masuk akal kalau kompleksitas organisasi sudah jadi masalah nyata.*

---

## 2.4 Rencana cadangan

| Masalah saat live | Solusi cepat |
|---|---|
| VPS lambat / beban terlalu berat | Turunkan `RATE`, atau naikkan `FRAUD_CHECK_ROUNDS` agar titik jenuh tercapai di RPS lebih rendah |
| Grafana tidak menampilkan data k6 | Panel *Application* tetap berjalan (metrik dari app). Cek akses VPS-1 → `:9090` |
| Container crash / aneh | `./scripts/demo.sh down mono && ./scripts/demo.sh up mono` (±30 detik) |
| Data sudah terlalu banyak | `./scripts/demo.sh reset-db mono` / `ms` |
| Internet putus | Siapkan screenshot/rekaman dari gladi. Hasil `k6/results/*.json` bisa ditampilkan dengan `compare` |
