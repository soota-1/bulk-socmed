# UI/UX Design: Penjadwal Video Pendek

| | |
|---|---|
| Versi | 2.0 (Vercel + Supabase: dapat dibuka dari mana saja, dengan login) |
| Tanggal | 21 November 2026 |
| Dokumen terkait | `prd.md`, `system-design.md`, `api-specification.md` |

Dokumen ini menjelaskan bagaimana aplikasi **terlihat dan terasa dipakai**: alur, layar, status, teks, dan aturan interaksi. Bentuk visual di sini berupa sketsa kerangka (*wireframe*), bukan desain akhir.

---

## 1. Tujuan dan prinsip UX

Pemilik memposting 4 video per hari dan sudah lelah mengunggah satu per satu. Antarmuka yang berhasil adalah yang **membuat pekerjaan harian itu cepat, dan membuat pemilik yakin semuanya terbit tanpa harus mengecek tiga aplikasi**.

| # | Prinsip | Artinya dalam praktik |
|---|---|---|
| 1 | **Cepat untuk pekerjaan berulang** | Menjadwalkan satu video harus terasa ringan; menjadwalkan 4 video dalam satu sesi harus mulus. |
| 2 | **Tidak ada kegagalan diam-diam** | Posting yang gagal atau terlewat selalu terlihat dari halaman utama, tanpa perlu membuka menu apa pun. |
| 3 | **Status yang jujur dan per platform** | Tiga platform punya status sendiri. Jangan menyederhanakan jadi satu "berhasil" yang menyembunyikan masalah. |
| 4 | **Konsekuensi jelas sebelum bertindak** | Membatalkan atau mengubah entri menjelaskan apa yang terjadi di tiap platform. |
| 5 | **Bahasa yang manusiawi** | Pesan galat menjelaskan apa yang terjadi dan apa yang bisa dilakukan, bukan kode teknis. |
| 6 | **Sederhana** | Satu pengguna, satu tujuan. Tidak ada fitur yang tidak dibutuhkan. |

## 2. Pengguna dan konteks pakai

- **Satu pengguna:** pemilik channel, yang membuat konten pendek setiap hari.
- **Perangkat:** aplikasi kini berada di web (Vercel), jadi dapat dibuka dari **laptop maupun ponsel**, dari mana saja. Penggunaan utama tetap di laptop atau monitor; ponsel dipakai terutama untuk **memantau** dan melakukan perbaikan cepat, dan boleh juga untuk menambah video.
- **Login:** pemilik masuk dengan email dan kata sandi (autentikasi dua faktor dianjurkan). Tidak ada pendaftaran untuk orang lain.
- **Pola pakai tipikal:** satu sesi pendek (sekitar 5 sampai 10 menit) sekali sehari atau beberapa hari sekali untuk menambah 4 atau lebih video, lalu sesekali membuka halaman antrean untuk memastikan semuanya berjalan, termasuk dari luar rumah.
- **Hal yang membedakan dari versi lokal:** pemilik bisa berada jauh dari laptop yang menjalankan pekerja. Karena itu antarmuka harus **selalu menunjukkan apakah pekerja di laptop hidup**, dan menjelaskan tindakan yang menunggu pekerja.
- **Bahasa:** seluruh antarmuka berbahasa Indonesia. Waktu ditampilkan dalam WIB.

## 3. Struktur dan navigasi

```
Penjadwal Video
├── Masuk          (/login)           satu-satunya halaman tanpa sesi
├── Antrean        (beranda, /)
│     └── Detail entri  (/posts/{id})
├── Video baru     (/new)
├── Pengaturan     (/settings)        slot harian · batas keterlambatan · jendela TikTok · penyimpanan · keamanan
└── Koneksi        (/connections)     YouTube · Instagram · TikTok (Buffer)
```

- **Bilah navigasi atas** selalu tampil setelah masuk: Antrean · Pengaturan · Koneksi, dan tombol utama **+ Video baru** di kanan, serta menu akun (Keluar).
- **Antrean** adalah beranda: semua yang paling penting ada di sini.
- Halaman **Koneksi** menampilkan titik merah pada menu bila ada akun yang perlu disambung ulang.
- Pada ponsel, navigasi menjadi bilah bawah dengan tiga ikon (Antrean, Koneksi, Pengaturan) dan tombol mengambang **+**.

## 4. Alur utama

### 4.1 Menjadwalkan sehari penuh (alur terpenting)

Ini adalah ukuran keberhasilan versi 1: menjadwalkan 4 video dalam satu sesi.

```
Antrean ──► + Video baru ──► pilih video (unggah mulai otomatis)
        ──► isi judul, caption, hashtag ──► (opsional) thumbnail
        ──► slot sudah terisi otomatis (slot kosong berikutnya)
        ──► [Simpan & tambah lagi] ──► form kosong, slot berikutnya terpilih
        ──► ... ulangi sampai 4 video ──► [Jadwalkan] pada yang terakhir ──► Antrean
```

Poin rancangan:
- Unggahan video **dimulai segera setelah berkas dipilih**, saat pemilik masih mengisi caption. Menunggu unggahan tidak memblokir pengisian form.
- **Slot terisi otomatis** dengan slot kosong berikutnya, jadi pemilik tidak perlu memilih jam pada kasus umum.
- **Simpan & tambah lagi** mengosongkan form dan memilih slot kosong berikutnya, sehingga empat video berturut-turut mengisi empat slot berurutan.

