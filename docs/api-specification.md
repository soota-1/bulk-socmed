# API Specification: Penjadwal Video Pendek

| | |
|---|---|
| Versi | 2.0 (Vercel + Supabase; menggantikan versi lokal) |
| Tanggal | 21 November 2026 |
| Dokumen terkait | `prd.md`, `system-design.md`, `database-design.md`, `ui-ux-design.md` |

Dokumen ini menjelaskan **API HTTP internal** aplikasi. API ini dipakai oleh antarmuka web (halaman di browser) dan diterapkan sebagai **Route Handlers Next.js di Vercel**, di atas database Supabase. Pekerja penjadwal di laptop tidak memiliki API; ia berkomunikasi dengan aplikasi hanya lewat database. API **bukan** API publik; kontraknya boleh berubah selama pembangunan, tetapi setiap perubahan harus memperbarui dokumen ini.

---

## 1. Ikhtisar dan konvensi

| Hal | Aturan |
|---|---|
| Alamat dasar | `https://<nama-aplikasi>.vercel.app` (produksi) dan `http://localhost:3000` (pengembangan) |
| Awalan API | `/api/v1` |
| Autentikasi | Sesi Supabase Auth (cookie). Semua `/api/v1/*` wajib login. |
| Format | JSON (`application/json`). Berkas video dan gambar **tidak** lewat API ini; diunggah langsung ke Supabase Storage (bagian 4). |
| Waktu | Dalam JSON selalu **UTC** berformat ISO 8601 dengan `Z` (contoh `2026-11-22T23:00:00Z`). Bidang berakhiran `_local` berisi waktu WIB dengan offset (contoh `2026-11-23T06:00:00+07:00`) hanya untuk tampilan. |
| ID | Bilangan bulat |
| Bahasa pesan | Bidang `message` pada galat berbahasa Indonesia dan siap ditampilkan ke pemilik. Bidang `code` stabil dan dipakai oleh kode program. |
| Paginasi | `limit` (nilai awal 50, maksimal 200) dan `offset` (nilai awal 0). Respons daftar berisi `total`. |
| Pencegahan kirim ganda | `POST /posts` menerima header `Idempotency-Key`. Permintaan dengan kunci yang sama dalam 24 jam mengembalikan hasil permintaan pertama. |

### 1.1 Bentuk galat

Semua galat memakai satu bentuk:

```json
{
  "error": {
    "code": "slot_taken",
    "message": "Slot 23 Nov 06:00 sudah terisi. Pilih slot lain.",
    "details": { "slot_key": "2026-11-23@06:00" }
  }
}
```

Daftar kode galat ada di bagian 12.

### 1.2 Bentuk status

Nilai `status` target mengikuti `database-design.md`: `draft`, `scheduled`, `uploading`, `awaiting_platform`, `published`, `failed`, `missed`, `cancelled`.

Nilai `overall_status` entri adalah turunan:

| `overall_status` | Arti |
|---|---|
| `draft` | Disimpan tetapi belum dijadwalkan |
| `scheduled` | Semua target `scheduled` atau `awaiting_platform` |
| `in_progress` | Ada target `uploading` |
| `needs_attention` | Ada target `failed`, `missed`, atau `hold_reason` terisi |
| `published` | Semua target `published` |
| `cancelled` | Entri dibatalkan |

Prioritas bila beberapa berlaku: `needs_attention` mengalahkan yang lain.

## 2. Keamanan permintaan

Aplikasi terbuka di internet, jadi keamanan bertumpu pada login dan RLS database, bukan pada localhost.

1. **Autentikasi.** Supabase Auth; sesi disimpan dalam cookie `HttpOnly`, `Secure`, `SameSite=Lax`. Setiap permintaan `/api/v1/*` tanpa sesi sah ditolak `401 unauthenticated`. Pengecualian: `GET /healthz` dan `GET /api/oauth/{platform}/callback` (diverifikasi dengan parameter `state`).
2. **Pendaftaran dimatikan.** Hanya akun pemilik yang ada; orang lain tidak dapat membuat akun.
3. **Pemeriksaan `Origin`.** Permintaan yang mengubah data (`POST`, `PUT`, `PATCH`, `DELETE`) wajib berheader `Origin` yang sama dengan alamat aplikasi. Bila tidak ada atau berbeda, ditolak `403 origin_not_allowed`. Ini menambah pertahanan CSRF di samping `SameSite=Lax`.
4. **Hak akses data.** Route Handlers memakai **sesi pengguna** sehingga RLS database berlaku (`database-design.md` bagian 5). Kunci `service_role` hanya dipakai untuk membaca atau menulis `connection_secrets` (saat OAuth dan validasi kunci Buffer) dan tidak pernah dikirim ke browser.
5. **Rahasia tidak pernah dikembalikan.** Respons tidak pernah memuat token akses, token penyegar, atau API key. API hanya mengembalikan apakah rahasia itu ada.
6. **Tautan bertanda tangan.** Hanya dikembalikan untuk pratinjau (berlaku 10 menit) dan tidak pernah dicatat di log.

