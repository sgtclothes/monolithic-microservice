# 5. Panduan Sederhana: Tes, Jelaskan, dan Demokan

Dokumen ini adalah "contekan" presenter. Isinya tiga bagian:

1. [Konsep dalam bahasa sederhana](#bagian-a-konsep-dalam-bahasa-sederhana): analogi yang bisa langsung dipakai saat menjelaskan.
2. [Alur demo dari awal sampai selesai](#bagian-b-alur-demo-langkah-demi-langkah): perintah, apa yang dilihat, dan kalimat yang bisa diucapkan.
3. [Penjelasan setiap grafik Grafana](#bagian-c-penjelasan-setiap-grafik-grafana): arti, cara membaca, dan tanda masalah.

Di akhir ada [glosarium](#bagian-d-glosarium) dan [solusi kalau ada masalah](#bagian-e-kalau-ada-masalah-saat-demo).

---

## Bagian A: Konsep dalam bahasa sederhana

### Analogi utama: warung vs food court

| | Monolith | Microservices |
|---|---|---|
| Analogi | **Satu warung**: satu dapur mengerjakan semua menu | **Food court**: setiap stand mengerjakan satu jenis menu |
| Di aplikasi ini | 1 aplikasi mengurus user, produk, pesanan, pembayaran, email | 5 aplikasi kecil, masing-masing satu urusan |
| Database | 1 database bersama | Setiap aplikasi punya database sendiri |
| Cara bekerja sama | Panggil fungsi di dalam satu program (cepat) | Saling kirim request lewat jaringan (ada jeda) |
| Kalau ramai | Tambah dapur besar, atau gandakan seluruh warung | Tambah stand yang antreannya panjang saja |
| Kalau satu bagian rusak | Bisa membuat seluruh warung tersendat | Stand lain tetap jalan (kalau desainnya benar) |

### Komponen pendukung, versi sederhana

| Komponen | Analogi | Fungsi di demo |
|---|---|---|
| **Gateway (nginx)** | Pelayan di pintu depan | Menerima semua request lalu meneruskannya ke aplikasi yang tepat |
| **RabbitMQ** | Kotak titipan pesan | order-service menitip pesan "pesanan sudah dibayar", lalu notification-service mengambilnya kapan sempat |
| **thirdparty-mock** | Bank dan kantor pos palsu | Pura-pura jadi payment gateway (100 sampai 300 ms) dan penyedia email |
| **k6** | Rombongan pembeli palsu | Mengirim ratusan request per detik untuk menguji ketahanan |
| **Prometheus** | Pencatat | Mencatat angka (CPU, latency, jumlah request) setiap 5 detik |
| **Grafana** | Papan skor | Menampilkan catatan Prometheus dalam bentuk grafik |
| **cAdvisor** | Meteran listrik per ruangan | Mengukur CPU dan memory setiap container |

### Tiga angka yang paling sering dibahas

- **RPS (request per second)**: berapa banyak permintaan yang dilayani per detik. Semakin tinggi semakin kuat.
- **Latency p95**: "95% pengunjung dilayani lebih cepat dari angka ini". Contoh: p95 = 200 ms berarti hanya 5% pengunjung yang menunggu lebih dari 200 ms. Kita pakai p95, bukan rata-rata, karena rata-rata bisa menutupi pengunjung yang menunggu sangat lama.
- **Error rate**: persentase permintaan yang gagal. Target di demo ini: di bawah 1%.

### Empat fase saat beban naik

Tunjukkan fase ini di grafik setiap kali beban dinaikkan:

| Fase | Yang terlihat di grafik | Analogi warung |
|---|---|---|
| **Linear** | Latency datar, CPU masih rendah | Pembeli datang, langsung dilayani |
| **Saturasi** | Latency mulai naik pelan, CPU mendekati batas | Antrean mulai terbentuk |
| **Patah (breaking point)** | Latency melonjak, error mulai muncul | Pembeli mulai pergi karena kelamaan |
| **Collapse** | Banyak timeout, sistem hampir tidak merespons | Warung kewalahan total |

### Keadilan perbandingan

Kalimat yang bisa diucapkan di awal:

> "Supaya adil, kedua versi memakai bahasa, database, dan data yang sama. Logika bisnisnya bahkan memakai kode yang sama persis. Total CPU aplikasi juga sama: monolith dapat 2 core, kelima microservices kalau dijumlah juga 2 core. Jadi yang kita bandingkan murni cara aplikasinya disusun."

---

## Bagian B: Alur demo langkah demi langkah

### Format setiap langkah

- **Tujuan**: apa yang ingin dibuktikan
- **Perintah**: yang diketik di terminal
- **Lihat di Grafana**: panel mana yang ditunjukkan
- **Ucapkan**: kalimat yang bisa langsung dipakai
- **Yang biasanya terjadi**: supaya Anda tidak kaget

### Peta waktu (sekitar 60 menit)

| # | Langkah | Waktu | Wajib? |
|---|---|---|---|
| 0 | Persiapan dan smoke test | sebelum mulai | Wajib |
| 1 | Perkenalan aplikasi | 5 menit | Wajib |
| 2 | Load test (baseline) | 8 menit | Wajib |
| 3 | Stress test (mencari titik patah) | 10 menit | Wajib |
| 4 | Scale up monolith | 5 menit | Wajib |
| 5 | Scale out: monolith vs microservices | 8 menit | Wajib |
| 6 | Fault test (email mati) | 8 menit | Wajib |
| 7 | Noisy neighbor | 8 menit | Disarankan |
| 8 | Spike test (flash sale) | 5 menit | Opsional |
| 9 | Soak test | jalankan sebelum webinar | Opsional |
| 10 | Rangkuman dan kesimpulan | 5 menit | Wajib |

### Tiga aturan selama demo

1. **Satu arsitektur saja yang menyala saat diuji.** Gunakan `./scripts/demo.sh only mono` atau `only ms`. Kalau keduanya menyala, mereka berebut CPU dan hasilnya tidak adil.
2. **Reset data sebelum pengukuran penting.** Gunakan `./scripts/demo.sh reset-db mono` atau `ms`.
3. **Set rentang waktu Grafana ke "Last 15 minutes"** dengan refresh 5s, supaya grafik bergerak real time.

---

### Langkah 0: Persiapan dan smoke test (sebelum peserta masuk)

**Tujuan:** memastikan semua bagian hidup dan berfungsi.

**Perintah:**

```bash
./scripts/demo.sh up
./scripts/demo.sh k6 smoke mono
./scripts/demo.sh k6 smoke ms
```

**Yang harus terlihat:** `checks_succeeded: 100%` dan `http_req_failed: 0%` untuk keduanya.

**Siapkan tab browser:**

| Tab | Alamat |
|---|---|
| Grafana: TokoKu: Live Demo | http://localhost:3000 |
| Grafana: TokoKu: Containers (cAdvisor) | menu Dashboards |
| Grafana: TokoKu: Monolith vs Microservices | menu Dashboards |
| Storefront monolith | http://localhost:8081 |
| Storefront microservices | http://localhost:8082 |
| Chaos panel | http://localhost:4000 |
| RabbitMQ | http://localhost:15672 (tokoku / tokoku) |
| Navicat | koneksi mono (15432) dan ms (15433) |

**Ucapkan:** belum perlu. Langkah ini dilakukan sebelum peserta masuk.

---

### Langkah 1: Perkenalan aplikasi

**Tujuan:** peserta paham bahwa kedua versi terlihat sama dari luar, tapi berbeda di dalam.

**Lakukan:**

1. Buka storefront 8081 dan 8082 berdampingan. Tunjukkan badge **MONOLITH** dan **MICROSERVICES** di pojok kiri atas.
2. Klik **Login**, tambahkan 2 produk ke keranjang, klik **Checkout**.
3. Tunjukkan bagian **My orders**: status `PAID`, lalu `email: SENT`.
4. Tunjukkan baris kecil di kanan atas, contoh: `POST /orders → 201 · 350 ms · served by 172.23.0.7:3000`. Itu menunjukkan siapa yang melayani request dan berapa lama.
5. (Opsional) Di Navicat, tunjukkan monolith punya semua tabel dalam 1 database, sedangkan microservices punya 5 database. Login sebagai `order_svc` lalu coba buka `product_db`: akan muncul `permission denied`.

**Ucapkan:**

> "Dari luar, kedua toko ini identik. Bedanya ada di dalam. Saat saya klik checkout di monolith, satu aplikasi mengerjakan semuanya: cek stok, buat pesanan, bayar, kirim email. Di microservices, pekerjaan yang sama dibagi ke beberapa aplikasi yang saling berkomunikasi lewat jaringan."

> "Lihat Navicat: order-service bahkan tidak boleh membaca database produk. Kalau butuh data produk, dia harus bertanya ke product-service. Ini yang disebut database per service."

---

### Langkah 2: Load test (baseline, beban normal)

**Tujuan:** mengukur performa saat kondisi normal. Ini titik acuan untuk semua tes berikutnya.

**Perintah:**

```bash
./scripts/demo.sh only mono
./scripts/demo.sh reset-db mono
./scripts/demo.sh k6 load mono RATE=50 DURATION=2m
```

Setelah selesai, ulangi untuk microservices:

```bash
./scripts/demo.sh only ms
./scripts/demo.sh reset-db ms
./scripts/demo.sh k6 load ms RATE=50 DURATION=2m
```

`RATE=50` artinya 50 request per detik. Isinya campuran: 70% lihat katalog, sekitar 25% lihat detail produk, dan 15% checkout.

**Lihat di Grafana (Live Demo):**

- *Requests/sec (k6)*: garis naik ke 50 lalu datar.
- *Latency p95 per endpoint (k6)*: datar. Ini fase **linear**.
- *CPU used (cores) per service*: jauh di bawah batas.
- *Throughput per service (including internal traffic)*: di microservices, jumlah request **lebih banyak** dari 50 karena ada request internal antar service.

**Ucapkan:**

> "Di beban normal, keduanya santai. Latency datar, CPU masih longgar. Perhatikan: untuk melayani 50 request dari pembeli, microservices sebenarnya memproses lebih banyak request karena service saling memanggil. Ini biaya tersembunyi microservices."

**Yang biasanya terjadi:** latency monolith sedikit lebih rendah, terutama untuk `POST /orders`, karena tidak ada lompatan jaringan antar service. Perbedaannya kecil (beberapa milidetik), karena latency checkout didominasi payment gateway (100 sampai 300 ms).

---

### Langkah 3: Stress test (mencari titik patah)

**Tujuan:** menemukan di beban berapa sistem mulai kewalahan, dan **apa** yang menjadi penyebabnya (bottleneck).

**Perintah:**

```bash
./scripts/demo.sh only mono
./scripts/demo.sh reset-db mono
./scripts/demo.sh k6 stress mono START_RATE=50 STEP=50 MAX_RATE=600 STEP_DURATION=45s
```

Beban mulai dari 50, naik 50 setiap 45 detik, sampai 600 request per detik. Tes berjalan sekitar 10 menit. Kalau ingin berhenti lebih awal, tekan `Ctrl+C`.

**Lihat di Grafana, berurutan:**

1. *Requests/sec (k6)*: naik seperti anak tangga.
2. *Latency p95 per endpoint (k6)*: awalnya datar, lalu suatu saat mulai naik (**saturasi**), lalu melonjak (**patah**).
3. Pindah ke dashboard **Containers**. *CPU vs LIMIT (%)* untuk monolith mendekati 100%, dan *CPU throttling* mulai naik. Ini bukti bottleneck ada di CPU.
4. Kembali ke **Live Demo**. *Event loop lag p99* naik tajam.
5. *DB pool: waiting connections*: kalau > 0, database juga mulai jadi hambatan.
6. *Error rate (k6)*: mulai naik di atas 0.

**Catat dua angka:**

- **Titik saturasi**: RPS saat p95 mulai naik.
- **Titik patah**: RPS saat error > 1% atau p95 > 500 ms.

Lalu ulangi untuk microservices dengan perintah yang sama (`only ms`, `reset-db ms`, `k6 stress ms ...`).

**Lihat di microservices:** pada *CPU used (cores) per service*, perhatikan service **mana** yang pertama mentok di batasnya. Biasanya order-service (batasnya 0.6 core) atau product-service (0.5 core). Service lain masih longgar.

**Ucapkan:**

> "Lihat anak tangganya. Di awal latency datar, itu fase linear. Di sini mulai naik, itu saturasi. Di sini melonjak dan error muncul, itu titik patahnya. Lalu kita cari penyebabnya: CPU monolith sudah 100% dari jatahnya, jadi bottleneck-nya komputasi."

> "Di microservices, yang menarik adalah kita bisa melihat **siapa** yang kewalahan. Bukan seluruh sistem, tapi satu service tertentu. Informasi ini yang nanti kita pakai untuk scaling."

**Yang biasanya terjadi:** titik patah microservices bisa **lebih rendah** dari monolith. Ini normal dan jujur untuk disampaikan: CPU-nya terbagi kecil-kecil, sehingga service tersibuk cepat mentok, sementara jatah CPU service lain menganggur. Inilah alasan langkah berikutnya (scaling) menarik.

---

### Langkah 4: Scale up monolith (tambah CPU)

**Tujuan:** menunjukkan cara paling sederhana menambah kapasitas, beserta kekurangannya.

**Perintah:** jalankan beban sedikit di atas titik patah monolith, lalu tambah CPU di tengah jalan.

```bash
# Terminal 1
./scripts/demo.sh only mono
./scripts/demo.sh k6 load mono RATE=<titik patah x 1.2> DURATION=4m

# Terminal 2, sekitar 1 menit kemudian
./scripts/demo.sh scale-up 4 4
```

`scale-up 4 4` berarti monolith diberi 4 CPU dan 4 worker (proses).

**Lihat di Grafana:**

- *Error rate (k6)*: muncul **lonjakan error beberapa detik** karena container dimatikan lalu dinyalakan ulang. Ini **downtime**.
- Setelah itu *Latency p95* turun dan stabil.
- *CPU used (cores) per service*: monolith sekarang bisa memakai lebih dari 2 core.

**Ucapkan:**

> "Scale up itu mudah: tidak perlu mengubah kode, cukup tambah CPU. Tapi lihat lonjakan error ini. Aplikasinya harus di-restart, jadi ada downtime. Selain itu, ada batas maksimal: kita tidak bisa menambah CPU melebihi mesin terbesar yang tersedia."

**Tambahan (opsional):** jalankan `./scripts/demo.sh scale-up 4 1` (4 CPU tapi hanya 1 worker). Performa hampir tidak naik.

> "Menambah CPU tidak ada gunanya kalau aplikasinya tidak bisa memakainya. Node.js hanya memakai 1 core per proses, jadi jumlah worker juga harus ditambah."

**Setelah selesai, kembalikan:** `./scripts/demo.sh scale-up 2 2`

---

### Langkah 5: Scale out (monolith vs microservices)

**Tujuan:** membandingkan "menggandakan seluruh aplikasi" dengan "menggandakan bagian yang sibuk saja".

**Bagian A, microservices:**

```bash
# Terminal 1
./scripts/demo.sh only ms
./scripts/demo.sh reset-db ms
./scripts/demo.sh k6 scaling ms RATE=120

# Terminal 2, setelah sekitar 1,5 menit (saat latency POST /orders tinggi)
./scripts/demo.sh scale ms order-service 3
```

Skenario `scaling` berisi 50% checkout, jadi bebannya berat di alur pesanan.

**Lihat di Grafana:**

- *Active replicas*: order-service berubah dari 1 menjadi 3.
- *Latency p95 per route* untuk `/api/orders`: turun.
- *Error rate (k6)*: **tidak ada lonjakan**. Scale out tidak butuh restart.
- *CPU used (cores) per service*: service lain tidak berubah.
- *Memory (RSS) per service*: bertambah sedikit (hanya 2 proses order-service baru).

**Bagian B, monolith:**

```bash
./scripts/demo.sh only mono
./scripts/demo.sh reset-db mono
./scripts/demo.sh k6 scaling mono RATE=120
# setelah sekitar 1,5 menit
./scripts/demo.sh scale mono 2
```

**Lihat:** *Memory (RSS) per service* monolith **berlipat dua**, karena semua modul ikut digandakan, termasuk yang tidak sibuk.

**Bandingkan di dashboard Monolith vs Microservices:** panel *Efficiency: requests per CPU-second*.

**Ucapkan:**

> "Di microservices, kita hanya menggandakan bagian yang antreannya panjang: order-service. Tanpa downtime, dan biayanya kecil. Di monolith, kita terpaksa menggandakan seluruh aplikasi, termasuk fitur login dan katalog yang sebenarnya tidak sibuk."

> "Tapi ingat: keuntungan ini hanya terasa kalau bebannya tidak merata. Kalau semua fitur sama-sama ramai, menggandakan seluruh monolith juga sama efektifnya."

**Setelah selesai, kembalikan:**

```bash
./scripts/demo.sh scale ms order-service 1
./scripts/demo.sh scale mono 1
```

> **Catatan:** kalau semuanya berjalan di satu mesin, scale out hanya membantu kalau mesin itu masih punya CPU nganggur. Scale out yang sebenarnya berarti menambah mesin (lihat [Kubernetes](04-kubernetes.md)).

---

### Langkah 6: Fault test (email provider mati)

**Tujuan:** membuktikan bahwa kegagalan satu bagian bisa (atau tidak bisa) menjatuhkan seluruh transaksi.

**Perintah:**

```bash
./scripts/demo.sh only mono
./scripts/demo.sh reset-db mono
./scripts/demo.sh k6 fault mono FAULT=email-down RATE=30

./scripts/demo.sh only ms
./scripts/demo.sh reset-db ms
./scripts/demo.sh k6 fault ms FAULT=email-down RATE=30
```

Tes berjalan 4 menit dengan jadwal otomatis:

| Detik | Kejadian |
|---|---|
| 0 sampai 60 | Normal |
| 60 sampai 150 | **Email provider mati** (otomatis) |
| 150 sampai 240 | Email provider pulih (otomatis) |

Selama tes, buka chaos panel (http://localhost:4000). Status **Email Provider** berubah menjadi **DOWN** di detik 60.

**Lihat di Grafana:**

| Panel | Monolith | Microservices |
|---|---|---|
| *Error rate (k6)* | Naik selama email mati | Tetap mendekati 0 |
| *Checkout results per second* | Muncul `notification_failed` | Tetap `paid` |
| *Notification queue (backlog)* | Tidak ada | Angka **RabbitMQ ready** naik, lalu turun setelah email pulih |
| *Email notifications per second* | `failed` | `failed` (dicoba ulang), lalu `sent` setelah pulih |

**Lihat juga:** RabbitMQ (http://localhost:15672, menu **Queues**): antrean `notification.order-paid` menumpuk, lalu terkuras.

**Contoh hasil nyata** (diuji di laptop, `RATE=30`, email mati 60 detik dari total 130 detik):

| | Monolith | Microservices |
|---|---|---|
| Checkout gagal (seluruh tes) | **44%** | **0%** |
| Katalog (GET /products) gagal | 0% | 0% |
| p95 checkout | 365 ms | 317 ms |

Di monolith, hampir semua checkout selama email mati gagal. Katalog tidak terpengaruh di kedua arsitektur karena tidak memakai email.

**Ucapkan:**

> "Di monolith, kirim email adalah bagian dari proses checkout. Saat email mati, checkout ikut gagal. Pembeli sudah bayar, tapi melihat error. Ini contoh **coupling**."

> "Di microservices, order-service hanya menitipkan pesan ke RabbitMQ lalu langsung menjawab 'pesanan berhasil'. Email dikirim belakangan. Saat email mati, pesan menunggu di antrean. Begitu pulih, semua email terkirim. Pembeli tidak merasakan apa-apa."

> "Tapi jujur saja: yang menyelamatkan di sini adalah desain **asynchronous**, bukan semata-mata karena microservices. Monolith juga bisa dibuat asynchronous, dan microservices yang saling menunggu juga bisa sama rapuhnya."

**Variasi untuk membuktikan kalimat terakhir (opsional):**

```bash
# Microservices dibuat sinkron (distributed monolith): hasilnya sama buruknya dengan monolith
MS_NOTIFICATION_MODE=sync docker compose -f docker-compose.microservices.yml up -d order-service
./scripts/demo.sh k6 fault ms FAULT=email-down RATE=30
# kembalikan
docker compose -f docker-compose.microservices.yml up -d order-service
```

**Variasi lain: matikan service secara langsung saat load test berjalan.**

```bash
./scripts/demo.sh kill ms notification-service
# tunggu 30 detik, lihat antrean RabbitMQ bertambah, checkout tetap sukses
./scripts/demo.sh revive ms notification-service
# antrean terkuras
```

---

### Langkah 7: Noisy neighbor (tetangga yang berisik)

**Tujuan:** menunjukkan bahwa di monolith, fitur yang rakus CPU bisa memperlambat fitur lain.

**Perintah:**

```bash
./scripts/demo.sh only mono
./scripts/demo.sh k6 noisy-neighbor mono

./scripts/demo.sh only ms
./scripts/demo.sh k6 noisy-neighbor ms
```

Tes berjalan 4 menit:

- Sepanjang tes: 50 request per detik melihat katalog (ringan).
- Mulai detik 60: "serbuan login" sampai 250 login per detik (default). Login itu berat karena password di-hash (butuh banyak CPU).

> **Penting:** serbuan login harus **melebihi** kapasitas CPU monolith. Kalau terlalu kecil, monolith sanggup menampungnya dan tidak ada efek yang terlihat. Saat gladi, pastikan grafik *CPU vs LIMIT* monolith menyentuh 100% saat serbuan dimulai. Kalau belum, naikkan dengan `LOGIN_RATE=350`. Di VPS yang lebih lambat, angka lebih kecil (misalnya 150) mungkin sudah cukup.

**Lihat di Grafana:**

- *Latency p95 per endpoint (k6)*, garis **GET /products**:
  - Monolith: **ikut naik** saat serbuan login dimulai.
  - Microservices: **tetap rendah**.
- Garis **POST /users/login**:
  - Monolith: melambat (antre beberapa detik), tapi sebagian besar tetap berhasil.
  - Microservices: **jauh lebih parah**. Banyak login gagal karena timeout.
- *CPU used (cores) per service*: monolith mentok di 2 core. Di microservices, user-service mentok di 0.3 core, sementara product-service santai.
- *Error rate (k6)*: di microservices naik tinggi, dan semuanya berasal dari login.

**Contoh hasil nyata** (diuji di laptop):

| | Monolith (250 login/detik) | Microservices (60 login/detik) |
|---|---|---|
| p95 katalog | 2 ms → **67 ms** (sekitar 30× lebih lambat) | tetap **2 ms** |
| Login berhasil | 99% (tapi antre sekitar 12 detik) | hanya **20%** (sisanya timeout 30 detik) |

**Ucapkan:**

> "Bayangkan ada promo yang membuat semua orang login bersamaan. Di monolith, semua fitur berbagi CPU yang sama, jadi orang yang hanya ingin melihat katalog ikut kena lambat. Ini yang disebut noisy neighbor."

> "Di microservices, login punya 'ruangan' sendiri. Katalog tetap lancar, kerusakannya terkurung di satu tempat."

> "Tapi lihat harganya: login di microservices justru jauh lebih cepat tumbang. Kenapa? Karena user-service hanya dapat 0,3 core, sedangkan di monolith login bisa 'meminjam' seluruh 2 core. Jadi isolasi itu pedang bermata dua: kerusakan tidak menyebar, tapi setiap bagian punya cadangan tenaga lebih kecil. Karena itu microservices **harus** dibarengi monitoring dan autoscaling per service."

> "Solusinya juga tidak selalu harus pindah ke microservices. Bisa dengan rate limiting di login, atau memisahkan **hanya** fitur login saja."

---

### Langkah 8 (opsional): Spike test (flash sale)

**Tujuan:** melihat reaksi sistem saat pengunjung tiba-tiba naik 10 kali lipat dalam 10 detik.

```bash
./scripts/demo.sh k6 spike mono BASE_RATE=30 SPIKE_RATE=300
./scripts/demo.sh k6 spike ms BASE_RATE=30 SPIKE_RATE=300
```

Untuk variasi flash sale yang lebih realistis (semua orang membeli 5 produk yang sama), tambahkan `HOT_PRODUCTS=5 ORDER_RATIO=0.4`.

**Lihat:** lonjakan *Latency p95* dan *Error rate* saat spike, lalu **berapa lama** grafik kembali normal setelah spike selesai.

**Ucapkan:**

> "Yang penting bukan hanya 'apakah sistem bertahan', tapi juga 'berapa cepat pulih'. Sistem yang baik mungkin melambat saat lonjakan, tapi langsung normal begitu lonjakan reda."

---

### Langkah 9 (opsional): Soak test

**Tujuan:** mendeteksi kebocoran memory atau penurunan performa perlahan dalam waktu lama.

Jalankan **sebelum webinar** karena butuh 1 jam, lalu tunjukkan hasilnya saja:

```bash
./scripts/demo.sh k6 soak mono RATE=50 DURATION=1h
```

**Lihat:** *Memory (RSS) per service* dan *DB pool: waiting connections* harus **datar** sepanjang 1 jam. Kalau memory terus naik tanpa turun, itu tanda memory leak.

---

### Langkah 10: Rangkuman dan kesimpulan

**Perintah:**

```bash
./scripts/demo.sh compare
```

Tabel hasil semua tes akan dicetak. Buka juga dashboard **TokoKu: Monolith vs Microservices** dan pilih rentang waktu yang mencakup tes yang ingin dibandingkan.

**Ringkasan yang bisa disampaikan:**

| Aspek | Pemenang biasanya | Kenapa |
|---|---|---|
| Latency di beban normal | Monolith | Tidak ada lompatan jaringan |
| Kesederhanaan dan biaya kecil | Monolith | Lebih sedikit container, memory, dan komponen |
| Scaling bagian tertentu | Microservices | Bisa menggandakan service yang sibuk saja |
| Isolasi gangguan | Microservices (dengan desain async) | Kegagalan tidak merambat ke fitur lain |
| Menahan lonjakan di satu fitur tanpa autoscaling | Monolith | Semua fitur berbagi CPU, jadi ada cadangan tenaga lebih besar |
| Konsistensi data | Monolith | Satu transaksi database, tidak perlu kompensasi |

**Kalimat penutup:**

> "Jadi bukan soal mana yang lebih hebat. Monolith unggul di kesederhanaan dan efisiensi saat skala kecil. Microservices unggul saat bagian tertentu butuh scaling sendiri atau saat tim sudah banyak. Saran saya: scale up dan optimasi dulu sampai mentok. Pindah ke microservices kalau masalahnya sudah nyata, bukan karena ikut tren."

**Rapikan setelah demo:**

```bash
./scripts/demo.sh up
```

Perintah ini menyalakan kembali kedua arsitektur.

---

## Bagian C: Penjelasan setiap grafik Grafana

### Cara umum membaca grafik

- **Sumbu X** adalah waktu. **Sumbu Y** adalah nilai (lihat satuannya: `ms`/`s`, `req/s`, `%`, `cores`, `MiB`).
- Setiap garis punya label di bawah grafik. Format labelnya biasanya `arsitektur · service · route`.
- Tabel legend di bawah grafik menampilkan **Last** (nilai terakhir), **Max** (tertinggi), dan **Mean** (rata-rata).
- Arahkan mouse ke satu grafik, dan garis waktu di **semua** grafik ikut bergerak. Ini cara paling ampuh untuk menunjukkan hubungan sebab akibat, misalnya "saat CPU mentok di sini, latency melonjak di sini".
- Klik nama di legend untuk menampilkan garis itu saja. Ctrl+klik untuk memilih beberapa.
- Variabel **Architecture** di pojok kiri atas dashboard Live Demo untuk memfilter monolith, microservices, atau keduanya.

---

### Dashboard 1: TokoKu: Live Demo

Dashboard utama selama demo. Dibagi menjadi empat baris, mengikuti alur berpikir: **beban → kinerja → sumber daya → komponen pendukung.**

#### Baris ①: Load from k6 (client side)

Grafik di baris ini dilihat **dari sisi pembeli** (k6), termasuk waktu lewat gateway dan jaringan.

| Grafik | Artinya | Normal | Tanda masalah |
|---|---|---|---|
| **Active virtual users** | Jumlah "pembeli palsu" k6 yang sedang aktif | Rendah dan stabil | **Naik terus**. k6 mengirim request dengan laju tetap; kalau server melambat, k6 butuh lebih banyak pembeli yang menunggu bersamaan. Jadi VU yang membengkak adalah tanda server mulai lambat. |
| **Requests/sec (k6)** | Berapa request per detik yang dikirim k6 | Sama dengan `RATE` yang diminta | Lebih rendah dari `RATE`. Artinya server terlalu lambat sehingga k6 tidak sanggup mengirim sesuai target (di terminal muncul `dropped_iterations`). |
| **Latency p95 per endpoint (k6)** | Waktu tunggu 95% pembeli, dipisah per endpoint | Datar. Katalog puluhan ms, checkout 200 sampai 400 ms (karena payment gateway 100 sampai 300 ms) | Naik tajam. Abaikan garis `setup` dan `chaos`, itu request persiapan. |
| **Error rate (k6)** | Persentase request yang gagal (status 4xx/5xx atau timeout) | 0% | Di atas 1% (titik patah). |

**Kalimat:** "Baris pertama ini adalah apa yang dirasakan pembeli. Baris di bawahnya menjelaskan kenapa."

#### Baris ②: Application: RED (Rate, Errors, Duration)

RED adalah tiga pertanyaan dasar untuk setiap aplikasi: **berapa banyak** request (Rate), **berapa yang gagal** (Errors), **berapa lama** (Duration). Grafik di baris ini diukur **dari sisi aplikasi** (tanpa gateway).

| Grafik | Artinya | Cara membaca |
|---|---|---|
| **Throughput per service (including internal traffic)** | Jumlah request yang diterima setiap aplikasi per detik, termasuk request antar service | Di monolith, angkanya kira-kira sama dengan RPS k6. Di microservices, **total semua garis lebih besar dari RPS k6**, karena 1 checkout memicu request internal: order-service memanggil product-service (cek stok) dan payment-service (bayar). Ini disebut **amplifikasi trafik**. |
| **Latency p95 per route** | Waktu proses di dalam aplikasi, per alamat (route) | Route `/internal/...` adalah request antar service. Bandingkan dengan grafik latency k6: selisihnya adalah waktu di gateway dan jaringan. Route yang paling dulu naik menunjukkan sumber masalah. |
| **Error 5xx per service** | Jumlah error server per detik, per service dan route | Kosong saat normal. Saat fault test di monolith, muncul garis `/api/orders`. Garis ini menunjukkan **service mana** yang menghasilkan error. |
| **Network hop cost: outbound call latency p95** | Lama waktu saat aplikasi memanggil pihak lain (service lain atau pihak ketiga) | Monolith hanya memanggil `payment-gateway` dan `email-provider`. Microservices juga memanggil `product-service` dan `payment-service`. Garis antar service yang bernilai beberapa milidetik itulah **biaya tambahan microservices**. Garis `payment-gateway` (100 sampai 300 ms) biasanya paling tinggi: itu waktu tunggu ke "bank". |
| **Checkout results per second** | Hasil akhir checkout per detik, menurut status | `paid` = sukses. `payment_failed` / `payment_error` = pembayaran gagal. `notification_failed` = sudah dibayar tapi gagal kirim email (muncul di monolith saat fault test). |
| **Logins per second (CPU-bound)** | Jumlah login per detik | Login sengaja dibuat berat (hashing password). Garis ini naik saat tes noisy neighbor. |

#### Baris ③: Resources (USE) per app process

USE adalah tiga pertanyaan untuk sumber daya: seberapa **terpakai** (Utilization), seberapa **jenuh** atau mengantre (Saturation), dan ada **error** atau tidak. Grafik di baris ini diukur dari dalam proses aplikasi.

| Grafik | Artinya | Cara membaca |
|---|---|---|
| **CPU used (cores) per service** | Berapa core CPU yang dipakai setiap aplikasi. 1.0 = satu core penuh | Bandingkan dengan jatahnya: monolith 2.0, order-service 0.6, product-service 0.5, user/payment/notification 0.3. **Garis yang datar persis di jatahnya** berarti aplikasi itu sudah mentok (bottleneck CPU). |
| **Memory (RSS) per service** | Memory yang dipakai setiap aplikasi | Satu proses Node.js memakai sekitar 50 sampai 100 MB walaupun tidak sibuk. Microservices punya 5 proses, jadi totalnya lebih besar. Saat scale out monolith, memory langsung berlipat. Di soak test, garis ini harus datar. |
| **Event loop lag p99 (Node.js)** | Seberapa lama request harus mengantre sebelum diproses, karena Node.js mengerjakan satu hal dalam satu waktu | Normal sekitar 10 sampai 20 ms. **Naik ke ratusan ms** berarti proses sedang sibuk menghitung, dan **semua** request di proses itu ikut menunggu. Ini grafik kunci untuk noisy neighbor. |
| **DB pool: waiting connections** | Jumlah query yang menunggu giliran koneksi ke database | Normal 0. Kalau terus di atas 0, database atau jumlah koneksinya menjadi hambatan. |
| **DB query latency p95** | Lama query ke database | Normal beberapa milidetik. Kalau naik sementara CPU aplikasi rendah, masalahnya ada di database. Cek CPU container postgres di dashboard Containers. |
| **Active replicas** | Jumlah salinan (replika) setiap aplikasi yang sedang hidup | Normal 1. Naik saat `./scripts/demo.sh scale ...`. Saat scale up monolith, garis ini sempat hilang sebentar (container restart). |

**Urutan mencari bottleneck** (ucapkan saat stress test):

1. CPU mentok di jatahnya? Berarti bottleneck **komputasi**.
2. Memory mendekati batas? Berarti bottleneck **memory**.
3. CPU rendah tapi DB pool mengantre atau query lambat? Berarti bottleneck **database**.
4. Semua rendah tapi tetap lambat? Cek **pihak luar** di grafik *Network hop cost*.

#### Baris ④: Async, message broker & third parties

| Grafik | Artinya | Cara membaca |
|---|---|---|
| **Email notifications per second** | Jumlah percobaan kirim email per detik, menurut mode (`sync`/`async`) dan hasil (`sent`/`failed`) | Saat email provider mati, garis `failed` muncul. Di microservices, setelah pulih muncul lonjakan `sent` karena antrean dikirim ulang. |
| **Notification queue (backlog)** | Jumlah email yang menunggu dikirim | `RabbitMQ ready` = pesan menunggu diambil. `RabbitMQ unacked` = sedang diproses. `monolith in-memory` = antrean di memory monolith (hanya kalau mode async). Saat email mati, **naik seperti gunung**, lalu turun setelah pulih. Grafik terbaik untuk menjelaskan asynchronous. |
| **Requests to third parties** | Request ke payment gateway dan email provider, menurut hasil | `success`, `declined`, `error`, `down`. Berguna untuk membuktikan bahwa gangguan memang berasal dari pihak ketiga, bukan dari aplikasi kita. |

---

### Dashboard 2: TokoKu: Containers (cAdvisor)

Dashboard ini melihat dari **sisi container** (seperti meteran listrik per ruangan). Hasilnya mencakup semua container, termasuk database, gateway, dan RabbitMQ.

Variabel **Compose project** di pojok kiri atas: `tokoku-mono`, `tokoku-ms`, atau `tokoku-infra`.

#### Baris CPU

| Grafik | Artinya | Cara membaca |
|---|---|---|
| **CPU used per container (cores)** | CPU yang dipakai setiap container | Mirip dengan grafik CPU di Live Demo, tapi juga menampilkan postgres, nginx, dan RabbitMQ. Berguna untuk melihat apakah database ikut sibuk. |
| **CPU vs LIMIT (%)** | Persentase CPU terpakai dibanding jatahnya | **Grafik paling jelas untuk bottleneck CPU.** 100% berarti container sudah memakai seluruh jatahnya dan tidak bisa lebih cepat lagi. |
| **CPU throttling (% of periods throttled)** | Seberapa sering sistem operasi "menahan" container karena jatah CPU-nya habis | Analogi: kuota internet habis lalu kecepatannya dibatasi. Kalau naik, proses sering dihentikan sejenak, dan latency melonjak. Biasanya naik bersamaan dengan *CPU vs LIMIT* mendekati 100%. |
| **Total CPU per architecture** | Total CPU semua container per arsitektur | Untuk membandingkan **biaya** keseluruhan, termasuk database, gateway, dan RabbitMQ. |

#### Baris Memory

| Grafik | Artinya | Cara membaca |
|---|---|---|
| **Memory working set per container** | Memory yang dipakai setiap container | Bandingkan postgres, RabbitMQ, dan aplikasi. |
| **Memory vs LIMIT (%)** | Persentase memory dibanding jatahnya | Mendekati 100% berbahaya: container bisa dimatikan paksa (OOM kill). |
| **Total memory per architecture** | Total memory per arsitektur | Biasanya microservices lebih besar karena lebih banyak proses dan ada RabbitMQ. Ini biaya nyata yang perlu ditunjukkan di kesimpulan. |
| **OOM events** | Berapa kali container dimatikan karena kehabisan memory | Harus selalu 0. |

#### Baris Network

| Grafik | Artinya | Cara membaca |
|---|---|---|
| **Network receive per container** | Data masuk ke setiap container per detik | Di microservices, terlihat trafik ke product-service, payment-service, dan RabbitMQ yang tidak ada di monolith. Ini bukti visual komunikasi antar service. |
| **Network transmit per container** | Data keluar dari setiap container per detik | Sama seperti di atas, arah sebaliknya. |

---

### Dashboard 3: TokoKu: Monolith vs Microservices

Dashboard untuk **rangkuman dan perbandingan** setelah tes, bukan untuk ditonton real time.

**Cara pakai:**

1. Jalankan tes yang sama untuk monolith lalu microservices, dengan durasi yang sama.
2. Pilih rentang waktu (pojok kanan atas, atau drag di grafik) yang mencakup **kedua** tes. Buang 1 menit pertama (warm-up).
3. Setiap angka akan tampil dua kali: satu untuk monolith dan satu untuk microservices.

#### Baris Summary over the selected time range (kotak angka)

| Panel | Artinya | Lebih baik jika |
|---|---|---|
| **p95 GET /products** | Latency p95 katalog selama rentang waktu | Lebih kecil |
| **p95 POST /orders** | Latency p95 checkout selama rentang waktu | Lebih kecil |
| **Average RPS (edge)** | Rata-rata request per detik dari pembeli (tanpa request internal) | Lebih besar |
| **Error rate 5xx** | Persentase error server | Lebih kecil (hijau < 1%, oranye < 5%, merah ≥ 5%) |
| **Average app CPU (cores)** | Rata-rata CPU aplikasi | Lebih kecil untuk beban yang sama |
| **Average CPU, all containers (cores)** | Rata-rata CPU semua container, termasuk database, gateway, RabbitMQ | Lebih kecil untuk beban yang sama |
| **Efficiency: requests per CPU-second** | Berapa request yang dilayani per 1 detik kerja CPU | **Lebih besar.** Ini angka "irit atau boros". Biasanya monolith lebih irit karena tidak ada request internal. |
| **Current app memory** | Memory aplikasi saat ini | Lebih kecil |

> **Penting:** *Average RPS* dan *Average CPU* dihitung rata-rata **sepanjang rentang waktu yang dipilih**, termasuk saat arsitektur itu sedang dimatikan. Untuk angka absolut, zoom ke rentang satu tes saja. Untuk perbandingan, pastikan kedua tes berdurasi sama. Panel p95, error rate, dan efficiency tidak terpengaruh.

#### Baris Over time (grafik)

| Grafik | Artinya |
|---|---|
| **Throughput (edge requests/sec)** | RPS dari pembeli, garis per arsitektur |
| **Error rate 5xx** | Persentase error dari waktu ke waktu |
| **Latency GET /api/products: p50 / p95 / p99** | Tiga garis per arsitektur. p50 = pengunjung "rata-rata", p95 = 5% terlambat, p99 = 1% terlambat. Jarak lebar antara p50 dan p99 berarti pengalaman pengunjung tidak konsisten. |
| **Latency POST /api/orders: p50 / p95 / p99** | Sama, untuk checkout |
| **App CPU (cores)** | CPU aplikasi per arsitektur |
| **Efficiency: edge requests per CPU-second** | Efisiensi dari waktu ke waktu. Biasanya turun saat sistem jenuh. |

---

## Bagian D: Glosarium

| Istilah | Penjelasan sederhana |
|---|---|
| **Request** | Satu permintaan dari pembeli, misalnya membuka katalog atau checkout |
| **RPS** | Request per second: jumlah permintaan per detik |
| **Latency** | Waktu tunggu dari request dikirim sampai jawaban diterima |
| **p50 / p95 / p99** | Persentil. p95 = 200 ms artinya 95% request selesai di bawah 200 ms |
| **Throughput** | Jumlah request yang **berhasil** dilayani per detik |
| **VU (virtual user)** | Pembeli palsu yang dijalankan k6 |
| **Smoke / Load / Stress / Spike / Soak test** | Cek fungsi / beban normal / beban naik sampai patah / lonjakan mendadak / beban lama |
| **Bottleneck** | Bagian paling lambat yang membatasi seluruh sistem, seperti leher botol |
| **Saturasi** | Kondisi saat sumber daya hampir penuh dan antrean mulai terbentuk |
| **Breaking point** | Beban saat sistem mulai gagal (error > 1% atau terlalu lambat) |
| **Scale up (vertikal)** | Memperbesar mesin: tambah CPU atau RAM |
| **Scale out (horizontal)** | Menambah jumlah salinan aplikasi |
| **Replika** | Salinan aplikasi yang berjalan bersamaan untuk membagi beban |
| **Downtime** | Waktu saat aplikasi tidak bisa diakses |
| **CPU limit / jatah** | Batas maksimal CPU yang boleh dipakai sebuah container |
| **Throttling** | Container ditahan sejenak karena jatah CPU-nya habis |
| **Event loop** | Cara Node.js bekerja: satu antrean pekerjaan per proses |
| **Worker** | Proses Node.js tambahan agar bisa memakai lebih dari satu core |
| **Connection pool** | Sekumpulan koneksi database yang dipakai bergantian |
| **Synchronous (sync)** | Menunggu sampai pekerjaan selesai baru lanjut |
| **Asynchronous (async)** | Titip pekerjaan, lanjut dulu, pekerjaan dikerjakan belakangan |
| **Message broker (RabbitMQ)** | Tempat penitipan pesan antar aplikasi |
| **Backlog** | Pekerjaan yang menumpuk dan belum dikerjakan |
| **Coupling** | Ketergantungan erat: kalau satu rusak, yang lain ikut rusak |
| **Noisy neighbor** | Satu bagian yang rakus sumber daya mengganggu bagian lain |
| **Gateway** | Pintu masuk tunggal yang meneruskan request ke aplikasi yang tepat |
| **Saga / kompensasi** | Cara membatalkan langkah sebelumnya secara manual kalau langkah berikutnya gagal (misalnya mengembalikan stok saat pembayaran gagal) |
| **OOM** | Out of memory: kehabisan memory sehingga dimatikan paksa |

---

## Bagian E: Kalau ada masalah saat demo

| Masalah | Penyebab umum | Solusi cepat |
|---|---|---|
| Grafik kosong ("No data") | Rentang waktu salah, atau arsitektur sedang mati | Set "Last 15 minutes". Cek variabel **Architecture**. Jalankan `./scripts/demo.sh ps`. |
| Grafik k6 kosong, grafik aplikasi ada | k6 belum jalan, atau gagal mengirim ke Prometheus | Pastikan menjalankan k6 lewat `./scripts/demo.sh k6 ...` |
| Smoke test gagal setelah `up` | Aplikasi masih menyiapkan database | Tunggu 20 detik lalu ulangi |
| Error 502 di storefront | Container sedang restart (misalnya setelah scale-up) | Tunggu beberapa detik |
| Muncul peringatan `Insufficient VUs` di k6 | Server terlalu lambat untuk RATE yang diminta | Normal saat stress test. Untuk load test, turunkan RATE |
| Laptop sangat lambat | k6 dan semua container berebut CPU | Pakai `only mono`/`only ms`, turunkan RATE, atau jalankan k6 dari mesin lain |
| Titik patah terlalu tinggi (laptop terlalu kuat) | Beban CPU per request terlalu ringan | Naikkan `FRAUD_CHECK_ROUNDS` di `.env` (misalnya 6000), lalu `./scripts/demo.sh up` |
| Hasil berantakan setelah banyak tes | Data pesanan menumpuk | `./scripts/demo.sh reset-db mono` / `ms` |
| Ada yang macet total | Container bermasalah | `./scripts/demo.sh down mono` lalu `./scripts/demo.sh up mono` |