### 4.2 Menangani posting yang gagal

```
Antrean menampilkan spanduk "1 posting perlu perhatian"
   ──► Lihat / klik baris yang bertanda ✕ atau ⚠
   ──► Detail entri: kartu platform yang gagal menjelaskan penyebab dan tindakan
   ──► [Coba lagi]   atau   [Ubah jam]   atau   [Sambung ulang akun]
```

### 4.3 Menyambung ulang akun

```
Spanduk merah "Akun Instagram perlu disambung ulang"
   ──► [Sambung ulang] ──► halaman izin Instagram (di tab/jendela sama)
   ──► kembali ke Koneksi dengan pesan "Instagram tersambung kembali"
   ──► posting yang ditahan dilanjutkan otomatis
```

### 4.4 Mengubah atau membatalkan entri

```
Detail entri ──► [Ubah]  ──► form yang sama dengan Video baru, dengan batasan sesuai status
             └─► [Batalkan] ──► dialog konsekuensi per platform ──► konfirmasi
```

## 5. Layar

Sketsa memakai teks; lebar kira-kira layar laptop (1280 px).

### 5.0 Masuk

```
┌──────────────────────────────────────────┐
│            ▣ Penjadwal Video             │
│                                          │
│  Email       [ nama@email.com          ] │
│  Kata sandi  [ ••••••••••••            ] │
│                                          │
│  [ Masuk ]                               │
│  Lupa kata sandi?                        │
│                                          │
│  (bila MFA aktif)                        │
│  Kode dari aplikasi autentikator         │
│  [ ______ ]                              │
└──────────────────────────────────────────┘
```

Aturan:
- Halaman paling sederhana: tidak ada tautan "Daftar" karena pendaftaran dimatikan.
- Pesan galat umum: "Email atau kata sandi salah." (tidak menyebut mana yang salah).
- Sesi bertahan beberapa hari di perangkat yang dipercaya; **Keluar** tersedia di menu akun.
- Bila sesi berakhir saat memakai aplikasi, pemilik diarahkan ke Masuk dan **isian form yang belum disimpan tidak hilang** (disimpan sementara di perangkat) lalu dikembalikan setelah masuk.
- **Lupa kata sandi** mengirim tautan ke email pemilik.

### 5.1 Antrean (beranda)

Tujuan layar: **sekali pandang, pemilik tahu apakah semuanya berjalan, dan apa yang akan tayang berikutnya.**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣ Penjadwal Video    Antrean   Pengaturan   Koneksi ●        [ + Video baru ] │
├──────────────────────────────────────────────────────────────────────────────┤
│ ✕ Akun Instagram perlu disambung ulang. Posting Instagram ditahan.           │
│                                                         [ Sambung ulang ]    │
│ ⚠ 1 posting perlu perhatian                                   [ Lihat ]      │
├──────────────────────────────────────────────────────────────────────────────┤
│ ( Semua )  Perlu perhatian (1)  Terjadwal  Terbit                ⟳ 09:05     │
│                                                                              │
│ HARI INI · Sabtu, 21 Nov 2026                                                │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ 06:00 [▮▮] Tips hemat listrik                                            │ │
│ │            ✓ YouTube Terbit   ✓ Instagram Terbit   ✓ TikTok Terbit        │ │
│ ├──────────────────────────────────────────────────────────────────────────┤ │
│ │ 12:00 [▮▮] Resep nasi goreng 5 menit                                     │ │
│ │            ✓ YouTube Terbit   ✕ Instagram Gagal    ✓ TikTok Terbit        │ │
│ ├──────────────────────────────────────────────────────────────────────────┤ │
│ │ 16:00 [▮▮] Review headset murah                                          │ │
│ │            ◷ YouTube Terjadwal  ◷ Instagram Terjadwal  ◷ TikTok Terjadwal │ │
│ ├──────────────────────────────────────────────────────────────────────────┤ │
│ │ 19:00  + Isi slot ini                                                    │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ BESOK · Minggu, 22 Nov 2026                                                  │
│ │ 06:00 [▮▮] ...                                                             │
│ │ 12:00  + Isi slot ini                                                      │
│                                                                              │
│ ▸ Riwayat (hari yang sudah lewat)                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

Aturan:
- **Dikelompokkan per hari**, menampilkan semua slot hari itu, termasuk yang kosong sebagai baris **+ Isi slot ini** (membuka Video baru dengan slot itu terpilih).
- **Spanduk peringatan** di atas daftar (aturan prioritas di bagian 7).
- Tiap baris: jam, thumbnail kecil (atau bingkai video), judul (satu baris, dipotong), dan **tiga *chip* status**, satu per platform, selalu dalam urutan YouTube, Instagram, TikTok.
- Baris dengan status `failed`/`missed` diberi latar halus dan garis kiri berwarna, supaya mudah ditemukan.
- **Filter:** Semua, Perlu perhatian (dengan angka), Terjadwal, Terbit. Nilai awal: Semua.
- **Hari yang sudah lewat** dilipat di bagian **Riwayat**; bila ada yang perlu perhatian di hari lalu, tetap ditarik ke atas.
- **Pembaruan langsung** lewat Realtime: perubahan status muncul tanpa memuat ulang. Indikator kecil di kanan toolbar menunjukkan "Langsung" (terhubung) atau "Terputus, mencoba lagi…".
- **Tindakan yang menunggu pekerja** (coba lagi, batalkan, ubah) ditandai dengan chip kecil "Menunggu pekerja…" pada baris yang bersangkutan.
- Klik baris membuka **Detail entri**.