## 3. Ringkasan endpoint

| Metode | Jalur | Fungsi |
|---|---|---|
| POST | `/api/v1/uploads` | Minta URL unggah bertanda tangan ke Storage (video atau thumbnail) |
| POST | `/api/v1/uploads/{upload_id}/complete` | Konfirmasi unggahan selesai; server memverifikasi objek di Storage |
| DELETE | `/api/v1/uploads/{upload_id}` | Buang unggahan |
| POST | `/api/v1/posts` | Buat entri (dan jadwalkan) |
| GET | `/api/v1/posts` | Daftar entri |
| GET | `/api/v1/posts/{id}` | Detail entri beserta target |
| PATCH | `/api/v1/posts/{id}` | Ubah teks, thumbnail, atau jam |
| DELETE | `/api/v1/posts/{id}` | Batalkan entri |
| GET | `/api/v1/posts/{id}/media` | Tautan bertanda tangan untuk pratinjau video dan thumbnail |
| POST | `/api/v1/posts/{id}/targets/{platform}/retry` | Minta coba ulang target `failed` atau `missed` |
| GET | `/api/v1/posts/{id}/targets/{platform}/events` | Riwayat kejadian target |
| GET | `/api/v1/slots` | Slot harian |
| PUT | `/api/v1/slots` | Ganti seluruh daftar slot |
| GET | `/api/v1/slots/next-free` | Slot kosong berikutnya |
| GET | `/api/v1/slots/occupancy` | Keterisian slot untuk rentang tanggal |
| GET | `/api/v1/connections` | Status koneksi akun |
| POST | `/api/v1/connections/{platform}/authorize` | Mulai OAuth (YouTube, Instagram) |
| GET | `/api/oauth/{platform}/callback` | Tujuan balik OAuth (bukan untuk dipanggil langsung) |
| PUT | `/api/v1/connections/tiktok` | Simpan API key Buffer dan pilih channel TikTok |
| GET | `/api/v1/connections/tiktok/channels` | Daftar channel Buffer yang tersedia |
| POST | `/api/v1/connections/{platform}/test` | Minta uji koneksi (dikerjakan pekerja) |
| DELETE | `/api/v1/connections/{platform}` | Putuskan koneksi |
| GET | `/api/v1/settings` | Baca pengaturan |
| PATCH | `/api/v1/settings` | Ubah pengaturan |
| GET | `/api/v1/status` | Kesehatan pekerja, pemakaian kuota, dan peringatan |
| GET | `/healthz` | Pemeriksaan kesehatan sederhana (tanpa login) |

**Catatan pembacaan langsung.** Antarmuka boleh membaca `posts`, `targets`, dan `worker_heartbeats` langsung lewat klien Supabase (dibatasi RLS) dan berlangganan Realtime untuk pembaruan status. Endpoint `GET` di atas tetap disediakan sebagai kontrak yang stabil, dan agar sumber data dapat berpindah tanpa mengubah antarmuka.

**Tindakan yang dikerjakan pekerja.** `retry`, `DELETE` entri, `PATCH` entri yang sudah dikirim ke platform, dan `test` hanya **mencatat niat** di database. Pekerja mengerjakannya pada putaran berikutnya (paling lama sekitar 30 detik bila aktif). Selama belum selesai, target membawa `pending_action` (bagian 5.1).

## 4. Unggahan media

Video **tidak boleh** melewati Vercel (batas badan request 4,5 MB). Browser mengunggah langsung ke Supabase Storage dengan URL bertanda tangan, dengan alur berikut.

### 4.1 Alur

1. Browser membaca metadata video sendiri (durasi, lebar, tinggi) lewat elemen `<video>`.
2. Browser memanggil `POST /api/v1/uploads`; server memvalidasi dan mengembalikan alamat unggah.
3. Browser mengunggah berkas **langsung ke Storage**, dengan unggahan bertahap yang dapat dilanjutkan untuk berkas besar, dan menampilkan kemajuan.
4. Browser memanggil `POST /api/v1/uploads/{upload_id}/complete`; server memverifikasi bahwa objek ada dan ukurannya cocok.
5. Saat form disimpan, `POST /api/v1/posts` memakai `upload_id` itu.

Berkas yang tidak pernah dipakai dibersihkan pekerja setelah 24 jam. Jalur objek: `<bucket>/<owner_id>/<upload_id>/<nama_berkas>`.

### 4.2 `POST /api/v1/uploads`

Isi JSON:

