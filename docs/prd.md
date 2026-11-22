# PRD: Penjadwal Video Pendek (YouTube Shorts, Instagram Reels, TikTok)

| | |
|---|---|
| Versi | 1.2 (arsitektur diperbarui: Vercel + Supabase + pekerja di laptop) |
| Tanggal | 21 November 2026 |
| Pemilik produk | Pemilik channel (pengguna tunggal) |
| Dokumen terkait | Dokumen desain "Desain Aplikasi Penjadwal Video Pendek" |

---

## 1. Ringkasan

Aplikasi web yang dapat dibuka dari browser mana pun (diterbitkan di Vercel), dengan data, login, dan penyimpanan di Supabase, serta sebuah **pekerja penjadwal** yang berjalan di laptop pemilik (menyala 24 jam). Pemilik masuk, mengunggah **satu video** beserta **caption, hashtag, dan thumbnail**, memilih slot jadwal, lalu aplikasi menerbitkan video itu ke **YouTube Shorts, Instagram Reels, dan TikTok** pada jam yang ditentukan.

## 2. Latar belakang dan masalah

Pemilik memposting **4 video pendek per hari**. Saat ini setiap video diunggah manual tiga kali: YouTube Shorts, lalu Instagram, lalu TikTok. Itu berarti 12 unggahan manual per hari, dengan isian caption dan hashtag yang diulang.

**Masalah yang diselesaikan:** pekerjaan unggah berulang yang melelahkan dan memakan waktu.

## 3. Tujuan dan ukuran keberhasilan

| # | Tujuan | Ukuran keberhasilan |
|---|---|---|
| T1 | Satu kali unggah untuk tiga platform | Pemilik mengisi satu form per video, tanpa membuka aplikasi YouTube, Instagram, atau TikTok untuk mengunggah |
| T2 | Mampu 4 video per hari | 12 posting per hari terbit tanpa langkah manual |
| T3 | Terbit sesuai jadwal | Minimal 95% posting terbit dalam 5 menit dari jam jadwal (usulan; bisa disesuaikan) |
| T4 | Tanpa biaya | Rp0 biaya langganan atau lisensi |
| T5 | Tidak ada posting ganda | 0 video terbit dua kali di satu platform |

## 4. Pengguna

**Pengguna tunggal:** pemilik channel, yang mengelola akun YouTube, Instagram, dan TikTok miliknya sendiri. Aplikasi tidak dirancang untuk pengguna lain pada versi ini. Hanya pemilik yang dapat masuk (login); pendaftaran umum dimatikan.

## 5. Ruang lingkup

### Termasuk (versi 1)

- Form unggah: video, thumbnail (gambar), judul YouTube, caption, hashtag, slot.
- Jadwal berbasis slot harian dalam WIB, dengan penimpaan jam per video.
- Penerbitan otomatis ke YouTube Shorts dan Instagram Reels lewat API resmi.
- Penerbitan otomatis ke TikTok lewat API Buffer (paket gratis).
- Halaman antrean yang menampilkan status per platform.
- Penanganan gagal, ulang, terlewat, dan pencegahan posting ganda.
- Login pemilik (email dan kata sandi) dan akses dari browser mana pun, termasuk ponsel.
- Pekerja penjadwal di laptop pemilik, dengan peringatan bila pekerja berhenti.

### Tidak termasuk (versi 1)

- Banyak pengguna, pendaftaran umum, penagihan.
- Pemindahan pekerja ke cloud atau server (direncanakan kelak; lihat bagian 15).
- Thumbnail kustom untuk TikTok (pemilik mengurusnya sendiri; aplikasi tidak mengirim pengaturan cover ke TikTok).
- Analitik, balasan komentar, penyuntingan video.
- Otomatisasi browser (dilarang karena berisiko bagi akun).
- Audit TikTok sendiri dan App Review Meta penuh.

## 6. Alur pengguna utama

1. Pemilik membuka aplikasi di browser dan masuk (login).
2. Menekan **+ Video baru**.
3. Mengisi form: video, thumbnail, judul (opsional), caption, hashtag.
4. Aplikasi menyarankan slot kosong berikutnya. Pemilik menerima atau mengganti jamnya.
5. Menyimpan. Video muncul di antrean dengan status **terjadwal** untuk tiga platform.
6. Pada jam slot, aplikasi menerbitkan. Status berubah menjadi **terbit** atau **gagal** per platform.

