# System Design: Penjadwal Video Pendek

| | |
|---|---|
| Versi | 2.0 (arsitektur diperbarui: Vercel + Supabase + pekerja di laptop) |
| Tanggal | 21 November 2026 |
| Dokumen terkait | `prd.md`, `database-design.md`, `api-specification.md`, `ui-ux-design.md` |

Dokumen ini menjelaskan **bagaimana** aplikasi dibangun: komponen, alur, penanganan gagal, keamanan, dan operasional. Kebutuhan produk ada di `prd.md`, skema data di `database-design.md`.

**Perubahan dari versi 1.x:** aplikasi tidak lagi berupa satu proses lokal dengan SQLite. Antarmuka berjalan di Vercel, data dan login di Supabase, sedangkan pekerja penjadwal tetap di laptop pemilik. Pemindahan pekerja ke cloud kelak dirancang sejak awal (bagian 18).

---

## 1. Ringkasan arsitektur

Tiga bagian yang bertemu **hanya lewat database Supabase**:

```
                  ┌──────────────────────── Internet ────────────────────────┐
                  │                                                          │
  Browser pemilik │            ┌─────────── Supabase ───────────┐            │
  (laptop/ponsel) │            │  Auth · Postgres · Storage     │            │
        │         │            │  Realtime                      │            │
        │ HTTPS   │            └──▲─────────▲──────────▲────────┘            │
        ▼         │               │         │          │                     │
  ┌────────────┐  │   RLS+sesi    │         │ service  │ service key         │
  │  Vercel    │──┼───────────────┘         │ key      │                     │
  │  Next.js   │  │  (baca/tulis lewat      │          │                     │
  │  UI + API  │  │   fungsi database)      │          │                     │
  └────────────┘  │                         │          │                     │
        ▲         │                  ┌──────┴──────────┴─────┐               │
        │ unggah  │                  │ Pekerja (Node.js)     │               │
        │ langsung│                  │ di laptop 24 jam      │               │
        └─────────┼─ ke Storage      │ Penjadwal + Penerbit  │               │
                  │                  └──┬──────────┬─────────┬┘              │
                  │                     ▼          ▼         ▼               │
                  │             YouTube API  Instagram API  Buffer API       │
                  └──────────────────────────────────────────────────────────┘
```

**Prinsip desain**

1. **Database adalah satu-satunya jalur komunikasi** antara antarmuka dan pekerja. Tidak ada panggilan langsung dari Vercel ke pekerja. Karena itu pekerja dapat dipindah ke mana pun (bagian 18).
2. **Database adalah sumber kebenaran penjadwal.** Pekerja boleh mati kapan saja dan melanjutkan dengan benar saat hidup lagi.
3. **Setiap platform independen.** Gagal di satu platform tidak mengganggu platform lain.
4. **Tidak pernah posting ganda.** Lebih baik menandai "gagal, periksa manual" daripada mencoba ulang secara buta pada kondisi yang meragukan.
5. **Platform yang bisa menjadwalkan sendiri dititipi jadwal.** YouTube dan Buffer menerbitkan tepat waktu walau laptop mati setelah penitipan. Hanya Instagram bergantung pada laptop saat jam terbit.
6. **Browser tidak pernah memegang rahasia platform.** Token dan API key hanya dibaca server dan pekerja.
7. **Modul penerbit dapat diganti.** Mengganti Buffer dengan API TikTok resmi hanya mengubah satu modul.

## 2. Keputusan teknologi (pilihan sementara)

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Antarmuka dan API | Next.js (App Router, TypeScript) di Vercel Hobby | Gratis; Route Handlers cukup untuk API ringan. |
| Database | Supabase Postgres | Klaim pekerjaan atomik (`FOR UPDATE SKIP LOCKED`), tipe waktu bawaan, RLS. |
| Login | Supabase Auth (email dan kata sandi, MFA TOTP), pendaftaran umum dimatikan | Tanpa membuat sistem login sendiri. |
| Penyimpanan video | Supabase Storage (bucket privat) | Satu tempat untuk video; tautan bertanda tangan untuk Buffer. |
| Status langsung | Supabase Realtime | Menggantikan *polling*; RLS tetap berlaku. |
| Pekerja | Node.js 20+ (TypeScript) di laptop | Satu bahasa dengan antarmuka; tipe dan aturan jadwal dipakai bersama. |
| Monorepo | pnpm workspaces: `apps/web`, `apps/worker`, `packages/shared` | Kode bersama tanpa menyalin. |
| Enkripsi token | AES-256-GCM dengan kunci di variabel lingkungan Vercel dan pekerja | Token tidak terbaca dari database tanpa kunci. |
| Gambar | `sharp` | Mengubah thumbnail menjadi JPEG dan mengecilkannya. |
| Pengujian | `vitest` | Penerbit palsu dan jam yang dapat disuntikkan. |