| Bidang | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `kind` | `video` atau `thumbnail` | ya | |
| `filename` | string | ya | |
| `size_bytes` | integer | ya | Video maksimal **50 MB**; thumbnail maksimal 8 MB |
| `content_type` | string | ya | Video: `video/mp4`, `video/quicktime`. Thumbnail: `image/jpeg`, `image/png`. |
| `metadata` | objek | untuk video | `{ "duration_ms": 28400, "width": 1080, "height": 1920 }` |

**Respons `201`:**

```json
{
  "upload_id": "9b2d0c0e-5f0b-4d51-9a1f-0f6a7a1d2c11",
  "kind": "video",
  "bucket": "videos",
  "object_path": "5f1c.../9b2d.../klip_tips_01.mp4",
  "upload": {
    "method": "signed_url",
    "url": "https://<proyek>.supabase.co/storage/v1/object/upload/sign/videos/...",
    "token": "eyJ...",
    "expires_at": "2026-11-21T09:30:00Z"
  },
  "warnings": [],
  "expires_at": "2026-11-22T09:00:00Z"
}
```

`upload.method` bernilai `signed_url` (unggahan sekali jalan) atau `tus` (unggahan bertahap yang dapat dilanjutkan untuk berkas besar).

`warnings` berisi peringatan yang **tidak memblokir**, dihitung server dari `metadata`; masing-masing `{ "code", "message", "platforms" }`. Contoh:

```json
{
  "code": "not_vertical",
  "message": "Video ini tidak berformat vertikal 9:16. Tampilan di Shorts, Reels, dan TikTok bisa terpotong.",
  "platforms": ["youtube", "instagram", "tiktok"]
}
```

Kode peringatan: `not_vertical`, `duration_over_limit`, `low_resolution`, `thumbnail_ratio_cropped`.

**Galat pemblokir:** `400 unsupported_file_type`, `413 file_too_large` (`details.limit_mb`: 50 untuk video), `422 validation_error`.

### 4.3 `POST /api/v1/uploads/{upload_id}/complete`

Tanpa isi. Server memeriksa objek di Storage.

```json
{ "upload_id": "9b2d...", "state": "ready", "size_bytes": 18400000 }
```

**Galat:** `404 upload_not_found`, `409 upload_not_ready` (objek belum ada atau ukurannya tidak cocok).

### 4.4 `DELETE /api/v1/uploads/{upload_id}`

Menghapus objek dari Storage dan baris `uploads`. Mengembalikan `204`. Dipanggil bila pemilik mengganti berkas sebelum menyimpan. Unggahan yang sudah `consumed` tidak dapat dihapus lewat jalur ini (`409 upload_in_use`).

## 5. Entri video (`posts`)

### 5.1 Objek `Post`

```json
{
  "id": 42,
  "title": "Tips hemat listrik",
  "caption": "3 kebiasaan kecil yang menurunkan tagihan.",
  "hashtags": "#tips #hemat #fyp",
  "video": {
    "duration_ms": 28400,
    "width": 1080,
    "height": 1920,
    "size_bytes": 18400000,
    "available": true
  },
  "thumbnail": { "available": true },
  "due_at": "2026-11-22T23:00:00Z",
  "due_at_local": "2026-11-23T06:00:00+07:00",
  "slot_key": "2026-11-23@06:00",
  "is_time_overridden": false,
  "state": "active",
  "overall_status": "scheduled",
  "targets": [
    {
      "platform": "youtube",
      "status": "awaiting_platform",
      "step": "await_publish",
      "planned_dispatch_at": "2026-11-21T09:01:00Z",
      "published_at": null,
      "public_url": null,
      "hold_reason": null,
      "pending_action": null,
      "attempt_count": 0,
      "last_error": null
    },
    {
      "platform": "instagram",
      "status": "scheduled",
      "step": null,
      "planned_dispatch_at": "2026-11-22T22:50:00Z",
      "published_at": null,
      "public_url": null,
      "hold_reason": null,
      "pending_action": null,
      "attempt_count": 0,
      "last_error": null
    },
    {
      "platform": "tiktok",
      "status": "scheduled",
      "step": null,
      "planned_dispatch_at": "2026-11-21T09:01:00Z",
      "published_at": null,
      "public_url": null,
      "hold_reason": null,
      "pending_action": null,
      "attempt_count": 0,
      "last_error": null
    }
  ],
  "created_at": "2026-11-21T09:00:00Z",
  "updated_at": "2026-11-21T09:01:20Z"
}
```

Catatan:
- `thumbnail` bernilai `null` bila tidak ada.
- `video.available` bernilai `false` bila berkas lokal sudah dibersihkan.
- `last_error`, bila ada, berbentuk `{ "code": "quota_exceeded", "message": "Kuota unggah YouTube hari ini habis. Dicoba lagi besok." }`.
- `hold_reason`, bila terisi (misalnya `needs_reauth`), menandai target yang ditahan.
- `pending_action` bernilai `retry`, `cancel`, atau `sync_changes` bila ada tindakan pemilik yang menunggu pekerja; selain itu `null`. Antarmuka menampilkannya sebagai "Menunggu pekerja…".
- Video dan thumbnail tidak memiliki URL tetap; tautan pratinjau diminta lewat `GET /posts/{id}/media`.

