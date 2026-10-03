# 3. Skenario Uji & Analisis Hasil

Semua skenario dijalankan dengan pola yang sama:

```bash
./scripts/demo.sh k6 <skenario> <mono|ms> [PARAM=nilai ...]
# dari mesin terpisah:
TARGET_HOST=<IP> ./scripts/demo.sh k6 <skenario> <mono|ms> [PARAM=nilai ...]
```

- Hasil ringkas tersimpan di `k6/results/<tanggal>-<arsitektur>-<skenario>.json`.
- Metrik detik-per-detik dikirim ke Prometheus dan bisa dilihat di Grafana.
- Setiap request diberi tag `arch`, `test`, dan `name` (endpoint).

## Parameter umum

| Parameter | Default | Arti |
|---|---|---|
| `RATE` | tergantung skenario | request (iterasi) per detik, model **open** (arrival-rate) |
| `DURATION` | tergantung skenario | lama fase beban stabil |
| `ORDER_RATIO` | 0.15 (scaling: 0.5) | porsi checkout dalam campuran trafik; sisanya 70% katalog, 30% detail produk |
| `HOT_PRODUCTS` | 0 | > 0 berarti semua pesanan ke N produk pertama (flash sale, *row lock contention*) |
| `USERS` | 30 | jumlah user yang login di `setup()` untuk dipakai checkout |
| `MAX_VUS` | 1000-2000 | batas VU k6. Muncul peringatan `Insufficient VUs` artinya server terlalu lambat untuk RATE tersebut |

> **Kenapa arrival-rate (open model)?** User sungguhan tidak menunggu server sebelum datang. Dengan `constant-vus` (closed model), server yang melambat otomatis mendapat beban lebih kecil, sehingga masalahnya tersamarkan (*coordinated omission*).

## Detail skenario

### 0. Smoke: `smoke.js`
1 VU, 5 iterasi semua endpoint. Pakai sebelum demo atau setelah deploy.

### 1. Load: `load.js`
`warm-up 30s → RATE stabil selama DURATION → cooldown`. Hasilnya menjadi **baseline**.
Parameter: `RATE` (100), `DURATION` (3m), `WARMUP` (30s).

### 2. Stress: `stress.js`
Beban naik bertahap: `START_RATE`, lalu `+STEP` setiap `STEP_DURATION`, sampai `MAX_RATE`.
Parameter: `START_RATE` (50), `STEP` (50), `MAX_RATE` (600), `STEP_DURATION` (1m), `ABORT_ON_FAIL` (false).
Cari dua angka berikut:
- **Titik saturasi**: p95 mulai naik dan throughput mulai melandai (tidak lagi = RATE).
- **Breaking point**: p95 > SLO atau error > 1%.

### 3. Spike: `spike.js`
`BASE_RATE` selama 1 menit, lalu naik ke `SPIKE_RATE` (default 10×) dalam **10 detik**, ditahan `SPIKE_DURATION`, kemudian kembali ke base selama 1m30s.
Yang dinilai: apakah sistem bertahan, seberapa tinggi error-nya, dan **berapa lama pulih** setelah lonjakan reda.
Variasi flash sale: `HOT_PRODUCTS=5 ORDER_RATIO=0.4`.

### 4. Soak: `soak.js`
`RATE` (50) konstan selama `DURATION` (1h). Amati panel *Memory (RSS)*, *DB pool*, dan *DB query latency p95*: semuanya harus **datar**. Kenaikan yang terus-menerus menandakan leak.

### 5. Fault injection: `fault.js`
Beban konstan `RATE` (50). Pada detik `FAULT_AT` (60), preset `FAULT` diaktifkan selama `FAULT_FOR` (90s), lalu dikembalikan ke normal.

| `FAULT` | Efek |
|---|---|
| `email-down` | Email provider merespons 503 |
| `email-slow` | Email 1.5-2.5 detik |
| `payment-slow` | Payment gateway 2-3 detik |
| `payment-flaky` | 30% request payment error |

Fault level container (manual, saat test berjalan): `./scripts/demo.sh kill ms notification-service` / `revive`.