Sketsa halaman antrean:

```
[ + Video baru ]   Slot harian: 06:00 · 12:00 · 16:00 · 19:00 (WIB)

Antrean
 Sen 23 Nov 06:00  klip_tips_01.mp4   YT ✓ terbit  IG ✓ terbit  TT ✓ terbit
 Sen 23 Nov 12:00  klip_tips_02.mp4   YT ✓ terjadwal  IG … terjadwal  TT … terjadwal
 Sen 23 Nov 16:00  (slot kosong)
```

## 7. Kebutuhan fungsional

### 7.1 Unggah dan data video

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-1 | Pemilik dapat mengunggah satu berkas video per entri, maksimal 50 MB (batas paket gratis Supabase). | Berkas tersimpan di penyimpanan Supabase; entri muncul di antrean. Berkas lebih besar ditolak dengan saran mengompres. |
| FR-2 | Pemilik dapat mengunggah gambar thumbnail (JPEG atau PNG). | Gambar dipakai untuk YouTube dan Instagram. Instagram menerima JPEG maksimal 8 MB. |
| FR-3 | Pemilik dapat mengisi caption dan hashtag yang sama untuk ketiga platform. | Teks yang sama terkirim ke tiga platform. |
| FR-4 | Judul YouTube bersifat opsional. | Bila kosong, judul diambil dari baris pertama caption dan dipotong 100 karakter. |
| FR-5 | Bila thumbnail tidak diunggah, YouTube dan Instagram memakai frame bawaan. | Posting tetap terbit tanpa error. |
| FR-6 | Aplikasi memeriksa batas dasar sebelum menyimpan (video ada dan tidak melebihi 50 MB, caption tidak melebihi batas platform, thumbnail sesuai format). | Kesalahan ditampilkan sebelum disimpan, bukan saat jam terbit. |

### 7.2 Penjadwalan

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-7 | Pemilik menentukan slot harian satu kali dalam WIB. Pengaturan awal: **4 slot per hari pada 06:00, 12:00, 16:00, dan 19:00**. | Slot tersimpan dan dipakai terus sampai diubah; jam dan jumlah slot dapat diubah kapan saja. |
| FR-8 | Video baru otomatis diberi slot kosong berikutnya. | Tidak ada dua video di slot yang sama. |
| FR-9 | Pemilik dapat menimpa jam terbit per video. | Jam baru berlaku untuk ketiga platform. |
| FR-10 | Pemilik dapat menghapus atau mengubah entri yang belum terbit. | Perubahan ikut membatalkan atau menggantikan jadwal di YouTube dan Buffer. |

### 7.3 Penerbitan per platform

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-11 | **YouTube:** video diunggah dengan status privat dan waktu terbit terjadwal (publishAt). | YouTube menerbitkan tepat waktu walau laptop mati. |
| FR-12 | **YouTube:** thumbnail dipasang setelah video selesai diproses. | Thumbnail terlihat pada video Shorts. |
| FR-13 | **Instagram:** pada jam slot, aplikasi membuat dan menerbitkan Reels dengan caption dan cover. | Reels muncul di akun pada jamnya. |
| FR-14 | **Instagram:** sebelum memposting, aplikasi memeriksa sisa batas posting harian. | Bila batas habis, status gagal dengan alasan jelas. |
| FR-15 | **TikTok:** pekerja membuat tautan sementara ke video di Supabase Storage, lalu menjadwalkan posting di Buffer dengan waktu terbit yang sama. | Posting TikTok terbit publik pada jamnya. |
| FR-16 | **TikTok:** tautan sementara berlaku sampai setelah jam terbit, dan berkas dihapus dari penyimpanan setelah masa simpan. | Buffer dapat mengambil video saat jam terbit; tidak ada berkas tersisa setelah masa simpan. |
| FR-17 | **TikTok:** aplikasi hanya mengirim ke Buffer posting yang jamnya masuk jendela pengiriman bergulir. Nilai awal: **2 hari ke depan** (8 posting), dapat diubah di pengaturan. Posting yang jamnya lebih jauh disimpan lokal dan dikirim otomatis begitu ada ruang di antrean Buffer. | Antrean Buffer tidak pernah melampaui batas paket gratis. Nilai akhir ditetapkan setelah batas antrean Buffer dikonfirmasi pada tahap percobaan kecil. |