### 5.2 `POST /api/v1/posts`: buat entri

Header opsional: `Idempotency-Key`.

Isi JSON:

| Bidang | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `video_upload_id` | string | ya | Dari `POST /uploads` |
| `thumbnail_upload_id` | string | tidak | Dari `POST /uploads` |
| `title` | string | tidak | Maksimal 100 karakter. Bila kosong, diambil dari baris pertama `caption`, dipotong 100 karakter. |
| `caption` | string | ya | Tidak boleh kosong |
| `hashtags` | string | tidak | Digabung ke caption saat publikasi |
| `schedule` | objek | ya | Lihat di bawah |
| `mode` | `schedule` atau `draft` | tidak | Nilai awal `schedule` |

`schedule` berisi **salah satu** dari:

```json
{ "type": "next_free" }
```
```json
{ "type": "slot", "slot_key": "2026-11-23@12:00" }
```
```json
{ "type": "custom", "due_at": "2026-11-23T05:30:00Z" }
```

- `next_free`: server memilih slot kosong berikutnya.
- `slot`: slot tertentu; ditolak `409 slot_taken` bila sudah terisi.
- `custom`: jam bebas (menimpa slot); `slot_key` menjadi `null` dan `is_time_overridden` menjadi `true`.

**Validasi:** `caption` dan `title` dibandingkan dengan batas platform (lihat `message` galat); jam harus minimal `min_lead_minutes` (nilai awal 15 menit) dari sekarang; `mode: draft` tidak membutuhkan `schedule`.

**Respons `201`:** objek `Post`. Server membuat entri dan tiga target dalam satu transaksi (fungsi database `create_post_tx`).

**Galat:** `400 validation_error`, `404 upload_not_found`, `409 upload_not_ready`, `409 slot_taken`, `422 caption_too_long`, `422 due_in_past`, `422 due_too_soon`.

### 5.3 `GET /api/v1/posts`: daftar entri

Parameter kueri:

| Parameter | Keterangan |
|---|---|
| `overall_status` | Satu atau lebih (dipisah koma): `scheduled`, `needs_attention`, `published`, dan seterusnya |
| `from`, `to` | Batas `due_at` (UTC). Nilai awal `from` = awal hari ini (WIB) |
| `order` | `due_at_asc` (nilai awal) atau `due_at_desc` |
| `updated_since` | ISO 8601 UTC; hanya entri yang berubah sejak waktu itu (untuk *polling* hemat) |
| `limit`, `offset` | Paginasi |

**Respons `200`:**

```json
{
  "items": [ { "...": "objek Post" } ],
  "total": 12,
  "server_time": "2026-11-21T09:05:00Z"
}
```

Antarmuka memanggil endpoint ini tiap 15 detik dengan `updated_since` untuk memperbarui status tanpa memuat ulang halaman.

### 5.4 `GET /api/v1/posts/{id}`

Mengembalikan objek `Post`. `404 post_not_found` bila tidak ada.

### 5.5 `PATCH /api/v1/posts/{id}`: ubah entri

Isi JSON (semua bidang opsional, minimal satu):

| Bidang | Keterangan |
|---|---|
| `title`, `caption`, `hashtags` | Teks baru |
| `thumbnail_upload_id` | Ganti thumbnail; `null` untuk menghapus |
| `schedule` | Jam baru, bentuknya sama seperti saat membuat |

**Atomik.** Perubahan diterapkan ke semua target atau tidak sama sekali. Bila ada target yang tidak dapat diubah lagi, seluruh permintaan ditolak:

```json
{
  "error": {
    "code": "post_locked",
    "message": "Instagram sudah mulai dipersiapkan, jadi teks dan jam tidak bisa diubah lagi. Batalkan entri ini dan buat ulang bila perlu.",
    "details": { "locked_platforms": ["instagram"] }
  }
}
```

Aturan kapan sebuah perubahan masih boleh:

| Perubahan | YouTube | Instagram | TikTok (Buffer) |
|---|---|---|---|
| Judul, caption, hashtag | Boleh sampai terbit (`videos.update`) | Boleh sebelum `create_container` (sebelum `instagram_prepare_lead_minutes` jelang jam terbit) | Boleh selama belum dikirim ke Buffer. Setelah dikirim, bergantung dukungan API Buffer untuk menyunting atau menghapus posting (dipastikan pada percobaan kecil). |
| Thumbnail | Boleh sampai terbit (`thumbnails.set`) | Sama seperti Instagram di atas | Tidak berlaku (tidak dikelola aplikasi) |
| Jam terbit | Boleh sampai terbit (`videos.update`, `publishAt`) | Sama seperti Instagram di atas | Sama seperti TikTok di atas |