Pilihan TypeScript menggantikan Python di versi sebelumnya karena antarmuka kini Next.js; satu bahasa mengurangi tipe ganda dan jumlah alat yang harus dirawat.

## 3. Komponen

### 3.1 Aplikasi web (Vercel)

- Halaman: **Masuk**, **Antrean**, **Video baru**, **Detail entri**, **Pengaturan**, **Koneksi akun** (rincian di `ui-ux-design.md`).
- **Route Handlers** (`/api/v1/...`) untuk tindakan yang butuh logika sisi server: membuat dan mengubah entri, membatalkan, meminta coba ulang, OAuth, validasi kunci Buffer, penandatanganan unggahan. Kontraknya ada di `api-specification.md`.
- **Pembacaan** (daftar antrean, detail) dilakukan langsung lewat klien Supabase dengan sesi pengguna, dibatasi RLS, ditambah langganan Realtime.
- **Prinsip akses:** Route Handlers memakai **sesi pengguna** (RLS berlaku) kapan pun mungkin. Kunci `service_role` hanya dipakai untuk menyimpan rahasia akun (`connection_secrets`) saat OAuth dan validasi Buffer, tidak pernah dikirim ke browser.
- **Pemeriksaan sesi** di *middleware*: semua rute selain halaman Masuk dan `/api/oauth/*/callback` wajib sesi sah.

### 3.2 Supabase

| Layanan | Dipakai untuk |
|---|---|
| Postgres | Semua data aplikasi, dengan RLS aktif pada setiap tabel |
| Auth | Satu akun pemilik; MFA TOTP opsional |
| Storage | Bucket `videos` dan `thumbnails` (privat); pembersihan oleh pekerja |
| Realtime | Mendorong perubahan `posts`, `targets`, `worker_heartbeats`, dan `connections` ke browser |

### 3.3 Pekerja (laptop)

Satu proses Node.js yang berjalan terus. Setiap putaran (30 detik):

1. **Detak:** tulis `worker_heartbeats` (`last_tick_at`). Ini juga menjaga proyek Supabase tetap aktif.
2. **Klaim:** panggil fungsi database `claim_targets` yang memilih target siap dengan `FOR UPDATE SKIP LOCKED` dan menetapkan *lease* (hak kerja 15 menit).
3. **Kerjakan:** untuk setiap target, jalankan `pending_action` bila ada (bagian 8), kalau tidak `publisher.advance()`.
4. **Pelihara:** perbarui token yang hampir kedaluwarsa, jalankan uji koneksi yang diminta, perbarui batas API, bersihkan unggahan kedaluwarsa dan berkas lama, ekspor cadangan harian.

Pekerja bangun lebih cepat dari 30 detik bila menerima pemberitahuan Realtime (misalnya pemilik menekan "Coba lagi"), tetapi tidak bergantung padanya.

Pekerja bergabung ke Supabase memakai **kunci `service_role`** (melewati RLS) dan **tidak membuka port apa pun**; semua komunikasi keluar.

### 3.4 Modul penerbit

Antarmuka tunggal untuk semua platform (`apps/worker/src/publishers`):

```ts
interface Publisher {
  platform: "youtube" | "instagram" | "tiktok";

  /** Menghitung planned_dispatch_at untuk entri ini (fungsi murni, ada di packages/shared). */
  plan(post: Post, now: Date): PlannedTarget;

  /** Mengerjakan SATU langkah berikutnya (idempoten); mengembalikan status, step, dan run_at baru. */
  advance(ctx: StepContext): Promise<StepResult>;

  /** Dipanggil saat pemulihan: tanya platform apa yang sebenarnya sudah terjadi. */
  reconcile(ctx: StepContext): Promise<ReconcileResult>;

  /** Terapkan perubahan teks, thumbnail, atau jam ke platform (pending_action = sync_changes). */
  applyChanges(ctx: StepContext): Promise<void>;

  /** Batalkan atau hapus di sisi platform (pending_action = cancel). */
  cancel(ctx: StepContext): Promise<void>;
}
```