### 5.2 Video baru

```
Video baru                                                          [ Batal ]
┌─────────────────────────────┐   Judul YouTube (opsional)
│                             │   [ Tips hemat listrik                  ]  23/100
│   Seret video ke sini       │
│   atau  [ Pilih berkas ]    │   Caption
│   mp4, mov                  │   [ 3 kebiasaan kecil yang menurunkan   ]
│                             │   [ tagihan listrik bulanan.            ]
└─────────────────────────────┘     YouTube 71/5000 · Instagram 71/2200
  ▮▮▮▮▮▮▮▮▮▯▯  78%  klip_01.mp4
  1080×1920 · 0:28 · 17,5 MB        Hashtag
                                    [ #tips #hemat #fyp                 ]
Thumbnail (YouTube & Instagram)
┌────────────────┐  Opsional. TikTok memakai cover bawaan TikTok.
│ Seret gambar   │
│ atau [Pilih]   │
└────────────────┘

Jadwal
 (●) Slot berikutnya:  Senin, 23 Nov · 12:00 WIB          [ Ganti slot… ]
 ( ) Jam khusus:       [ 23 Nov 2026 ]  [ 05:30 ] WIB

 ⚠ Video ini tidak berformat vertikal 9:16 ... (peringatan bila ada)

[ Simpan sebagai draf ]            [ Simpan & tambah lagi ]    [ Jadwalkan ]
```

Aturan:
- **Unggah mulai otomatis** begitu berkas dipilih, langsung dari browser ke penyimpanan (bukan lewat server aplikasi), dengan bilah kemajuan. Unggahan dapat dilanjutkan bila koneksi putus sebentar. Tombol **Jadwalkan** dan **Simpan & tambah lagi** nonaktif sampai unggahan selesai, dengan keterangan "Menunggu unggahan selesai…".
- **Batas ukuran 50 MB.** Berkas video yang lebih besar ditolak sebelum diunggah dengan pesan "Video ini 74 MB, batasnya 50 MB. Kompres dulu lalu coba lagi.". Batas ini terlihat di area seret-lepas ("mp4, mov, maks. 50 MB").
- Setelah video diunggah, tampil **metadata** (resolusi, durasi, ukuran) dan **peringatan** bila ada (bukan vertikal, terlalu panjang, dan sebagainya). Peringatan tidak memblokir.
- **Pencacah karakter** per platform di bawah caption; berubah merah dan menampilkan pesan bila melewati batas platform tertentu. Batas yang tepat dikonfirmasi pada percobaan kecil; yang pasti: judul YouTube 100 karakter.
- **Judul** opsional. Bila kosong, tampil keterangan kecil "Akan diambil dari baris pertama caption".
- **Thumbnail:** satu gambar untuk YouTube dan Instagram. Keterangan **"TikTok memakai cover bawaan TikTok"** selalu terlihat agar tidak ada kejutan.
- **Jadwal:** nilai awal adalah slot kosong berikutnya. **Ganti slot…** membuka pemilih slot (5.3). **Jam khusus** menimpa slot; pilihan ini ditandai jelas pada antrean.
- **Tiga tombol aksi** (dari kiri ke kanan, kepentingan naik): Simpan sebagai draf, Simpan & tambah lagi, Jadwalkan.
- **Peringatan perubahan belum disimpan** bila pemilik meninggalkan halaman dengan isian yang belum disimpan.
- Fokus awal ada di tombol **Pilih berkas**; setelah video terpilih, fokus pindah ke kolom judul.

### 5.3 Pemilih slot

Dibuka dari **Ganti slot…** sebagai panel samping atau dialog.

```
Pilih slot                                                          [ Tutup ]
              Sab 21   Min 22   Sen 23   Sel 24   Rab 25   Kam 26   Jum 27
  06:00       ░ lewat  Tips…    ◉ pilih  ·        ·        ·        ·
  12:00       ░ lewat  Resep…   ·        ·        ·        ·        ·
  16:00       Review…  ·        ·        ·        ·        ·        ·
  19:00       ·        ·        ·        ·        ·        ·        ·

  ● terisi   · kosong   ░ sudah lewat   ◉ dipilih
  [ Pakai slot yang dipilih ]
```

Aturan:
- Rentang **7 hari ke depan**, dapat digeser maju dan mundur.
- Sel terisi menampilkan potongan judul dan **tidak dapat dipilih** (kecuali saat mengubah entri itu sendiri).
- Sel yang sudah lewat, atau yang kurang dari batas jarak minimal dari sekarang, **nonaktif** dengan penjelasan saat ditunjuk.
- Entri dengan jam khusus muncul di bawah kolom harinya sebagai baris tambahan.
- Dapat dipakai dengan keyboard (tanda panah untuk berpindah sel, Enter untuk memilih).