Bila bergantung pada dukungan API Buffer dan ternyata tidak tersedia, target TikTok yang sudah dikirim dianggap terkunci (`post_locked`).

**Respons `200`:** objek `Post` terbaru. Perubahan pada entri yang sudah dikirim ke platform diteruskan oleh pekerja; sampai selesai, target terkait membawa `pending_action: "sync_changes"`. **Galat:** `404 post_not_found`, `409 post_locked`, `409 slot_taken`, `422 caption_too_long`, `422 due_in_past`, `422 due_too_soon`.

### 5.6 `DELETE /api/v1/posts/{id}`: batalkan

Membatalkan entri dan seluruh target yang belum berstatus akhir. Efek di sisi platform:

| Platform | Efek |
|---|---|
| YouTube | Video yang sudah diunggah dihapus (`videos.delete`) bila belum terbit |
| Instagram | Kontainer dibiarkan kedaluwarsa; tidak ada yang terbit |
| TikTok | Posting di Buffer dibatalkan bila API mendukung; aset titipan dihapus |

Slot yang dipakai menjadi kosong lagi. Entri yang sudah terbit di suatu platform **tidak** ditarik dari platform itu; hanya sisanya dibatalkan.

**Respons `200`:** objek `Post` dengan `state: "cancelled"`. Entri langsung dianggap dibatalkan dan slotnya kosong; pembersihan di sisi platform dikerjakan pekerja (target membawa `pending_action: "cancel"` sampai selesai). Bila ada target yang gagal dibatalkan di platform, target itu tetap ada dengan `last_error` yang menjelaskannya.

### 5.7 `GET /api/v1/posts/{id}/media`: pratinjau

Mengembalikan tautan bertanda tangan berumur pendek (10 menit) ke Storage untuk pratinjau.

Parameter: `kind` = `video`, `thumbnail`, atau tidak ada (keduanya).

```json
{
  "video_url": "https://<proyek>.supabase.co/storage/v1/object/sign/videos/...",
  "thumbnail_url": "https://<proyek>.supabase.co/storage/v1/object/sign/thumbnails/...",
  "expires_at": "2026-11-21T09:15:00Z"
}
```

`404 media_not_available` bila berkas sudah dibersihkan. Memutar video memakai kuota egress Supabase, jadi antarmuka hanya meminta `video` saat pemilik menekan "Putar pratinjau", bukan saat halaman dimuat.

## 6. Target

### `POST /api/v1/posts/{id}/targets/{platform}/retry`

`{platform}` adalah `youtube`, `instagram`, atau `tiktok`. Hanya untuk target berstatus `failed` atau `missed`, dan hanya selama berkas lokal masih ada.

Untuk target `missed`, waktu terbit sudah lewat. Isi JSON opsional:

```json
{ "publish_now": true }
```

- `publish_now: true`: terbitkan sekarang.
- `publish_now: false` atau tidak ada: ditolak `409 due_passed` untuk Instagram bila waktunya sudah lewat; pemilik harus memilih jam baru lewat `PATCH`.

**Respons `202`:** objek target dengan `pending_action: "retry"`; pekerja mengerjakannya pada putaran berikutnya. **Galat:** `404`, `409 not_retryable` (status bukan `failed`/`missed`), `409 media_not_available`, `409 connection_needs_reauth`, `409 pending_action_exists`.

Target `failed` pada kondisi Instagram yang meragukan (`publish_requested` tanpa kepastian) tidak boleh dicoba ulang otomatis; endpoint ini mengembalikan `409 manual_check_required` bila pemilik belum menandainya telah diperiksa. Penandaan itu dilakukan dengan:

```json
{ "confirm_not_published": true }
```

### `GET /api/v1/posts/{id}/targets/{platform}/events`

Mengembalikan riwayat kejadian target (dari `target_events`), terbaru lebih dulu.

```json
{
  "items": [
    {
      "at": "2026-11-22T22:50:12Z",
      "event": "step_done",
      "from_status": "scheduled",
      "to_status": "uploading",
      "detail": { "step": "create_container" }
    }
  ],
  "total": 4
}
```

`detail` tidak pernah berisi token atau rahasia.

## 7. Slot

### Objek `Slot`

```json
{ "id": 1, "local_time": "06:00", "is_active": true }
```

### `GET /api/v1/slots`

```json
{
  "timezone": "Asia/Jakarta",
  "items": [
    { "id": 1, "local_time": "06:00", "is_active": true },
    { "id": 2, "local_time": "12:00", "is_active": true },
    { "id": 3, "local_time": "16:00", "is_active": true },
    { "id": 4, "local_time": "19:00", "is_active": true }
  ]
}
```