### 7.4 Status, gagal, dan keandalan

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-18 | Setiap platform punya status sendiri: draf, terjadwal, mengunggah, terbit, gagal, terlewat. | Gagal di satu platform tidak membatalkan platform lain. |
| FR-19 | Percobaan ulang otomatis 3 kali dengan jeda yang makin panjang. | Setelah 3 kali gagal, status "gagal" beserta alasannya tampil di halaman utama. |
| FR-20 | Pencegahan posting ganda: setiap target punya kunci unik. | Mulai ulang aplikasi atau percobaan ulang tidak membuat posting ganda. |
| FR-21 | Video terlewat: bila laptop mati atau offline saat jam Instagram, aplikasi mengejar setelah hidup lagi dalam batas keterlambatan yang dapat diatur. Nilai awal **2 jam**; pemilik dapat memperpendek (minimal 5 menit). | Lewat batas itu, status "terlewat" dengan peringatan jelas; tidak diposting diam-diam. Pekerja memeriksa jadwal setiap 30 detik agar keterlambatan sekecil mungkin. |
| FR-22 | Pekerja menyala otomatis saat laptop hidup. | Setelah restart, penjadwal berjalan lagi tanpa tindakan manual. |

### 7.5 Akun dan rahasia

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-23 | Pemilik menghubungkan akun YouTube, Instagram, dan Buffer sekali. | Setelah terhubung, tidak perlu masuk lagi untuk tiap posting. |
| FR-24 | Token Instagram diperbarui otomatis sebelum masa 60 harinya habis. | Tidak ada posting gagal karena token kedaluwarsa. |
| FR-25 | Token dan API key disimpan terenkripsi di database dan tidak dapat dibaca dari browser. Kunci enkripsi hanya ada di lingkungan server (Vercel dan pekerja). | Tidak ada rahasia di repositori atau di respons API; pengguna login pun tidak dapat membaca token. |
| FR-26 | Berkas video di Supabase Storage dan cache di laptop dihapus beberapa hari setelah semua target mencapai status akhir. | Penyimpanan 1 GB tidak penuh. |

### 7.6 Akses, login, dan operasional

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-27 | Pemilik masuk dengan email dan kata sandi; autentikasi dua faktor tersedia. Pendaftaran umum dimatikan. | Orang lain tidak dapat membuat akun atau membaca data. |
| FR-28 | Pekerja mencatat detak ke database setiap putaran; antarmuka menampilkan peringatan bila pekerja berhenti lebih dari 3 menit. | Pemilik tahu bila laptop atau pekerja mati, walau membuka aplikasi dari tempat lain. |
| FR-29 | Tindakan pemilik yang butuh pekerja (coba lagi, batalkan di platform, ubah entri yang sudah dikirim) ditampilkan sebagai "menunggu pekerja" sampai dikerjakan. | Pemilik melihat tindakan tertunda dan alasannya. |
| FR-30 | Pekerja mengekspor data inti ke laptop setiap hari dan menyimpan 7 salinan terakhir. | Data dapat dipulihkan walau paket gratis Supabase tanpa cadangan otomatis. |
| FR-31 | Aplikasi memperkirakan pemakaian storage dan egress bulan ini dan memperingatkan saat mencapai 80% kuota gratis. | Pemilik tidak terkejut saat kuota habis. |

## 8. Kebutuhan non-fungsional

- **Biaya:** Rp0. Hanya tingkat gratis: Vercel Hobby, Supabase Free, dan Buffer Free. Vercel Hobby hanya untuk pemakaian pribadi nonkomersial; bila kelak dijual, perlu paket berbayar.
- **Ketersediaan:** halaman dan data tersedia dari mana saja selama Vercel dan Supabase aktif. Penerbitan bergantung pada pekerja di laptop (menyala 24 jam, internet stabil). YouTube dan Buffer yang sudah memegang jadwal tetap menerbitkan walau laptop mati; Instagram, pengiriman baru ke platform, dan pembatalan di platform menunggu laptop menyala.
- **Keamanan:** wajib login; pendaftaran umum dimatikan; data dilindungi aturan akses baris (RLS); autentikasi dua faktor tersedia; seluruh lalu lintas lewat HTTPS; token dan API key terenkripsi dan tidak dapat dibaca dari browser.
- **Kecepatan antarmuka:** halaman antrean tampil dalam 2 detik pada sambungan normal; perubahan status muncul tanpa memuat ulang halaman.
- **Keterbacaan kegagalan:** setiap kegagalan menampilkan alasan yang bisa dipahami pemilik, bukan kode error mentah.
- **Portabilitas pekerja:** pekerja dikonfigurasi lewat variabel lingkungan dan hanya memakai berkas lokal sebagai cache sementara, sehingga dapat dipindah ke server atau cloud tanpa mengubah kode.
- **Cadangan:** ekspor harian data inti oleh pekerja, karena paket gratis Supabase tidak punya cadangan otomatis.
- **Dapat diperluas:** logika penerbit tiap platform dipisah dalam modul sendiri agar TikTok bisa diganti API resmi kelak.