`StepContext` berisi target, entri, waktu sekarang, rahasia yang sudah didekripsi, dan akses ke cache media. Penerbit bekerja per langkah kecil dan menyimpan `step` di database, jadi bila proses mati di tengah, pekerjaan dilanjutkan dari langkah terakhir yang tercatat.

### 3.5 Token dan enkripsi

- Token akses, token penyegar, dan API key Buffer disimpan di tabel `connection_secrets`, terenkripsi AES-256-GCM. Tabel ini memakai RLS **tanpa kebijakan untuk pengguna**, sehingga hanya `service_role` yang dapat membacanya; browser tidak pernah bisa, bahkan setelah login.
- Kunci enkripsi (`TOKEN_ENC_KEY`) ada di variabel lingkungan Vercel (untuk menyimpan token saat OAuth) dan pekerja (untuk membacanya). Bila kunci dirotasi, `key_version` mencatat versi yang dipakai tiap baris.
- **Pekerja adalah satu-satunya yang menyegarkan token.** Vercel hanya menyimpan token baru saat OAuth.
- Bila penyegaran gagal permanen, koneksi menjadi `needs_reauth` dan target platform itu ditahan (`hold_reason`), bukan gagal berulang.

## 4. Pembagian tanggung jawab

| Pekerjaan | Vercel (UI/API) | Pekerja (laptop) |
|---|---|---|
| Login dan sesi | ✓ | |
| Membuat, mengubah, dan membatalkan entri di database | ✓ | |
| Mengunggah video | Hanya menandatangani; browser mengunggah langsung ke Storage | |
| Menukar kode OAuth dengan token | ✓ | |
| Validasi API key Buffer dan daftar channel | ✓ | |
| Memanggil API YouTube, Instagram, Buffer untuk memposting | | ✓ |
| Menyegarkan token | | ✓ |
| Uji koneksi | Meminta | ✓ Mengerjakan |
| Coba lagi, batalkan di platform, ubah entri yang sudah dikirim | Mencatat niat (`pending_action`) | ✓ Mengerjakan |
| Pembersihan berkas, cadangan harian | | ✓ |

Aturan praktis: **semua yang memanggil API platform untuk memposting atau mengubah posting dikerjakan pekerja.**

## 5. Model waktu terbit per platform

Setiap target punya dua waktu: **`due_at`** (kapan video tampil publik, ada di `posts`) dan **`planned_dispatch_at`** (kapan pekerja harus mulai bekerja).

| Platform | Model | `planned_dispatch_at` | Siapa yang menerbitkan |
|---|---|---|---|
| YouTube | Pra-jadwal di platform | Segera setelah entri disimpan (saat pekerja berikutnya aktif) | YouTube sendiri, pada `due_at` |
| Instagram | Terbit oleh pekerja | `due_at` dikurangi 10 menit (persiapan) | Pekerja, pada `due_at` |
| TikTok (Buffer) | Serah-terima ke Buffer | Saat `due_at` masuk jendela pengiriman dan antrean Buffer ada ruang | Buffer, pada `due_at` |

Karena pekerja yang mengunggah ke YouTube, bila laptop mati saat entri disimpan, unggahan YouTube menunggu sampai laptop menyala. Selama `due_at` masih jauh, itu tidak masalah.

## 6. Alur per platform

Semua alur dimulai dengan **mengambil video dari Storage ke cache lokal** (satu kali per entri), lalu memakai berkas lokal itu untuk YouTube dan Instagram. Ini menghemat egress Supabase.

### 6.1 YouTube Shorts

1. **`fetch_media`**: unduh video dan thumbnail dari Storage ke `data/cache/<post_id>/` (bila belum ada). Periksa dengan `ffprobe` bila tersedia.
2. **`upload`**: unggah bertahap (`videos.insert`, resumable) dengan `status.privacyStatus = private` dan `status.publishAt = due_at`. Simpan `video_id` di `external_id` segera setelah YouTube mengembalikannya.
3. **`wait_processing`**: periksa `processingDetails.processingStatus` sampai `succeeded`.
4. **`set_thumbnail`**: panggil `thumbnails.set` (thumbnail dikecilkan ke JPEG di bawah 2 MB bila perlu). Hanya setelah pemrosesan selesai.
5. **`await_publish`**: status `awaiting_platform`. Setelah `due_at`, periksa `privacyStatus`; `public` berarti `published`.

Perubahan dan pembatalan: `videos.update` (judul, deskripsi, `publishAt`), `thumbnails.set`, `videos.delete`.

### 6.2 Instagram Reels