### `PUT /api/v1/slots`

Mengganti seluruh daftar. Isi:

```json
{ "items": [ { "local_time": "06:00" }, { "local_time": "12:00" } ] }
```

Aturan: format `HH:MM`, tanpa duplikat, antara 1 dan 12 slot. Entri yang sudah terjadwal **tidak berubah** (lihat `slot_key` di `database-design.md`). **Respons `200`:** seperti `GET`.

### `GET /api/v1/slots/next-free`

Parameter opsional: `after` (UTC) untuk mencari slot setelah waktu tertentu.

```json
{
  "slot_key": "2026-11-23@12:00",
  "due_at": "2026-11-23T05:00:00Z",
  "due_at_local": "2026-11-23T12:00:00+07:00"
}
```

### `GET /api/v1/slots/occupancy`

Untuk pemilih slot. Parameter: `from` dan `to` (tanggal WIB, `YYYY-MM-DD`; maksimal 14 hari).

```json
{
  "days": [
    {
      "date": "2026-11-23",
      "slots": [
        { "slot_key": "2026-11-23@06:00", "local_time": "06:00", "post_id": 42, "title": "Tips hemat listrik", "is_past": false },
        { "slot_key": "2026-11-23@12:00", "local_time": "12:00", "post_id": null, "title": null, "is_past": false }
      ],
      "custom_posts": []
    }
  ]
}
```

`custom_posts` berisi entri yang jamnya ditimpa (tidak menempati slot) pada hari itu.

## 8. Koneksi akun

### Objek `Connection`

```json
{
  "platform": "instagram",
  "status": "active",
  "display_name": "@channelsaya",
  "connected_at": "2026-11-21T08:00:00Z",
  "token_expires_at": "2027-01-20T08:00:00Z",
  "details": {
    "publish_limit": { "remaining": 96, "limit": 100, "resets_at": "2026-11-22T08:00:00Z" }
  }
}
```

`status`: `active`, `needs_reauth`, `disabled`, atau `not_connected`. Untuk TikTok, `details` memuat `{ "buffer_channel_id": "...", "buffer_queue": { "used": 3, "limit": 10 } }`.

### `GET /api/v1/connections`

```json
{
  "items": [
    { "platform": "youtube", "status": "active", "display_name": "Channel Saya", "details": {} },
    { "platform": "instagram", "status": "needs_reauth", "display_name": "@channelsaya", "details": {} },
    { "platform": "tiktok", "status": "not_connected", "display_name": null, "details": {} }
  ]
}
```

### `POST /api/v1/connections/{platform}/authorize`

`{platform}` adalah `youtube` atau `instagram`. Memulai alur OAuth dan mengembalikan alamat izin:

```json
{ "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth?...", "state_expires_at": "2026-11-21T09:20:00Z" }
```

Alamat balik yang didaftarkan di Google Cloud dan Meta adalah `https://<nama-aplikasi>.vercel.app/api/oauth/{platform}/callback` (HTTPS dari Vercel). Antarmuka membuka alamat itu. Setelah pemilik menyetujui, penyedia mengarahkan browser ke `GET /api/oauth/{platform}/callback?code=...&state=...`. Server memverifikasi `state` (sekali pakai, berlaku 10 menit), menukar `code` dengan token, menyimpannya terenkripsi, lalu mengalihkan browser ke `/connections?connected={platform}`. Bila gagal, dialihkan ke `/connections?error={kode}`.

Bila koneksi sebelumnya berstatus `needs_reauth`, setelah berhasil seluruh target platform itu yang berstatus `hold_reason = needs_reauth` dilepas penahanannya.

### `PUT /api/v1/connections/tiktok`

TikTok tidak memakai OAuth langsung, melainkan API key Buffer:

```json
{ "buffer_api_key": "…", "buffer_channel_id": "abc123" }
```

Server memvalidasi kunci (memanggil Buffer), menyimpan terenkripsi, dan mengembalikan objek `Connection`. **Galat:** `400 invalid_api_key`, `404 channel_not_found`, `409 channel_not_tiktok`.

### `GET /api/v1/connections/tiktok/channels`

Mengembalikan channel Buffer milik kunci yang tersimpan, agar pemilik memilih channel TikTok:

```json
{ "items": [ { "id": "abc123", "name": "TikTok Saya", "service": "tiktok" } ] }
```

Bila belum ada kunci, `409 connection_not_configured`. Alternatifnya, saat kunci baru diisi, antarmuka mengirim kunci dalam permintaan `PUT` lebih dulu tanpa `buffer_channel_id`; server menyimpan kunci dan mengembalikan daftar channel.

### `POST /api/v1/connections/{platform}/test`