## 9. Batasan dan ketergantungan eksternal

| Hal | Batasan |
|---|---|
| TikTok | Posting publik otomatis lewat API hanya untuk aplikasi yang sudah diaudit; pedoman audit menolak alat untuk akun sendiri. Karena itu dipakai API Buffer. |
| Buffer (gratis) | 1 API key, 1.000 request per channel per 30 hari. Tidak ada endpoint upload; video harus di URL HTTPS yang stabil sampai terbit (dipenuhi dengan tautan bertanda tangan dari Supabase Storage). Batas antrean (sekitar 10 per channel) belum terkonfirmasi. |
| Instagram | Akun Business atau Creator terhubung ke Facebook Page. Batas posting API sekitar 100 per 24 jam. Tidak ada penjadwalan bawaan. |
| YouTube | Thumbnail Shorts hanya bisa dipasang setelah video selesai diproses. Aplikasi OAuth harus berstatus In production. Kuota upload default sekitar 100 per hari. |
| Vercel Hobby | Cron gratis hanya sekali sehari, jadi tidak dipakai untuk penjadwal. Badan request fungsi maksimal 4,5 MB, jadi video diunggah langsung dari browser ke Supabase Storage. Hanya untuk pemakaian nonkomersial. |
| Supabase Free | Database 500 MB, storage 1 GB, **berkas maksimal 50 MB**, egress 5 GB per bulan, tanpa cadangan otomatis, proyek dijeda setelah 1 minggu tanpa aktivitas. |
| Pekerja | Laptop pemilik menyala 24 jam dengan internet stabil dan fitur tidur dimatikan. |

## 10. Keputusan teknis sementara

Pilihan ini boleh diubah selama pembangunan:

- **Aplikasi web:** Next.js (TypeScript) di Vercel.
- **Data, login, penyimpanan, dan pembaruan langsung:** Supabase (Postgres, Auth, Storage, Realtime).
- **Pekerja:** Node.js (TypeScript) di laptop pemilik, terhubung ke Supabase.
- **Kode bersama:** satu repositori dengan paket bersama untuk tipe data dan aturan jadwal.
- **Zona waktu** tetap WIB.

## 11. Prasyarat dari pemilik

- Akun Supabase (proyek gratis) dan akun Vercel (Hobby), dihubungkan ke repositori git.
- Channel YouTube, proyek Google Cloud dengan OAuth berstatus In production, dan alamat balik OAuth memakai alamat Vercel.
- Instagram Business atau Creator yang terhubung ke Facebook Page, dan aplikasi Meta mode Development dengan pemilik sebagai admin.
- Akun Buffer gratis dengan TikTok terhubung, dan API key.
- Laptop yang tidak tidur, internet stabil, dan Node.js terpasang untuk menjalankan pekerja.

## 12. Risiko dan asumsi