1. **`check_limit`**: baca `content_publishing_limit`.
2. **`fetch_media`**: seperti di atas.
3. **`cover_prepare`** (bila ada thumbnail): ubah menjadi JPEG sRGB di bawah 8 MB, unggah ke Storage, buat tautan bertanda tangan untuk `cover_url`.
4. **`create_container`**: `POST /{ig-user-id}/media` dengan `media_type=REELS`, `upload_type=resumable`, `caption`, `cover_url`. Simpan ID kontainer di `external_state`.
5. **`upload_video`**: kirim berkas lokal ke alamat unggah yang dikembalikan.
6. **`wait_finished`**: periksa `status_code` sampai `FINISHED` (menunggu hingga `due_at`).
7. **`publish`** pada `due_at`: tulis `step = publish_requested` **sebelum** memanggil `media_publish`.
8. **`done`**: simpan `external_id` (ID media), status `published`.

Kontainer kedaluwarsa dalam 24 jam, jadi persiapan hanya dimulai 10 menit sebelum jam terbit.

### 6.3 TikTok lewat Buffer

1. **`window_check`**: kirim hanya bila `due_at` dalam jendela pengiriman (nilai awal 2 hari) dan jumlah target TikTok berstatus `awaiting_platform` kurang dari `buffer_queue_limit`.
2. **`sign_url`**: buat tautan bertanda tangan untuk video di Storage, berlaku sampai `due_at` ditambah 6 jam.
3. **`create_post`**: mutasi `createPost` ke `https://api.buffer.com` dengan `schedulingType: automatic`, `mode: customScheduled`, `dueAt`, teks caption, dan `assets: [{ video: { url } }]`. Simpan ID posting Buffer di `external_id`.
4. **`await_publish`**: periksa status posting; `sent` berarti `published`, `error` berarti `failed`.
5. **`cleanup`**: tidak ada yang perlu dihapus di Buffer; berkas dibersihkan oleh pembersihan umum (bagian 12).

Buffer mengambil video **saat jam terbit**, jadi tautan harus tetap sah sampai saat itu dan berkas **tidak boleh** dihapus dari Storage sebelum Buffer melaporkan `sent`.

### 6.4 Urutan kejadian (jalan normal)

```
Pemilik     Browser/Vercel      Supabase           Pekerja          Platform
  │ pilih video  │                  │                  │                │
  ├─────────────►│ minta URL unggah │                  │                │
  │              ├─────────────────►│                  │                │
  │              │◄── URL bertanda ─┤                  │                │
  │              ├── unggah langsung ke Storage ─────►│                  │
  │ simpan form  │ create_post_tx   │                  │                │
  │              ├─────────────────►│ 3 target         │                │
  │              │                  │◄── klaim YT ─────┤                │
  │              │                  │                  ├─ upload+jadwal►│
  │              │◄── Realtime ─────┤ status berubah   │                │
  │              │                  │ (due-10m)        │                │
  │              │                  │◄── klaim IG ─────┤                │
  │              │                  │                  ├─ kontainer ───►│
  │              │                  │ (due_at)         │                │
  │              │                  │                  ├─ media_publish►│
  │              │◄── Realtime ─────┤ published        │                │
```

## 7. Alur unggah media

Video tidak boleh melewati Vercel (batas badan request 4,5 MB). Alurnya:

1. Browser membaca metadata video (durasi, lebar, tinggi) sendiri lewat elemen `<video>` dan menampilkan peringatan (bukan vertikal, terlalu panjang).
2. Browser memanggil `POST /api/v1/uploads` dengan jenis, nama, ukuran, dan metadata. Server memeriksa batas (video maksimal 50 MB), membuat baris `uploads`, dan mengembalikan **URL atau token unggah bertanda tangan** ke Storage.
3. Browser mengunggah **langsung ke Storage** (unggahan bertahap yang dapat dilanjutkan), menampilkan kemajuan.
4. Saat form disimpan, `POST /api/v1/posts` memeriksa bahwa objek benar-benar ada di Storage dengan ukuran yang cocok, lalu membuat entri dan menandai `uploads` sebagai `consumed`.
5. Pekerja kemudian memeriksa ulang video dengan `ffprobe` (bila ada). Bila ternyata tidak valid, target ditandai `failed` dengan alasan yang jelas.
6. Unggahan yang tidak pernah dipakai dibersihkan pekerja setelah 24 jam.

Struktur jalur objek: `<bucket>/<owner_id>/<upload_id>/<nama_berkas>`.