Uji koneksi memanggil API platform dengan token tersimpan, sehingga **dikerjakan pekerja**. Server mengisi `test_requested_at` dan segera mengembalikan `202`:

```json
{ "requested_at": "2026-11-21T09:10:00Z" }
```

Hasilnya muncul pada `GET /connections` di bidang `last_test`:

```json
{ "at": "2026-11-21T09:10:20Z", "ok": true, "error": null }
```

Bila gagal: `{ "at": "...", "ok": false, "error": { "code": "...", "message": "..." } }`. Bila pekerja sedang mati, `last_test` tidak berubah dan antarmuka memberi tahu bahwa uji akan dijalankan saat pekerja aktif.

### `DELETE /api/v1/connections/{platform}`

Memutuskan koneksi dan menghapus token tersimpan. Target yang belum berstatus akhir pada platform itu ditahan dengan `hold_reason = needs_reauth`. Mengembalikan `204`.

## 9. Pengaturan

### Objek `Settings`

```json
{
  "timezone": "Asia/Jakarta",
  "grace_minutes": 120,
  "tiktok_window_days": 2,
  "buffer_queue_limit": 10,
  "retry_backoff_minutes": [1, 5, 15],
  "instagram_prepare_lead_minutes": 10,
  "min_lead_minutes": 15,
  "media_retention_days": 3,
  "event_retention_days": 180,
  "max_video_size_mb": 50,
  "storage_quota_mb": 1024,
  "egress_quota_mb": 5120,
  "quota_warn_percent": 80
}
```

### `GET /api/v1/settings`

Mengembalikan objek di atas.

### `PATCH /api/v1/settings`

Menerima sebagian bidang. Validasi:

| Bidang | Aturan |
|---|---|
| `grace_minutes` | Bilangan bulat 5 sampai 1.440 |
| `tiktok_window_days` | 1 sampai 14 |
| `buffer_queue_limit` | 1 sampai 100 |
| `retry_backoff_minutes` | 3 bilangan bulat naik, 1 sampai 120 |
| `instagram_prepare_lead_minutes` | 5 sampai 60 |
| `min_lead_minutes` | 5 sampai 120 |
| `media_retention_days` | 1 sampai 30 |
| `event_retention_days` | 30 sampai 730 |
| `max_video_size_mb` | Hanya baca; mengikuti batas paket Supabase (50) |
| `storage_quota_mb`, `egress_quota_mb` | Bilangan bulat positif; hanya untuk estimasi pemakaian |
| `quota_warn_percent` | 50 sampai 95 |
| `timezone` | Tidak dapat diubah pada versi ini |

Perubahan berlaku untuk pekerjaan berikutnya; target yang sudah terjadwal tidak dihitung ulang kecuali `tiktok_window_days` (jendela dievaluasi tiap putaran penjadwal). **Galat:** `422 validation_error`.

## 10. Status dan kesehatan

### `GET /api/v1/status`

Dipakai antarmuka untuk spanduk peringatan dan indikator kuota. Antarmuka juga dapat berlangganan Realtime pada `worker_heartbeats`; endpoint ini tetap menjadi sumber peringatan yang sudah dihitung.

```json
{
  "server_time": "2026-11-21T09:05:00Z",
  "worker": {
    "worker_id": "laptop-01",
    "last_tick_at": "2026-11-21T09:04:30Z",
    "seconds_since_tick": 30,
    "healthy": true
  },
  "usage": {
    "storage":      { "used_bytes_estimate": 230686720,  "quota_bytes": 1073741824, "percent": 21 },
    "egress_month": { "used_bytes_estimate": 2147483648, "quota_bytes": 5368709120, "percent": 40 }
  },
  "alerts": [
    {
      "id": "reauth_instagram",
      "severity": "error",
      "code": "connection_needs_reauth",
      "message": "Akun Instagram perlu disambung ulang. Posting Instagram ditahan.",
      "action": { "label": "Sambung ulang", "href": "/connections" }
    },
    {
      "id": "buffer_queue_near_limit",
      "severity": "warning",
      "code": "buffer_queue_near_limit",
      "message": "Antrean Buffer hampir penuh (9 dari 10).",
      "action": null
    }
  ],
  "counts": { "needs_attention": 1, "scheduled": 8, "published_today": 2 }
}
```

`worker.healthy` bernilai `false` bila `seconds_since_tick` lebih dari 180 atau tidak ada detak sama sekali. Nilai `usage` adalah **perkiraan** dari ukuran berkas (`v_usage_estimate`), bukan angka resmi Supabase.

`severity`: `error`, `warning`, atau `info`. Jenis peringatan dan prioritas tampilannya ada di `ui-ux-design.md` bagian 7.

