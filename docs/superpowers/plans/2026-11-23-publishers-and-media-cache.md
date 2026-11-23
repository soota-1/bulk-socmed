# Modul Penerbit Sosial Media & Media Cache (Fase 2) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun modul media cache lokal dan tiga penerbit sosial media (YouTube Shorts, Instagram Reels, TikTok via Buffer) dengan arsitektur *step-based state machine*, pencegahan posting ganda, penanganan galat, serta integrasi penuh ke mesin penjadwal worker.

**Architecture:** Modul penerbit (`apps/worker/src/publishers/`) mengimplementasikan antarmuka `Publisher` dengan eksekusi per langkah (*advance*), rekonsiliasi (*reconcile*), pembatalan (*cancel*), dan sinkronisasi perubahan (*applyChanges*). API eksternal diabstraksikan lewat adapter klien sehingga setiap skenario keberhasilan, kegagalan jaringan, dan pemulihan crash dapat diuji 100% via unit test Vitest. Media cache lokal (`apps/worker/src/media-cache.ts`) mengunduh berkas sekali dari Supabase Storage untuk dipakai bersama oleh YouTube dan Instagram guna menghemat kuota egress 5 GB.

**Tech Stack:** TypeScript, Node.js 20+, Supabase Storage API, date-fns, Vitest, Zod, crypto.

**Spec:** `docs/prd.md`, `docs/system-design.md` (bagian 3.4, 5, 6, 7, 10), `docs/database-design.md` (bagian 6, 7), `docs/api-specification.md`.

---

## Global Constraints

- **Zero Duplicate Posts**:
  - Instagram: `step = publish_requested` dicatat ke database sebelum pemanggilan API `media_publish`. Pemulihan dari crash pada langkah ini wajib melakukan rekonsiliasi ke feed Instagram dan TIDAK memanggil `media_publish` ulang secara buta.
  - YouTube: Jika `external_id` (video ID) sudah ada, proses upload tidak diulang.
  - Buffer: Jika `external_id` sudah ada, pembuatan post tidak diulang.
- **Egress & Storage Free-Tier**: Berkas video dan thumbnail diunduh 1 kali ke folder lokal `data/cache/<post_id>/` dan dipakai bersama oleh YouTube dan Instagram. Folder cache dibersihkan setelah semua target mencapai status terminal.
- **Isolasi API**: Pemanggilan HTTP platform dibungkus dalam adapter client yang dapat di-mock untuk testing tanpa memanggil internet publik.
- **Bahasa Pesan**: Pesan galat `last_error_message` harus berbahasa Indonesia yang jelas dan mudah dipahami pemilik.

---

## Review Focus

1. **Crash Recovery Instagram pada `publish_requested`**: Worker crash sesaat sebelum respon `media_publish` diterima. Reconcile harus memverifikasi feed akun dan menandai `published` jika cocok, atau `failed` dengan flag `manual_check_required` jika tidak jelas.
2. **Urutan Thumbnail YouTube Shorts**: Pemasangan thumbnail hanya boleh dipanggil setelah pemrosesan video berstatus `succeeded`.
3. **Masa Berlaku Signed URL Buffer TikTok**: URL bertanda tangan Supabase Storage yang dikirim ke Buffer harus memiliki masa berlaku minimal sampai `due_at + 6 jam`.
4. **Pembersihan Cache Media**: Berkas cache lokal `data/cache/<post_id>/` harus dibersihkan secara aman saat post selesai atau dibatalkan tanpa menghapus data aktif lainnya.
5. **Penanganan Token Expired / Butuh Reauth**: Galat otorisasi (token dicabut/kedaluwarsa) harus menandai target dengan `hold_reason = 'needs_reauth'` dan TIDAK menghabiskan kuota percobaan ulang (*retry count*).

---

## Proposed Changes & Tasks

### Task 1: Media Cache Manager (`apps/worker/src/media-cache.ts`)

Mengelola pengunduhan media dari Supabase Storage ke disk lokal dan pembersihannya.

**Files:**
- Create: `apps/worker/src/media-cache.ts`
- Create: `apps/worker/test/media-cache.test.ts`

**Interfaces:**
- Produces:
  - `ensureMediaCache(supabase: SupabaseClient, postId: number, videoPath: string, thumbPath?: string | null, cacheDir?: string): Promise<{ videoFilePath: string; thumbFilePath?: string }>`
  - `cleanMediaCache(postId: number, cacheDir?: string): Promise<void>`