## 8. Perintah dari antarmuka ke pekerja

Vercel tidak dapat memanggil pekerja. Niat pemilik dicatat di database dan dikerjakan pekerja pada putaran berikutnya.

Kolom `targets.pending_action` bernilai `retry`, `cancel`, atau `sync_changes`. Fungsi database yang mengubahnya juga mengatur `run_at = now()` agar segera dipilih pekerja.

| Tindakan pemilik | Yang dicatat | Yang dikerjakan pekerja |
|---|---|---|
| Coba lagi target `failed` atau `missed` | `pending_action = retry` | Mereset `attempt_count`, lanjut dari `step` terakhir, atau `reconcile` bila meragukan |
| Batalkan entri | `posts.state = cancelled`; target `pending_action = cancel` | `cancel()` per platform (hapus video YouTube, batalkan posting Buffer bila API mendukung); lalu target `cancelled` |
| Ubah teks, thumbnail, atau jam | Perubahan di `posts`; target `pending_action = sync_changes` | `applyChanges()` per platform |
| Uji koneksi | `connections.test_requested_at = now()` | Memanggil API ringan, menulis `last_test` |

Selama `pending_action` belum selesai, antarmuka menampilkan "Menunggu pekerja…". Bila pekerja sedang mati, antarmuka menambahkan bahwa tindakan akan dijalankan begitu laptop menyala.

Aturan kapan sebuah perubahan masih boleh (kunci per platform) ada di `api-specification.md` bagian 5.5; nilainya dievaluasi di server dari `step` target.

## 9. Status target dan kebijakan terlewat

Status, transisi, dan nilai `step` didefinisikan di `database-design.md` bagian 6 dan 7.

**Kebijakan terlewat.** Berlaku untuk target yang membutuhkan pekerja hidup pada waktunya (Instagram, serta pengiriman TikTok dan unggahan YouTube yang terlambat):

- Bila `sekarang - due_at <= grace` (nilai awal 2 jam, dapat diatur, minimal 5 menit): kerjakan segera.
- Bila lebih lama: status `missed`, tampilkan peringatan, **jangan posting**.
- Percobaan ulang yang akan jatuh melewati batas itu juga berubah menjadi `missed`.

## 10. Keandalan

### 10.1 Klasifikasi galat

| Jenis | Contoh | Tindakan |
|---|---|---|
| **Sementara** | Jaringan putus, 5xx, 429, Supabase sesaat tidak terjangkau | Ulang dengan jeda 1, 5, 15 menit (hormati `Retry-After`). Maksimal 3 percobaan ulang. |
| **Permanen** | Berkas tidak valid, caption melebihi batas, batas harian habis | `failed` segera dengan alasan terbaca. |
| **Otorisasi** | Token dicabut | Tahan target (`hold_reason = needs_reauth`), minta pemilik menyambung ulang. Tidak dihitung sebagai percobaan ulang. |

### 10.2 Pencegahan posting ganda

- Setiap target punya `idempotency_key` unik.
- `external_id` dan `external_state` ditulis ke database **segera** setelah platform mengembalikannya.
- **Instagram** adalah titik paling rawan: bila pekerja mati setelah `media_publish` dikirim tetapi sebelum hasilnya tercatat (`step = publish_requested`), pemulihan tidak mengulang. Pemulihan membaca media terbaru akun dan mencocokkan; bila cocok menjadi `published`, bila tidak jelas menjadi `failed` dengan catatan "periksa manual".
- **YouTube:** bila `external_id` sudah ada, `upload` tidak diulang.
- **Buffer:** bila `external_id` sudah ada, `create_post` tidak diulang; pemulihan membaca status posting di Buffer.
- **Dua pekerja tidak boleh bekerja pada target yang sama:** dijamin `claim_targets` dengan `FOR UPDATE SKIP LOCKED` dan *lease*.

### 10.3 Pemulihan saat pekerja mulai

1. Target berstatus `uploading` dengan *lease* habis diperiksa dengan `reconcile()` per platform sebelum dilanjutkan.
2. Target yang `due_at`-nya lewat diproses sesuai kebijakan terlewat.
3. Perintah `pending_action` yang tertunda dikerjakan.
4. Cache lokal yang tidak lagi terkait target aktif dibersihkan.

### 10.4 Pemantauan diri