### 5.4 Detail entri

Tujuan layar: **menjelaskan apa yang terjadi per platform, dan memberi jalan keluar bila ada masalah.**

```
← Antrean

Tips hemat listrik                                    [ Ubah ]  [ Batalkan ]
Senin, 23 Nov 2026 · 06:00 WIB          Slot terisi
┌───────────────┐   Caption:  3 kebiasaan kecil yang menurunkan tagihan…
│   ▶ video     │   Hashtag:  #tips #hemat #fyp
│   (pratinjau) │   Thumbnail: ▮ (YouTube & Instagram)
└───────────────┘

┌─ YouTube ─────────────────────────────────────────────────────────────────┐
│ ◷ Terjadwal di YouTube · akan tayang Sen 23 Nov 06:00                      │
│ Video sudah diunggah dan thumbnail terpasang.            [ Lihat riwayat ▾]│
└───────────────────────────────────────────────────────────────────────────┘
┌─ Instagram ───────────────────────────────────────────────────────────────┐
│ ✕ Gagal                                                                   │
│ Akun Instagram perlu disambung ulang, jadi posting ini ditahan.           │
│ [ Sambung ulang akun ]                                    [ Lihat riwayat ▾]│
└───────────────────────────────────────────────────────────────────────────┘
┌─ TikTok ──────────────────────────────────────────────────────────────────┐
│ ◷ Terjadwal · belum dikirim ke Buffer                                      │
│ Akan dikirim ke Buffer pada Sab 21 Nov 06:00 (2 hari sebelum tayang).      │
│                                                           [ Lihat riwayat ▾]│
└───────────────────────────────────────────────────────────────────────────┘
```

Aturan:
- **Satu kartu per platform**, masing-masing dengan status, penjelasan satu atau dua kalimat, dan **tindakan yang relevan** (Coba lagi, Sambung ulang akun, Ubah jam, Lihat di platform).
- **Lihat riwayat** membuka daftar kejadian (waktu, langkah) dari `GET .../events`, untuk pemilik yang ingin tahu sampai ke rincian.
- Bila terbit, kartu menampilkan **tautan ke video di platform**.
- Bila entri **terkunci** untuk diubah di sebagian platform, tombol **Ubah** tetap tersedia tetapi menjelaskan platform mana yang terkunci dan alasannya.
- **Pratinjau video hanya dimuat saat tombol Putar ditekan**, untuk menghemat kuota unduh penyimpanan. Thumbnail dimuat otomatis. Bila berkas sudah dibersihkan, tampil "Berkas video sudah dihapus".
- Target yang membawa tindakan tertunda menampilkan "Menunggu pekerja…" dengan penjelasan; bila pekerja sedang mati, ditambah "Akan dijalankan begitu laptop menyala dan pekerja aktif".

### 5.5 Pengaturan

```
Pengaturan

Slot harian (WIB)
  [ 06:00 ] [×]   [ 12:00 ] [×]   [ 16:00 ] [×]   [ 19:00 ] [×]    [ + Tambah slot ]
  Slot hanya berlaku untuk entri baru. Entri yang sudah terjadwal tidak berubah.

Batas keterlambatan Instagram
  [ 120 ] menit
  Bila laptop mati saat jam tayang, Instagram masih dikejar sampai batas ini.
  Lewat dari itu, posting ditandai "Terlewat". Nilai lebih kecil = lebih ketat. Minimal 5.

Pengiriman ke TikTok (Buffer)
  Kirim ke Buffer  [ 2 ] hari sebelum jam tayang
  Antrean Buffer saat ini: 3 dari 10 terpakai

▸ Lanjutan
    Jarak minimal slot baru dari sekarang    [ 15 ] menit
    Mulai persiapan Instagram                [ 10 ] menit sebelum tayang
    Simpan berkas video                      [  3 ] hari setelah selesai
    Simpan riwayat kejadian                  [ 180 ] hari

                                                            [ Simpan perubahan ]
```

Aturan:
- Tiap pengaturan punya **penjelasan satu kalimat** dalam bahasa biasa.
- Nilai di luar batas ditolak dengan pesan di samping kolom (rentang ada di `api-specification.md` bagian 9).
- Bagian **Lanjutan** dilipat secara awal, karena jarang diubah.
- **Simpan perubahan** menampilkan konfirmasi singkat "Pengaturan disimpan".

### 5.5a Tambahan di Pengaturan: penyimpanan dan keamanan

```
Penyimpanan dan kuota (perkiraan)
  Penyimpanan   ▮▮▯▯▯▯▯▯▯▯   230 MB dari 1 GB
  Unduhan bulan ini  ▮▮▮▮▯▯▯▯▯▯   2,0 GB dari 5 GB
  Berkas video disimpan 3 hari setelah selesai. Video maksimal 50 MB.

Keamanan
  Kata sandi            [ Ganti kata sandi ]
  Verifikasi dua langkah  ○ Belum aktif   [ Aktifkan ]
```

Aturan:
- Angka kuota adalah **perkiraan** dari ukuran berkas; teks keterangan menyebut hal itu. Batang berubah kuning pada 80% dan memicu peringatan `storage_usage_high`.
- **Verifikasi dua langkah** dianjurkan karena aplikasi terbuka di internet; ajakan ringan ditampilkan sekali bila belum aktif.