- [ ] **Step 1: Write failing test untuk Media Cache**
  Uji skenario: download video & thumbnail, simpan ke cache folder, deteksi cache yang sudah ada (tidak download ulang), dan pembersihan folder.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter worker test test/media-cache.test.ts`
- [ ] **Step 3: Implementasi `media-cache.ts`**
  Gunakan `supabase.storage.from(bucket).download(path)` dan `fs/promises` (`mkdir`, `writeFile`, `rm`).
- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter worker test test/media-cache.test.ts`
- [ ] **Step 5: Commit**
  Run: `git add apps/worker/src/media-cache.ts apps/worker/test/media-cache.test.ts && git commit -m "feat(worker): implement local media cache manager"`

---

### Task 2: Publisher Core & Abstraksi Base (`apps/worker/src/publishers/base.ts`)

Mendefinisikan antarmuka `Publisher`, konteks langkah (`StepContext`), hasil langkah (`StepResult`), dan tipe rekonsiliasi.

**Files:**
- Create: `apps/worker/src/publishers/base.ts`
- Create: `apps/worker/test/publishers-base.test.ts`

**Interfaces:**
- Produces:
  - `interface StepContext`: `{ target, post, now, accessToken?, apiKey?, mediaCache, supabase }`
  - `interface StepResult`: `{ nextStatus, nextStep, runAt?, delayMinutes?, externalId?, externalState?, error? }`
  - `interface ReconcileResult`: `{ resolvedStatus, externalId?, notes }`
  - `interface Publisher`: `platform, advance(ctx), reconcile(ctx), applyChanges(ctx), cancel(ctx)`

- [ ] **Step 1: Write test untuk base types & step result transitions**
- [ ] **Step 2: Implementasi `publishers/base.ts`**
- [ ] **Step 3: Run test to verify passes**
- [ ] **Step 4: Commit**
  Run: `git add apps/worker/src/publishers/base.ts apps/worker/test/publishers-base.test.ts && git commit -m "feat(worker): define publisher base interfaces and context types"`

---

### Task 3: YouTube Shorts Publisher (`apps/worker/src/publishers/youtube.ts`)

Menerapkan state machine penerbitan YouTube Shorts: `fetch_media` $\rightarrow$ `upload` $\rightarrow$ `wait_processing` $\rightarrow$ `set_thumbnail` $\rightarrow$ `await_publish`.

**Files:**
- Create: `apps/worker/src/publishers/youtube.ts`
- Create: `apps/worker/test/publishers-youtube.test.ts`

**Interfaces:**
- Produces:
  - `class YouTubePublisher implements Publisher`
  - `interface YouTubeApiClient`: `uploadVideo(opts), checkProcessing(videoId), setThumbnail(videoId, imagePath), updateVideo(videoId, meta), deleteVideo(videoId)`

- [ ] **Step 1: Write failing tests untuk alur YouTube Shorts**
  Uji: upload privat dengan `publishAt`, tunggu status processing selesai, pasang thumbnail setelah processing, cek status setelah due_at, pembatalan `deleteVideo`.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter worker test test/publishers-youtube.test.ts`
- [ ] **Step 3: Implementasi `publishers/youtube.ts`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**
  Run: `git add apps/worker/src/publishers/youtube.ts apps/worker/test/publishers-youtube.test.ts && git commit -m "feat(worker): implement YouTube Shorts publisher state machine"`

---

### Task 4: Instagram Reels Publisher (`apps/worker/src/publishers/instagram.ts`)

Menerapkan state machine penerbitan Instagram Reels: `check_limit` $\rightarrow$ `fetch_media` $\rightarrow$ `cover_prepare` $\rightarrow$ `create_container` $\rightarrow$ `upload_video` $\rightarrow$ `wait_finished` $\rightarrow$ `publish_requested` $\rightarrow$ `done`, serta rekonsiliasi anti-posting-ganda.

**Files:**
- Create: `apps/worker/src/publishers/instagram.ts`
- Create: `apps/worker/test/publishers-instagram.test.ts`

**Interfaces:**
- Produces:
  - `class InstagramPublisher implements Publisher`
  - `interface InstagramApiClient`: `checkPublishingLimit(userId), createContainer(userId, opts), uploadMedia(uploadUrl, filePath), checkContainerStatus(containerId), publishMedia(userId, containerId), getRecentMedia(userId)`

- [ ] **Step 1: Write failing tests untuk alur Instagram Reels**
  Uji: pembuatan kontainer Reels, upload video, polling sampai FINISHED, penanda `publish_requested` sebelum publish, rekonsiliasi feed saat crash recovery.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter worker test test/publishers-instagram.test.ts`