Kode `alerts[].code` yang mungkin (urut prioritas tampilan): `worker_offline`, `connection_needs_reauth`, `target_failed`, `target_missed`, `buffer_queue_near_limit`, `instagram_limit_low`, `storage_usage_high`, `media_missing`. Setiap peringatan memuat `id` unik (misalnya `reauth_instagram`) agar antarmuka dapat menandai yang sudah ditutup, untuk jenis yang boleh ditutup.

### `GET /healthz`

Tanpa login, untuk pemeriksaan otomatis. Memeriksa bahwa aplikasi web hidup dan dapat menjangkau database:

```json
{ "status": "ok", "database": "ok" }
```

Mengembalikan `200` bila sehat, `503` bila database tidak terjangkau. Status pekerja **tidak** dicakup di sini, karena pekerja adalah komponen terpisah; lihat `GET /api/v1/status`.

## 11. Rute halaman (HTML)

Halaman dibangun di sisi server dan memakai API di atas untuk pembaruan.

| Rute | Halaman |
|---|---|
| `/login` | Masuk (satu-satunya halaman tanpa sesi selain pengalihan OAuth) |
| `/` | Antrean (beranda) |
| `/new` | Video baru. Menerima `?slot_key=` untuk mengisi slot tertentu |
| `/posts/{id}` | Detail entri |
| `/settings` | Pengaturan |
| `/connections` | Koneksi akun |
| `/api/oauth/{platform}/callback` | Tujuan balik OAuth (dialihkan) |

## 12. Kode galat

| HTTP | `code` | Arti |
|---|---|---|
| 400 | `validation_error` | Isian tidak valid; `details` memuat bidang yang salah |
| 400 | `unsupported_file_type` | Jenis berkas tidak didukung |
| 400 | `file_unreadable` | Berkas rusak atau tidak dapat dibaca |
| 400 | `invalid_api_key` | API key Buffer ditolak |
| 401 | `unauthenticated` | Belum masuk atau sesi berakhir |
| 403 | `origin_not_allowed` | Header `Origin` tidak diizinkan |
| 404 | `post_not_found` | Entri tidak ada |
| 404 | `upload_not_found` | Unggahan sementara tidak ada atau kedaluwarsa |
| 404 | `media_not_available` | Berkas lokal sudah dibersihkan |
| 404 | `channel_not_found` | Channel Buffer tidak ditemukan |
| 409 | `slot_taken` | Slot sudah terisi |
| 409 | `upload_not_ready` | Objek unggahan belum ada di Storage atau ukurannya tidak cocok |
| 409 | `upload_in_use` | Unggahan sudah dipakai sebuah entri |
| 409 | `pending_action_exists` | Sudah ada tindakan yang menunggu pekerja untuk target ini |
| 409 | `post_locked` | Perubahan tidak mungkin lagi di sebagian platform |
| 409 | `not_retryable` | Target tidak berstatus `failed` atau `missed` |
| 409 | `due_passed` | Waktu terbit sudah lewat |
| 409 | `manual_check_required` | Perlu konfirmasi pemilik sebelum dicoba ulang |
| 409 | `connection_needs_reauth` | Akun perlu disambung ulang |
| 409 | `connection_not_configured` | Koneksi belum diatur |
| 409 | `channel_not_tiktok` | Channel Buffer yang dipilih bukan TikTok |
| 413 | `file_too_large` | Berkas melebihi batas (video 50 MB, thumbnail 8 MB) |
| 422 | `caption_too_long` | Caption atau judul melebihi batas platform |
| 422 | `due_in_past` | Jam terbit sudah lewat |
| 422 | `due_too_soon` | Jam terbit kurang dari `min_lead_minutes` dari sekarang |
| 500 | `internal_error` | Galat tak terduga; rincian ada di log |

## 13. Hal yang dipastikan pada percobaan kecil

Beberapa perilaku di atas bergantung pada kemampuan platform dan layanan yang belum terbukti:

| # | Pertanyaan | Dampak pada spesifikasi ini |
|---|---|---|
| 1 | Apakah API Buffer dapat menyunting atau menghapus posting terjadwal? | Menentukan aturan ubah dan batalkan untuk TikTok (bagian 5.5 dan 5.6) |
| 2 | Batas panjang caption TikTok dan Buffer, serta batas hashtag Instagram | Mengisi angka pada galat `caption_too_long` |
| 3 | Batas antrean gratis Buffer | Nilai awal `buffer_queue_limit` dan peringatan `buffer_queue_near_limit` |
| 4 | Apakah Buffer berhasil mengambil video dari tautan bertanda tangan Supabase | Bentuk pengiriman TikTok; cadangan: bucket publik dengan nama acak |
| 5 | Apakah unggahan langsung (bertahap) ke Storage berjalan baik dengan URL bertanda tangan dari Vercel | Bentuk `upload.method` pada bagian 4.2 |
| 6 | Perkiraan egress per entri dibandingkan kuota 5 GB | Ambang `storage_usage_high` dan kebutuhan kompresi |