### 5.6 Koneksi akun

```
Koneksi akun

┌─ YouTube ────────────────────────────────────────────────────────────────┐
│ ● Tersambung · Channel Saya                                              │
│ [ Uji koneksi ]   [ Putuskan ]                                           │
└──────────────────────────────────────────────────────────────────────────┘
┌─ Instagram ──────────────────────────────────────────────────────────────┐
│ ✕ Perlu disambung ulang · @channelsaya                                   │
│ Token akses sudah tidak berlaku.                      [ Sambung ulang ]  │
└──────────────────────────────────────────────────────────────────────────┘
┌─ TikTok (lewat Buffer) ──────────────────────────────────────────────────┐
│ ○ Belum tersambung                                                       │
│ API key Buffer   [ ••••••••••••••••••• ]  [ Tampilkan ]                  │
│ Channel TikTok   [ pilih channel…  ▾ ]                                   │
│ [ Simpan dan uji ]                                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

Aturan:
- Tiap platform satu kartu dengan **status**, **nama akun**, dan tindakan relevan.
- Kartu Instagram menampilkan **sisa batas posting hari ini** bila tersambung (contoh "96 dari 100 tersisa").
- Kartu TikTok memandu dua langkah: tempel API key, lalu **pilih channel** dari daftar yang diambil dari Buffer. Bila channel yang dipilih bukan TikTok, tampil pesan yang jelas.
- API key dan token **tidak pernah ditampilkan kembali** setelah disimpan; kolom hanya menampilkan titik-titik.
- Memutuskan koneksi meminta konfirmasi dan menjelaskan bahwa posting yang belum terbit untuk platform itu akan ditahan.
- **Uji koneksi dikerjakan pekerja.** Tombol menampilkan "Menguji…" sampai hasil masuk; bila pekerja mati, muncul "Pekerja tidak aktif. Uji akan dijalankan begitu laptop menyala.".
- **Menyambung ulang** membawa pemilik ke halaman izin platform lalu kembali ke alamat aplikasi di Vercel (HTTPS), sehingga bekerja juga dari ponsel.

## 6. Sistem status

Status selalu ditampilkan sebagai **kombinasi ikon + teks + warna**, tidak pernah warna saja.

| Status internal | Label | Ikon | Warna | Keterangan singkat |
|---|---|---|---|---|
| `draft` | Draf | ✎ | abu-abu | Belum dijadwalkan |
| `scheduled` | Terjadwal | ◷ | biru | Menunggu jamnya |
| `uploading` | Mengunggah | ⟳ | kuning | Sedang dikerjakan |
| `awaiting_platform` | Terjadwal di platform | ◷✓ | biru | Platform sudah memegang jadwalnya |
| `published` | Terbit | ✓ | hijau | Sudah tayang |
| `failed` | Gagal | ✕ | merah | Perlu tindakan |
| `missed` | Terlewat | ⚠ | oranye | Jam lewat; tidak diposting |
| `cancelled` | Dibatalkan | – | abu-abu | |

**Chip status per platform** berbentuk: `[ikon] Nama platform  Label`, misalnya `✕ Instagram Gagal`. Pada `awaiting_platform`, label menjadi "Terjadwal" di antrean (cukup), dan kartu detail menjelaskan "Terjadwal di YouTube".

**Status keseluruhan entri** (untuk filter dan spanduk) mengikuti `overall_status` dari API. Prioritas: perlu perhatian lebih dulu.

## 7. Peringatan dan spanduk

Spanduk tampil di atas daftar Antrean. Beberapa spanduk bisa tampil bersamaan, diurutkan dari paling mendesak.

| Prioritas | Kode | Tingkat | Muncul bila | Tindakan | Bisa ditutup? |
|---|---|---|---|---|---|
| 1 | `worker_offline` | error | Pekerja di laptop tidak berdetak lebih dari 3 menit | Petunjuk: "Nyalakan laptop dan jalankan pekerja" | Tidak, hilang sendiri saat pulih |
| 2 | `connection_needs_reauth` | error | Akun perlu disambung ulang | **Sambung ulang** | Tidak, hilang sendiri setelah tersambung |
| 3 | `target_failed` | error | Ada target `failed` | **Lihat** (ke entri yang bermasalah) | Tidak, sampai ditangani |
| 4 | `target_missed` | warning | Ada target `missed` | **Lihat** | Tidak, sampai ditangani |
| 5 | `buffer_queue_near_limit` | warning | Antrean Buffer hampir penuh | Tanpa tindakan | Ya (hingga kondisi berubah) |
| 6 | `instagram_limit_low` | warning | Sisa batas posting Instagram hari ini rendah | Tanpa tindakan | Ya |
| 7 | `storage_usage_high` | warning | Perkiraan pemakaian penyimpanan atau unduhan mencapai 80% | **Lihat penyimpanan** (ke Pengaturan) | Ya, muncul lagi pada 95% |
| 8 | `media_missing` | warning | Berkas video entri yang akan tayang tidak ditemukan | **Lihat** | Tidak |

Aturan:
- Peringatan `error` bertanda ✕ dengan latar merah lembut; `warning` bertanda ⚠ dengan latar kuning lembut.
- **Peringatan yang menyangkut kegagalan tidak boleh bisa ditutup**; ia hilang hanya ketika masalahnya selesai. Ini menjaga prinsip "tidak ada kegagalan diam-diam".
- **`worker_offline` adalah yang paling penting pada versi ini**, karena pemilik bisa berada jauh dari laptop. Teksnya menjelaskan akibatnya: "Pekerja di laptop tidak aktif sejak 09:01. Posting Instagram tidak akan terbit, dan tindakan baru menunggu, sampai laptop menyala dan pekerja berjalan. YouTube dan TikTok yang sudah dijadwalkan tetap terbit."
- Bila lebih dari tiga spanduk, tampilkan tiga teratas dan tautan "dan N lainnya".
- Bila aplikasi tidak dapat menjangkau database, spanduk "Tidak dapat memuat data" menggantikan isi daftar dan data terakhir dibiarkan tampil dengan penanda usang.

## 8. Teks antarmuka

### 8.1 Gaya bahasa

- Bahasa Indonesia yang sopan dan lugas; kalimat pendek; sapaan "Anda" bila perlu, lebih sering tanpa subjek.
- Menjelaskan **apa yang terjadi** dan **apa yang bisa dilakukan**.
- Tanpa istilah teknis mentah (token, container, quota) di teks utama; istilah teknis boleh ada di riwayat.
- Tanda baca dan huruf kapital biasa; tidak berteriak.

### 8.2 Pesan penting

| Situasi | Teks | Tindakan |
|---|---|---|
| Slot sudah terisi | "Slot Senin 23 Nov 06:00 sudah terisi. Pilih slot lain." | Buka pemilih slot |
| Video tidak vertikal | "Video ini tidak berformat vertikal 9:16. Tampilan di Shorts, Reels, dan TikTok bisa terpotong." | (peringatan, bisa lanjut) |
| Caption terlalu panjang | "Caption terlalu panjang untuk Instagram (2.310 dari 2.200 karakter)." | Sunting caption |
| Jam sudah lewat | "Jam ini sudah lewat. Pilih jam yang akan datang." | |
| Jam terlalu dekat | "Pilih jam minimal 15 menit dari sekarang agar sempat dikerjakan." | |
| Akun perlu disambung ulang | "Akun Instagram perlu disambung ulang. Posting Instagram ditahan sampai tersambung." | Sambung ulang |
| Kuota habis | "Kuota unggah YouTube hari ini habis. Aplikasi akan mencoba lagi besok." | |
| Batas posting Instagram habis | "Batas posting Instagram hari ini sudah tercapai. Posting ditandai gagal; Anda bisa mencoba lagi nanti." | Coba lagi |
| Terlewat | "Posting Instagram terlewat karena laptop mati saat jam tayang dan keterlambatan melewati 2 jam. Tidak diposting otomatis." | Ubah jam / Coba lagi |
| Instagram meragukan | "Kami tidak yakin apakah video ini sudah terbit di Instagram. Periksa akun Anda dulu sebelum mencoba lagi." | "Sudah saya periksa, belum terbit" |
| Berkas dihapus | "Berkas video sudah dihapus, jadi tidak bisa dicoba lagi." | Buat entri baru |
| Buffer penuh | "Antrean Buffer penuh. TikTok akan dikirim begitu ada ruang." | (informasi) |
| Berhasil disimpan | "Dijadwalkan untuk Senin 23 Nov 06:00." | Lihat antrean |
| Pekerja mati | "Pekerja di laptop tidak aktif sejak 09:01. Posting Instagram tidak akan terbit sampai laptop menyala." | Petunjuk menyalakan |
| Tindakan menunggu | "Menunggu pekerja… akan dijalankan begitu laptop menyala." | |
| Video terlalu besar | "Video ini 74 MB, batasnya 50 MB. Kompres dulu lalu coba lagi." | Pilih berkas lain |
| Kuota hampir penuh | "Pemakaian unduhan bulan ini sekitar 4,1 GB dari 5 GB." | Lihat penyimpanan |
| Sesi berakhir | "Sesi Anda berakhir. Masuk lagi untuk melanjutkan; isian Anda tersimpan." | Masuk |
| Login gagal | "Email atau kata sandi salah." | |

### 8.3 Format tanggal dan waktu

- Tampilan penuh: `Senin, 23 Nov 2026 · 06:00 WIB`.
- Di dalam daftar: `06:00` dengan judul hari di atas kelompoknya (`HARI INI`, `BESOK`, atau `Senin, 24 Nov 2026`).
- Selalu 24 jam; selalu menyebut WIB pada layar yang menampilkan tanggal lengkap.

## 9. Keadaan kosong, memuat, dan galat

| Keadaan | Perlakuan |
|---|---|
| **Antrean kosong** (belum ada entri) | Ilustrasi sederhana dan teks "Belum ada video terjadwal." dengan tombol utama **+ Video baru**. |
| **Belum ada koneksi akun** | Antrean menampilkan panduan "Hubungkan akun Anda dulu" dengan tiga langkah menuju Koneksi. Tombol **Jadwalkan** tetap bisa dipakai untuk menyimpan draf, tetapi memperingatkan bahwa platform belum tersambung. |
| **Memuat** | Kerangka (*skeleton*) pada baris daftar, bukan spinner layar penuh. |
| **Unggahan berjalan** | Bilah kemajuan dan persentase, dengan tombol **Batalkan unggahan**. |
| **Unggahan gagal** | Pesan di tempat dan tombol **Coba lagi**; isian form tidak hilang. |
| **API tidak merespons** | Spanduk "Aplikasi tidak merespons" dan data terakhir dibiarkan tampil dengan penanda usang. |
| **Entri tidak ditemukan** | Halaman "Entri tidak ditemukan" dengan tombol ke Antrean. |
| **Pekerja mati** | Spanduk `worker_offline`; tombol yang membutuhkan pekerja tetap bisa ditekan tetapi ditandai "Menunggu pekerja…". |
| **Sesi berakhir** | Diarahkan ke Masuk; isian form dipulihkan setelah masuk. |
| **Database tidak terjangkau** | Spanduk "Tidak dapat memuat data"; data terakhir tampil dengan penanda usang. |

## 10. Konfirmasi dan tindakan yang tidak bisa dibatalkan

Dialog konfirmasi hanya dipakai untuk tindakan yang berdampak di platform. Tombol konfirmasi memakai **kata kerja yang spesifik** ("Batalkan entri"), bukan "OK".

**Batalkan entri:**

```
Batalkan "Tips hemat listrik"?