- **Detak pekerja:** antarmuka membaca `worker_heartbeats` dan menampilkan peringatan "pekerja berhenti" bila `last_tick_at` lebih dari 3 menit. Ini penting karena pemilik kini bisa membuka aplikasi dari tempat yang jauh dari laptop.
- **Log pekerja:** JSON ke `data/logs/worker.log` dengan rotasi. Rahasia dan token tidak pernah dicatat.
- **Riwayat kejadian** per target di `target_events` (tanpa rahasia).
- **Supabase dijeda:** proyek gratis dijeda setelah 1 minggu tanpa aktivitas. Detak pekerja tiap putaran mencegahnya selama laptop menyala. Bila laptop mati lebih dari seminggu, proyek harus dipulihkan manual dari dasbor Supabase. Pengaman tambahan opsional: ping terjadwal dari layanan lain (misalnya GitHub Actions tiap 3 hari).

## 11. Pengaturan

Disimpan di tabel `settings` (JSON per kunci); rahasia ada di variabel lingkungan dan `connection_secrets`.

| Kunci | Nilai awal | Keterangan |
|---|---|---|
| `timezone` | `Asia/Jakarta` | Tetap WIB. |
| `slots` | 06:00, 12:00, 16:00, 19:00 | Tabel `slots`; dapat diubah. |
| `grace_minutes` | 120 | Batas keterlambatan Instagram; minimal 5. |
| `tiktok_window_days` | 2 | Jendela pengiriman TikTok; final setelah batas Buffer dikonfirmasi. |
| `buffer_queue_limit` | 10 | Batas antrean per channel; dikonfirmasi pada percobaan kecil. |
| `retry_backoff_minutes` | 1, 5, 15 | Jeda percobaan ulang. |
| `instagram_prepare_lead_minutes` | 10 | Mulai persiapan sebelum jam terbit. |
| `min_lead_minutes` | 15 | Jarak minimal dari sekarang untuk slot baru. |
| `media_retention_days` | 3 | Hapus berkas di Storage dan cache setelah semua target selesai. |
| `event_retention_days` | 180 | Hapus riwayat kejadian yang lebih tua. |
| `max_video_size_mb` | 50 | Mengikuti batas berkas Supabase gratis. |
| `storage_quota_mb` | 1024 | Untuk estimasi pemakaian. |
| `egress_quota_mb` | 5120 | Untuk estimasi pemakaian. |
| `quota_warn_percent` | 80 | Ambang peringatan pemakaian. |

## 12. Media dan kuota

- **Batas berkas:** video maksimal 50 MB (batas Supabase gratis); thumbnail maksimal 8 MB. Berkas lebih besar ditolak sebelum diunggah, dengan saran mengompres.
- **Cache pekerja:** video diunduh sekali ke `data/cache/<post_id>/` dan dipakai untuk YouTube dan Instagram. Cache dihapus setelah semua target selesai.
- **Anggaran egress:** per entri, pekerja mengunduh sekali dan Buffer mengambil sekali, sehingga sekitar 2 kali ukuran video. Pada 120 video per bulan berukuran rata-rata 20 MB, itu sekitar 4,8 GB dari 5 GB. Hampir penuh, jadi: tidak ada pratinjau video otomatis di antarmuka (hanya atas permintaan), thumbnail kecil dipakai di daftar, dan aplikasi menghitung perkiraan pemakaian dari ukuran berkas (`v_usage_estimate`) dan memperingatkan pada 80%.
- **Cadangan bila kuota tidak cukup:** menaruh video TikTok di layanan hosting lain (misalnya Cloudinary), atau meningkatkan ke paket berbayar.
- **Pembersihan:** pekerja menghapus objek Storage dan cache `media_retention_days` hari setelah semua target mencapai status akhir. Target `failed` yang berkasnya sudah terhapus tidak dapat dicoba ulang.

## 13. Keamanan

- **Autentikasi:** Supabase Auth, satu akun pemilik, pendaftaran umum dimatikan, MFA TOTP dianjurkan. Kata sandi kuat; pembatasan percobaan masuk dari Supabase.
- **Otorisasi:** RLS aktif pada semua tabel; kebijakan `owner_id = auth.uid()`. Pengguna hanya dapat membaca baris miliknya; hampir semua penulisan lewat fungsi database atau Route Handlers.
- **Rahasia akun:** hanya di `connection_secrets` (tanpa akses pengguna), terenkripsi.
- **Kunci server:** `service_role` hanya di lingkungan server Vercel dan pekerja; tidak pernah di kode klien atau repositori.
- **CSRF dan asal:** Route Handlers yang mengubah data memeriksa header `Origin` sama dengan alamat aplikasi, dan cookie sesi `SameSite=Lax` dengan `HttpOnly`.
- **OAuth:** parameter `state` sekali pakai (kedaluwarsa 10 menit) disimpan di server; alamat balik memakai alamat HTTPS Vercel.
- **Storage:** bucket privat; tautan bertanda tangan berumur pendek untuk pratinjau (10 menit) dan umur lebih panjang hanya untuk Buffer (sampai jam terbit ditambah 6 jam).
- **Rahasia di repositori:** tidak ada; `.env.example` disertakan.
- **Log:** tidak mencatat token atau tautan bertanda tangan.