- [ ] **Step 3: Implementasi `publishers/instagram.ts`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**
  Run: `git add apps/worker/src/publishers/instagram.ts apps/worker/test/publishers-instagram.test.ts && git commit -m "feat(worker): implement Instagram Reels publisher with double-post prevention"`

---

### Task 5: TikTok via Buffer Publisher (`apps/worker/src/publishers/tiktok-buffer.ts`)

Menerapkan state machine TikTok lewat API Buffer: `window_check` $\rightarrow$ `sign_url` $\rightarrow$ `create_post` $\rightarrow$ `await_publish`.

**Files:**
- Create: `apps/worker/src/publishers/tiktok-buffer.ts`
- Create: `apps/worker/test/publishers-tiktok-buffer.test.ts`

**Interfaces:**
- Produces:
  - `class TikTokBufferPublisher implements Publisher`
  - `interface BufferApiClient`: `createPost(opts), getPostStatus(postId)`

- [ ] **Step 1: Write failing tests untuk alur TikTok Buffer**
  Uji: verifikasi jendela bergulir, pembuatan signed URL Supabase berlaku sampai due_at + 6h, mutasi createPost, pemeriksaan status `sent` / `error`.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter worker test test/publishers-tiktok-buffer.test.ts`
- [ ] **Step 3: Implementasi `publishers/tiktok-buffer.ts`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**
  Run: `git add apps/worker/src/publishers/tiktok-buffer.ts apps/worker/test/publishers-tiktok-buffer.test.ts && git commit -m "feat(worker): implement TikTok via Buffer publisher"`

---

### Task 6: Integrasi Publisher ke Mesin Penjadwal (`apps/worker/src/scheduler.ts`)

Menghubungkan target yang diklaim ke modul publisher, mengelola dekripsi token, mengeksekusi `advance()` dan `pending_action`, serta mencatat riwayat kejadian (`target_events`).

**Files:**
- Modify: `apps/worker/src/scheduler.ts`
- Modify: `apps/worker/test/scheduler.test.ts`

**Interfaces:**
- Consumes: `YouTubePublisher`, `InstagramPublisher`, `TikTokBufferPublisher`, `decryptToken`, `ensureMediaCache`, `cleanMediaCache`
- Produces:
  - `executeTargetStep(supabase, config, target, post, now, publishers)`: Menjalankan 1 langkah dan mengupdate target di Supabase.

- [ ] **Step 1: Write test untuk eksekusi target step lengkap dengan mock publisher**
- [ ] **Step 2: Update `scheduler.ts`**
- [ ] **Step 3: Run all worker tests to verify GREEN**
  Run: `pnpm --filter worker test`
- [ ] **Step 4: Commit**
  Run: `git add apps/worker/src/scheduler.ts apps/worker/test/scheduler.test.ts && git commit -m "feat(worker): integrate publishers into scheduler cycle"`

---

## Verification Plan

### Automated Tests
1. **Unit Tests Media Cache**: `pnpm --filter worker test test/media-cache.test.ts`
2. **Unit Tests YouTube Publisher**: `pnpm --filter worker test test/publishers-youtube.test.ts`
3. **Unit Tests Instagram Publisher**: `pnpm --filter worker test test/publishers-instagram.test.ts`
4. **Unit Tests TikTok Buffer Publisher**: `pnpm --filter worker test test/publishers-tiktok-buffer.test.ts`
5. **Full Workspace Test Suite**: `pnpm -r test` (Memastikan semua paket `shared` dan `worker` lulus tanpa regresi).

### Manual Verification
1. Verifikasi alur idempoten Instagram jika disimulasikan crash pada status `publish_requested`.
2. Verifikasi perhitungan masa berlaku signed URL untuk Buffer TikTok ($\ge$ 6 jam pasca `due_at`).
3. Verifikasi pembersihan folder cache `data/cache/<post_id>/`.