Yang akan terjadi:
 • YouTube: video yang sudah diunggah akan dihapus dari YouTube.
 • Instagram: tidak ada yang diposting.
 • TikTok: posting di Buffer dibatalkan.

Slot Senin 23 Nov · 06:00 akan kosong kembali.
Pembersihan di platform dikerjakan oleh pekerja; bila laptop sedang mati, dilakukan begitu menyala.

                              [ Kembali ]   [ Batalkan entri ]
```

Bila sebagian platform sudah terbit, dialog menambahkan: "YouTube sudah terbit dan **tidak** akan ditarik oleh aplikasi."

**Putuskan koneksi:** menjelaskan bahwa posting yang belum terbit untuk platform itu akan ditahan.

**Tindakan yang tidak perlu konfirmasi:** menyimpan, mengubah pengaturan, mencoba ulang, melihat riwayat.

## 11. Interaksi dan pintasan

- **Seret dan lepas** untuk video dan thumbnail, selain tombol **Pilih berkas**.
- **Pencegahan kirim ganda:** setelah tombol **Jadwalkan** ditekan, tombol nonaktif dan menampilkan "Menyimpan…" sampai ada hasil. Permintaan memakai `Idempotency-Key`.
- **Pintasan keyboard:**

| Pintasan | Aksi |
|---|---|
| `N` | Video baru (dari Antrean) |
| `Ctrl/Cmd + Enter` | Jadwalkan (dari form) |
| `Esc` | Tutup dialog atau panel |
| `/` | Fokus ke penyaring (bila ada) |

- **Fokus** selalu terlihat dan berpindah dengan urutan yang masuk akal; dialog menjebak fokus dan mengembalikannya setelah ditutup.
- **Pembaruan otomatis** tidak merebut fokus dan tidak menggeser posisi gulir pemilik.

## 12. Gaya visual

Arah: **tenang dan fungsional**, seperti alat kerja, bukan situs promosi. Satu warna aksen, banyak ruang putih, tipografi bersih.

**Prinsip tata letak**
- Lebar isi maksimal sekitar 1.040 px, rata tengah.
- Jarak berbasis kelipatan 8 px.
- Kartu dengan sudut membulat halus dan garis tipis, bukan bayangan tebal.

**Tipografi**
- Font sistem (tanpa unduhan font), ukuran dasar 16 px.
- Judul layar 24 px, judul kartu 18 px, teks pendukung 14 px.

**Warna status** (latar lembut dengan teks gelap; pasangan ini harus dicek dengan alat kontras saat implementasi, dengan target minimal rasio 4,5:1):

| Status | Teks | Latar |
|---|---|---|
| Terjadwal | `#0D47A1` | `#E3F2FD` |
| Mengunggah | `#7A4F01` | `#FFF4DB` |
| Terbit | `#1B5E20` | `#E8F5E9` |
| Gagal | `#B71C1C` | `#FDECEA` |
| Terlewat | `#8A3B00` | `#FFE9D6` |
| Draf / Dibatalkan | `#424242` | `#EEEEEE` |