### 5b. Noisy neighbor: `noisy-neighbor.js`
`BROWSE_RATE` (50/s) ke GET /products selama 4 menit. Pada detik 60, `login_storm` naik ke `LOGIN_RATE` (250/s) selama ±2 menit.
Bandingkan `http_req_duration{name:GET /products}` **sebelum** dan **selama** storm.

### 6. Scaling: `scaling.js`
`RATE` (120) dengan `ORDER_RATIO=0.5` selama `DURATION` (6m). Lakukan scale **di tengah test**:
- `./scripts/demo.sh scale ms order-service 3`
- `./scripts/demo.sh scale mono 2`
- `./scripts/demo.sh scale-up 4 4` (bandingkan dengan scale up)

---

## Aturan agar hasil valid

1. **Warm-up dulu.** Buang data menit pertama (JIT, koneksi pool, cache OS).
2. **Ulangi minimal 3×** per skenario per arsitektur, lalu ambil **median**.
3. **Jalankan k6 di mesin terpisah** dari sistem yang diuji.
4. **Reset database** sebelum setiap run: `./scripts/demo.sh reset-db mono|ms`.
5. **Nyalakan satu arsitektur saja** saat mengukur: `./scripts/demo.sh only mono|ms`.
6. **Ubah satu variabel per percobaan.** Contoh: hanya replika order-service, bukan sekaligus CPU dan pool.
7. **Catat** spesifikasi mesin, versi Docker, isi `.env`, dan commit git.

## Ukuran yang dikumpulkan

| Ukuran | Sumber | Catatan |
|---|---|---|
| Latency p50 / p95 / p99 | k6 summary, Grafana | jangan hanya rata-rata |
| Throughput (RPS sukses) | k6 `http_reqs` dikurangi error, Grafana *Throughput* | |
| Error rate | k6 `http_req_failed`, Grafana *Error 5xx* | termasuk timeout |
| CPU & RAM saat puncak | dashboard *Containers*, `./scripts/demo.sh stats` | catat juga DB & RabbitMQ |
| Breaking point | stress test | RPS saat p95 > SLO atau error > 1% |
| Efisiensi | dashboard *Compare* → request per CPU-detik | |
| Waktu pulih | spike & fault test | detik sampai p95 kembali normal |

## Template laporan

`./scripts/demo.sh compare` mencetak tabel Markdown dari semua file hasil. Lengkapi dengan tabel berikut:

```markdown
### Lingkungan
- VPS SUT: … vCPU / … GB, OS …, Docker …
- Load generator: …
- .env: FRAUD_CHECK_ROUNDS=…, PASSWORD_HASH_ITERATIONS=…

### Hasil (median dari 3 run)
| Skenario | Metrik | Monolith | Microservices | Catatan |
|---|---|---|---|---|
| Load @… RPS | p95 GET /products | | | |
| Load @… RPS | p95 POST /orders | | | |
| Load @… RPS | CPU total (core) | | | termasuk DB/gateway/MQ |
| Load @… RPS | Memory total | | | |
| Stress | Breaking point (RPS) | | | bottleneck: … |
| Spike 10× | Error saat spike / waktu pulih | | | |
| Fault email-down | Error POST /orders selama gangguan | | | |
| Noisy neighbor | p95 GET /products selama storm | | | |
| Scaling | RPS per core setelah scale | | | |
```

## Pertanyaan analisis (untuk diskusi)

1. **Berapa overhead komunikasi antar service?** Bandingkan p50 POST /orders di beban rendah, dan lihat panel *Network hop cost*.
2. **Di mana bottleneck masing-masing?** CPU app, CPU database, DB pool, atau dependensi eksternal?
3. **Kapan microservices mulai sepadan?** Di beban berapa, dan untuk pola trafik seperti apa (merata vs timpang)?
4. **Berapa biaya tambahannya?** Total memory, container, dan komponen infrastruktur (RabbitMQ, gateway).
5. **Apa batasan eksperimen ini?** Satu mesin, jaringan lokal, skala kecil, Node.js single-thread (lihat [01-arsitektur.md §1.6](01-arsitektur.md#16-batasan-eksperimen-sampaikan-ke-peserta)).