## 14. Operasional

**Penyebaran aplikasi web**
- Repositori git terhubung ke Vercel; setiap dorongan ke cabang utama menyebarkan otomatis.
- Variabel lingkungan Vercel: URL dan kunci anon Supabase (publik), `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENC_KEY`, kredensial OAuth Google dan Meta.

**Skema database**
- Migrasi SQL di `supabase/migrations/`, diterapkan dengan Supabase CLI.

**Pekerja di laptop**
- Dijalankan otomatis saat laptop hidup: Task Scheduler (Windows), `launchd` (macOS), atau `systemd` (Linux). *Sistem operasi laptop belum ditentukan; dipilih saat pembangunan.*
- Mode tidur dimatikan; sambungan listrik tetap; internet stabil.
- Variabel lingkungan pekerja: URL Supabase, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENC_KEY`, `OWNER_ID`, `WORKER_ID`, kredensial OAuth (untuk penyegaran token).
- Perintah tunggal untuk memulai; berkas log berotasi.

**Cadangan**
- Paket gratis Supabase tidak punya cadangan otomatis. Pekerja mengekspor tabel inti (`posts`, `targets`, `target_events`, `slots`, `settings`, `connections`; tanpa `connection_secrets`) sebagai JSON ke `data/backups/<tanggal>/` setiap hari dan menyimpan 7 salinan. Bila rahasia hilang, pemilik cukup menyambung ulang akun.

## 15. Hal yang harus dipastikan lebih dulu (percobaan kecil)

Dikerjakan sebelum membangun penuh. Hasilnya dapat mengubah bagian di atas.

| # | Pertanyaan | Bila jawabannya buruk |
|---|---|---|
| 1 | Apakah posting Instagram untuk akun sendiri berjalan tanpa App Review (mode Development), dan jalur login mana yang dipakai? | Tinjau ulang kebutuhan App Review. |
| 2 | Apakah upload YouTube dari proyek belum terverifikasi berstatus publik, dan apakah `publishAt` berfungsi? | Ajukan audit atau pakai jalur Buffer untuk YouTube. |
| 3 | Batas antrean gratis Buffer, apakah video TikTok bisa dijadwalkan lewat API di paket gratis, dan apakah API-nya bisa menyunting atau menghapus posting? | Jatuh ke penjadwal bawaan TikTok atau jalur draf; TikTok terkunci setelah dikirim. |
| 4 | **Apakah Buffer menerima dan berhasil mengambil video dari tautan bertanda tangan Supabase Storage?** | Pakai bucket publik dengan nama acak atau hosting lain. |
| 5 | Apakah unggahan langsung dari browser ke Storage (bertahap, dapat dilanjutkan) berjalan baik di Vercel dengan sesi pengguna? | Tinjau metode penandatanganan unggahan. |
| 6 | Perkiraan egress nyata per entri dibandingkan kuota 5 GB. | Tambah kompresi atau pindah hosting TikTok. |

Alamat balik OAuth kini memakai HTTPS Vercel, sehingga risiko "localhost diterima atau tidak" pada versi lama tidak berlaku lagi.

## 16. Struktur proyek

```
shortscheduler/
├── apps/
│   ├── web/                          # Next.js di Vercel
│   │   ├── app/                      # halaman dan Route Handlers (/api/v1, /api/oauth)
│   │   ├── components/
│   │   └── lib/                      # klien Supabase, sesi, enkripsi token
│   └── worker/                       # pekerja di laptop
│       └── src/
│           ├── main.ts               # putaran, detak, klaim
│           ├── scheduler.ts          # klaim, kebijakan terlewat, pemulihan
│           ├── actions.ts            # retry, cancel, sync_changes, test
│           ├── maintenance.ts        # token, pembersihan, cadangan
│           ├── media-cache.ts        # unduh dan hapus cache
│           └── publishers/
│               ├── base.ts
│               ├── youtube.ts
│               ├── instagram.ts
│               └── tiktok-buffer.ts
├── packages/
│   └── shared/                       # tipe, skema zod, aturan slot, plan() per platform
├── supabase/
│   ├── migrations/                   # 0001_init.sql, ...
│   └── config.toml
├── data/                             # (diabaikan git) cache, log, cadangan di laptop
├── .env.example
└── README.md
```

## 17. Strategi pengujian

- **Jam yang bisa disuntikkan.** Semua logika waktu menerima `now` sebagai parameter, sehingga aturan slot, jendela TikTok, dan kebijakan terlewat diuji tanpa menunggu.
- **Penerbit palsu.** Pekerja diuji dengan penerbit palsu yang bisa dipaksa gagal, lambat, atau berhenti di tengah.
- **Uji database.** Fungsi `claim_targets`, `create_post_tx`, indeks unik slot, dan kebijakan RLS diuji pada Postgres nyata (Supabase lokal).
- **Kasus wajib:**
  - pekerja mati tepat setelah `media_publish` dikirim;
  - mulai ulang saat target `uploading`;
  - dua pekerja mencoba mengklaim target yang sama;
  - jam jatuh tepat di batas `grace_minutes`;
  - token dicabut di tengah pekerjaan;
  - Buffer penuh;
  - video melebihi 50 MB, bukan vertikal, caption melebihi batas;
  - perubahan atau pembatalan setelah YouTube dijadwalkan, dan saat pekerja mati;
  - pengguna lain (atau tanpa login) mencoba membaca data atau rahasia (harus ditolak RLS).
- **Uji kontrak.** Respons nyata tiap API direkam saat percobaan kecil dan dipakai sebagai bahan uji (tanpa rahasia).

## 18. Jalan ke cloud (pekerja) dan versi berlangganan

### 18.1 Memindahkan pekerja dari laptop ke cloud atau server

Pemilik berencana memindahkan pekerja agar tidak bergantung pada laptop. Rancangan ini sudah menyiapkannya:

| Sifat rancangan | Mengapa memudahkan |
|---|---|
| Pekerja hanya berbicara ke Supabase dan API platform | Tidak ada ketergantungan jaringan lokal; bisa berjalan di mana saja dengan internet |
| Semua konfigurasi lewat variabel lingkungan | Dibungkus menjadi kontainer tanpa mengubah kode |
| Berkas lokal hanya cache sementara | Cukup disk sementara; tidak perlu penyimpanan permanen |
| Klaim target memakai *lease* dan `FOR UPDATE SKIP LOCKED` | Aman bila nanti ada lebih dari satu instans |
| Cadangan harian ditulis ke folder | Dapat diarahkan ke penyimpanan objek atau dibuang bila platform menyediakan cadangan |

**Langkah pindah (garis besar):**
1. Bungkus pekerja menjadi kontainer (Dockerfile) dengan Node.js dan `ffmpeg`.
2. Jalankan di layanan yang menjaga proses tetap hidup: VPS kecil, atau layanan kontainer (Fly.io, Railway, Cloud Run dengan instans minimum 1).
3. Salin variabel lingkungan; matikan pekerja di laptop (**jangan jalankan dua pekerja pada waktu yang sama** sampai aturan klaim terbukti aman).
4. Atur penyimpanan cadangan harian ke tempat yang sesuai.

**Alternatif tanpa server sendiri:** menjalankan penjadwal dengan `pg_cron` dan Edge Functions di Supabase. Ini gratis, tetapi belum diverifikasi bahwa batas waktu dan CPU fungsi tersebut cukup untuk mengirim video 20 sampai 50 MB ke YouTube dan Instagram, jadi perlu percobaan khusus sebelum dipilih.

**Yang berubah saat pekerja di cloud:** tidak ada peringatan "laptop mati" lagi; peringatan "pekerja berhenti" tetap berlaku (detak yang sama). Biaya bisa muncul bila layanan cloud tidak gratis.

### 18.2 Versi berlangganan (tidak dikerjakan sekarang)

Yang sudah disiapkan agar kelak tidak perlu menulis ulang: setiap tabel memiliki `owner_id` dengan RLS (kerangka multi-pengguna), penerbit terpisah, status per target, dan pekerja yang tidak bergantung pada laptop. Yang perlu ditambah kelak: pendaftaran pengguna, token per pengguna, kuota per pengguna, penagihan, paket Vercel dan Supabase berbayar, dan audit TikTok sendiri.