**Tema:** mengikuti pengaturan terang atau gelap sistem; semua warna didefinisikan sebagai variabel agar tema gelap cukup dengan satu set nilai lain.

**Gerak:** minimal. Hanya transisi singkat (kurang dari 200 ms) pada pembukaan panel dan perubahan status; hormati pengaturan "kurangi gerak" sistem.

## 13. Aksesibilitas

- **Keyboard penuh:** semua fungsi bisa dipakai tanpa mouse, termasuk pemilih slot.
- **Bukan warna saja:** setiap status punya ikon dan teks.
- **Kontras:** target minimal 4,5:1 untuk teks biasa.
- **Label:** setiap kolom isian punya label terlihat dan terhubung; pesan galat ditautkan ke kolomnya.
- **Pembaruan dinamis:** perubahan status dan spanduk baru diumumkan lewat wilayah `aria-live` (sopan, tidak menyela).
- **Pratinjau video:** kontrol pemutar bisa dijangkau keyboard; video tidak diputar otomatis.
- **Bahasa halaman:** `lang="id"`.

## 14. Responsif

Karena aplikasi kini dapat dibuka dari ponsel, tata letak dirancang **desktop dan ponsel**.

| Lebar | Perilaku |
|---|---|
| 1.024 px ke atas | Tata letak penuh seperti sketsa bagian 5 |
| 768 sampai 1.023 px | Kolom form menumpuk; pemilih slot dapat digulir mendatar |
| Di bawah 768 px (ponsel) | Navigasi bilah bawah; antrean sebagai daftar kartu satu kolom dengan tiga chip status ringkas (ikon dan singkatan platform); form satu kolom; pemilih slot menjadi daftar per hari; tombol utama selalu terlihat di bawah |