| Risiko atau asumsi | Dampak | Penanganan |
|---|---|---|
| Posting Instagram untuk akun sendiri tanpa App Review belum diverifikasi | Jalur Instagram bisa tertunda | Percobaan kecil di awal |
| Status publik upload YouTube dari proyek belum terverifikasi belum jelas | Video bisa terkunci privat | Percobaan kecil di awal |
| Batas antrean gratis Buffer dan dukungan video TikTok di paket gratis belum dikonfirmasi | TikTok otomatis bisa tidak jalan | Percobaan kecil; cadangan: penjadwal bawaan TikTok atau jalur draf |
| Buffer mungkin tidak menerima tautan bertanda tangan Supabase | Video TikTok gagal diambil | Percobaan kecil; cadangan: bucket publik dengan nama acak atau layanan hosting lain |
| Video lebih dari 50 MB tidak bisa diunggah di paket gratis Supabase | Sebagian video ditolak | Peringatan sebelum unggah dan saran mengompres |
| Egress 5 GB per bulan hampir habis (video diambil pekerja dan Buffer) | Layanan terhenti sementara atau tertagih | Cache di pekerja, tanpa pratinjau otomatis, estimasi pemakaian dan peringatan 80% |
| Proyek Supabase dijeda setelah 1 minggu tanpa aktivitas | Aplikasi mati sampai dipulihkan manual | Pekerja menanyakan database tiap putaran; opsional ping berkala dari layanan lain |
| Laptop mati saat jam Instagram | Posting Instagram terlambat atau terlewat | Aturan kejar, peringatan "pekerja berhenti" |
| Kunci enkripsi token bocor dari Vercel | Token akun terbaca | Kunci hanya di variabel lingkungan server; token tidak pernah ke browser; MFA pemilik |
| Buffer mengubah paket gratis atau kebijakan | Jalur TikTok terganggu | Modul TikTok terpisah, mudah diganti |
| Vercel Hobby nonkomersial | Tidak boleh dipakai untuk layanan berbayar | Pindah ke paket berbayar bila kelak dijual |

## 13. Keputusan dari pertanyaan terbuka

| # | Pertanyaan | Keputusan |
|---|---|---|
| 1 | Jumlah dan jam slot harian | 4 slot: **06:00, 12:00, 16:00, 19:00 WIB**. Dapat diubah di pengaturan. |
| 2 | Batas keterlambatan Instagram | Nilai awal **2 jam**, tetapi dapat diatur lebih pendek (minimal 5 menit). Makin pendek makin cepat dianggap "terlewat". |
| 3 | Lebar jendela pengiriman TikTok | Pemilik belum perlu memutuskan. Nilai awal **2 hari ke depan** (8 posting), dan angka final ditetapkan setelah batas antrean Buffer dipastikan pada tahap percobaan kecil. |
| 4 | Cover TikTok | Memakai cover bawaan TikTok. Aplikasi tidak mengirim pengaturan cover. |

**Catatan untuk keputusan 3.** Paket gratis Buffer kemungkinan hanya menyimpan sekitar 10 posting terjadwal sekaligus untuk TikTok. Dengan 4 video per hari, 10 posting hanya cukup untuk sekitar 2,5 hari. Maka aplikasi tidak mengirim seluruh jadwal ke Buffer sekaligus, melainkan hanya beberapa hari ke depan (jendela pengiriman), dan sisanya dikirim otomatis ketika ruang antrean kembali tersedia saat posting terdahulu terbit.

## 14. Tahapan rilis

| Tahap | Isi |
|---|---|
| 0. Percobaan kecil | Memastikan risiko di bagian 12 yang bertanda percobaan |
| 1. Fondasi | Proyek Supabase (skema, RLS, Storage, Auth), proyek Vercel, login pemilik |
| 2. Inti pekerja | Penjadwal, klaim target, aturan gagal dan terlewat, detak pekerja |
| 3. Penerbit | YouTube, Instagram, lalu TikTok via Buffer |
| 4. Antarmuka | Form unggah langsung ke Storage, antrean, detail, pengaturan, koneksi akun |
| 5. Operasional | Pekerja menyala otomatis di laptop, pembaruan token, pembersihan, cadangan harian |

**Definisi selesai versi 1:** pemilik dapat menjadwalkan sehari penuh (4 video) dari browser mana pun dalam satu sesi, lalu semua 12 posting terbit pada jamnya tanpa tindakan manual selama laptop menyala.

## 15. Rencana ke depan: pekerja di cloud

Pemilik berencana memindahkan pekerja dari laptop ke cloud atau server. Versi ini dirancang agar itu mungkin tanpa menulis ulang: pekerja berkomunikasi dengan aplikasi hanya lewat database, dikonfigurasi lewat variabel lingkungan, dan tidak bergantung pada berkas lokal selain cache sementara. Detail jalur pindahnya ada di `system-design.md` bagian 18. Pemindahan itu **bukan** bagian dari versi 1.