Prioritas ponsel: **memantau** (antrean, status, spanduk), **memperbaiki cepat** (coba lagi, sambung ulang, ubah jam), dan **menambah video** bila perlu (dengan batas 50 MB dan peringatan jaringan seluler untuk unggahan besar).

Target sentuh minimal 44 × 44 px; teks dasar 16 px agar tidak diperbesar otomatis oleh peramban.

## 15. Kriteria penerimaan UX

Diukur lewat uji coba langsung oleh pemilik pada versi yang berjalan. Angka berupa usulan.

| # | Kriteria | Cara mengukur |
|---|---|---|
| U1 | Menambah satu video (berkas sudah dipilih) dengan slot otomatis memerlukan **kurang dari 60 detik** interaksi, di luar lamanya unggahan. | Uji dengan pencatat waktu |
| U2 | Menjadwalkan **4 video dalam satu sesi** selesai dalam **5 menit** di luar lamanya unggahan. | Uji dengan 4 video nyata |
| U3 | Dari halaman Antrean, posting yang gagal atau terlewat **terlihat tanpa menggulir atau membuka menu**, dan penyebabnya terbaca dalam **dua klik**. | Pura-pura gagal pada satu target |
| U4 | Pemilik dapat menjelaskan, hanya dari melihat layar, apa yang terjadi pada tiap platform untuk satu entri. | Pertanyaan lisan setelah uji |
| U5 | Membatalkan entri **selalu** menampilkan konsekuensi per platform sebelum dikonfirmasi. | Pemeriksaan manual |
| U6 | Seluruh alur utama (4.1 sampai 4.4) dapat diselesaikan **hanya dengan keyboard**. | Uji tanpa mouse |
| U7 | Menekan **Jadwalkan** dua kali cepat tidak menghasilkan dua entri. | Uji klik ganda |
| U8 | Tidak ada pesan galat mentah (kode HTTP, jejak tumpukan) pada layar mana pun. | Pemeriksaan manual semua galat |
| U9 | Bila pekerja mati, spanduk `worker_offline` terlihat dalam **4 menit** dan menjelaskan akibatnya. | Matikan pekerja; ukur waktu |
| U10 | Antrean dapat dipantau dan satu posting yang gagal dapat dicoba ulang **dari ponsel** tanpa memperbesar layar. | Uji di ponsel |
| U11 | Setelah sesi berakhir, isian form yang belum disimpan kembali setelah masuk. | Uji manual |
| U12 | Tidak ada halaman selain Masuk yang dapat dilihat tanpa login. | Uji dengan peramban tanpa sesi |

## 16. Usulan di luar PRD dan pertanyaan terbuka

**Usulan yang bisa diterima atau ditolak** (tidak ada di PRD; murah dikerjakan):

| # | Usulan | Alasan | Dampak |
|---|---|---|---|
| S1 | **Simpan & tambah lagi** pada form Video baru | Mempercepat penjadwalan 4 video per sesi (alur 4.1) | Hanya antarmuka |
| S2 | **Hashtag terakhir terisi otomatis** pada form baru, dapat diubah | Hashtag biasanya berulang antarvideo | Satu pengaturan tambahan (`last_hashtags`) |
| S3 | **Pintasan keyboard** (bagian 11) | Mempercepat pekerjaan harian | Hanya antarmuka |

**Pertanyaan terbuka**

1. Apakah usulan S1 sampai S3 diterima?
2. Apakah tema gelap perlu, atau cukup mengikuti sistem? (Rancangan sekarang mengikuti sistem.)
3. Apakah pemilik ingin **pemberitahuan di luar aplikasi** (email, atau pesan lewat aplikasi lain) saat ada posting gagal, terlewat, atau pekerja mati? Pada rancangan sekarang, kegagalan hanya terlihat di dalam aplikasi, yang berarti pemilik harus membukanya. Pemberitahuan menjadi lebih berguna sekarang karena pemilik bisa jauh dari laptop.
4. Apakah pemilik akan **menambah video dari ponsel**? Bila ya, batas 50 MB dan unggahan lewat jaringan seluler perlu diperhatikan.
5. Apakah pemilik ingin langsung mengaktifkan **verifikasi dua langkah** pada akun masuk?
6. Batas panjang caption TikTok dan batas hashtag Instagram akan dikonfirmasi pada percobaan kecil; pencacah karakter diperbarui sesuai hasilnya.
