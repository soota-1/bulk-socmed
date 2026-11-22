# Penjadwal Video Pendek (bulk-socmed) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun fondasi sistem penjadwal video pendek terpusat (monorepo pnpm, skema database Supabase PostgreSQL dengan RLS dan fungsi atomik, paket logika bersama `@bulk-socmed/shared`, serta kerangka aplikasi Next.js dan Worker Node.js).

**Architecture:** Tiga pilar independen yang berkomunikasi secara eksklusif lewat database Supabase. Browser mengunggah langsung ke Supabase Storage via signed URL untuk melewati batasan request body Vercel (4.5 MB). Worker lokal di laptop mengklaim pekerjaan secara atomik dengan `claim_targets` (`FOR UPDATE SKIP LOCKED` + lease 15 menit), sedangkan Next.js di Vercel menangani sesi, validasi, dan rendering UI reaktif berbasis Supabase Realtime.

**Tech Stack:** TypeScript, Node.js 20+, pnpm workspaces, Next.js 15+ (App Router), Supabase (PostgreSQL 15+, Auth, Storage, Realtime), Vitest, Zod, date-fns / date-fns-tz.

**Spec:** `docs/prd.md`, `docs/system-design.md`, `docs/database-design.md`, `docs/api-specification.md`, `docs/ui-ux-design.md`.

---

## Global Constraints

- **Biaya Rp0**: Tidak menggunakan layanan berbayar; arsitektur harus mematuhi batasan Supabase Free (Storage 1 GB, max file 50 MB, egress 5 GB/bln) dan Vercel Hobby.
- **Zona Waktu**: Semua kalkulasi slot dan antarmuka mengacu pada WIB (`Asia/Jakarta`, UTC+7). Seluruh penyimpanan waktu di database menggunakan `timestamptz` (UTC).
- **Zero Duplicate Posts**: Setiap target wajib memiliki `idempotency_key` unik (`<post_id>:<platform>:v1`) dan tidak boleh diposting ulang tanpa konfirmasi manual rekonsiliasi.
- **Isolasi Rahasia**: Token OAuth dan API key Buffer hanya disimpan terenkripsi AES-256-GCM di tabel `connection_secrets`. Tabel ini TIDAK memiliki RLS policy untuk pengguna umum dan hanya bisa diakses oleh `service_role`.
- **Bahasa Pesan**: Pesan galat yang dikembalikan ke pengguna harus berbahasa Indonesia yang jelas dan dapat ditindaklanjuti.

---

## Review Focus

1. **Perebutan Slot Bersamaan (*Race Condition Slot*)**: Dua entri berbeda memilih slot yang sama secara simultan. Harus dijamin oleh indeks unik `ux_posts_slot_key` dan menghasilkan galat terstruktur `slot_taken`.
2. **Kalkulasi Slot Kosong Berikutnya (*Next Free Slot*)**: Menghitung slot kosong berikutnya dengan mempertimbangkan `min_lead_minutes` (15 menit dari sekarang) dan slot yang sudah terisi.
3. **Penyusupan Akses Rahasia (*Security Leakage*)**: Memastikan kueri pengguna terautentikasi ke tabel `connection_secrets` atau via GraphQL/REST Supabase selalu ditolak 100% tanpa celah.
4. **Validasi File Terlalu Besar (> 50 MB)**: Penolakan langsung di sisi klien dan API sebelum proses upload berlangsung.
5. **Penanganan Transaksi Pembuatan Post Atomik**: `create_post_tx` harus membuat post, 3 target platform, dan menandai uploads `consumed` dalam satu transaksi yang rollback total jika salah satu gagal.

---

## User Review Required

> [!IMPORTANT]
> Proyek ini memerlukan kredensial Supabase (URL, Anon Key, dan Service Role Key) serta kunci enkripsi 32-byte (`TOKEN_ENC_KEY`) di file `.env`. Pemilik perlu menyiapkan proyek gratis di Supabase dashboard.

---

## Proposed Changes & Tasks

### Task 1: Inisialisasi Repositori Git & Monorepo pnpm

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.env.example`

**Interfaces:**
- Menghubungkan paket `packages/shared`, `apps/web`, dan `apps/worker` dalam satu workspace monorepo.

- [ ] **Step 1: Inisialisasi Git repository**
  Run: `git init`

- [ ] **Step 2: Buat berkas `.gitignore`**
  Menyaring `node_modules`, `.next`, `dist`, `data/cache`, `data/logs`, `data/backups`, `.env`, dan `.env.local`.

- [ ] **Step 3: Buat root `package.json` dan `pnpm-workspace.yaml`**
  Konfigurasi workspace monorepo dengan pnpm scripts: `build`, `test`, `dev`, `lint`.

- [ ] **Step 4: Buat `tsconfig.base.json`**
  Konfigurasi TypeScript `strict: true`, target `ES2022`, module resolution `bundler` atau `NodeNext`.

- [ ] **Step 5: Buat `.env.example`**
  Mendokumentasikan semua variabel lingkungan yang dibutuhkan Vercel dan Worker:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENC_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `META_APP_ID`, `META_APP_SECRET`.

- [ ] **Step 6: Verifikasi & Commit**
  Run: `git add . && git commit -m "chore: initialize git and pnpm monorepo workspace"`

---

### Task 2: Pembangunan Paket Bersama `@bulk-socmed/shared`

Paket ini menampung tipe domain, skema validasi Zod, kalkulator slot WIB, dan fungsi murni `plan()` untuk tiap platform.

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/constants.ts`
- Create: `packages/shared/src/slots.ts`
- Create: `packages/shared/src/validation.ts`
- Create: `packages/shared/src/planner.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/test/slots.test.ts`
- Test: `packages/shared/test/planner.test.ts`
- Test: `packages/shared/test/validation.test.ts`

**Interfaces:**
- Produces:
  - `nextFreeSlot(nowWib: Date, slotTimes: string[], occupied: Set<string>, minLeadMin: number): { candidate: Date, key: string }`
  - `planTargets(dueAt: Date, now: Date, options?: PlannerOptions): PlannedTarget[]`
  - Skema Zod: `PostCreateSchema`, `PostUpdateSchema`, `UploadRequestSchema`, `SettingsSchema`

- [ ] **Step 1: Write failing tests untuk `nextFreeSlot`**
  Uji skenario: slot hari ini yang tersisa, slot yang terlewati batas `minLeadMin` (15m), slot yang sudah occupied, dan lompat ke hari berikutnya.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @bulk-socmed/shared test` (Expected: FAIL)
- [ ] **Step 3: Implementasi `slots.ts`**
  Implementasikan logika konversi zona waktu WIB (`Asia/Jakarta`) dan pencarian kandidat slot kosong pertama yang valid.
- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @bulk-socmed/shared test` (Expected: PASS)
- [ ] **Step 5: Write failing tests & implement `planner.ts`**
  Implementasikan aturan `planTargets`:
  - YouTube: `dispatch_at = now` (segera setelah save).
  - Instagram: `dispatch_at = due_at - 10 menit`.
  - TikTok: `dispatch_at = min(now, due_at - 2 hari)` bila dalam jendela pengiriman.
- [ ] **Step 6: Write failing tests & implement `validation.ts`**
  Validasi Zod: ukuran video $\le$ 50 MB, thumbnail $\le$ 8 MB, judul $\le$ 100 karakter, caption tidak kosong.
- [ ] **Step 7: Verifikasi & Commit**
  Run: `pnpm --filter @bulk-socmed/shared test && git commit -m "feat(shared): add types, slots calculator, validation schemas, and platform planners"`

---

### Task 3: Skema Database Supabase, Migrasi DDL, RLS, & Fungsi Database

Menyusun skema lengkap sesuai `database-design.md` bagian 4 s.d. 9.

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/20261122000000_init_schema.sql`
- Create: `supabase/seed.sql`
- Test: `packages/shared/test/db_schema.test.ts` (Validasi sintaks SQL dan skema types)

**Interfaces:**
- Menghasilkan tabel `settings`, `slots`, `connections`, `connection_secrets`, `posts`, `targets`, `target_events`, `uploads`, `api_limits`, `worker_heartbeats`.
- Menghasilkan fungsi `claim_targets`, `create_post_tx`, `update_post_tx`, `cancel_post_tx`, `request_target_retry`, `purge_expired`.
- Menghasilkan view `v_post_overview`, `v_usage_estimate`.
- Menghasilkan konfigurasi Storage bucket `videos` (50MB) dan `thumbnails` (8MB).

- [ ] **Step 1: Tulis migrasi DDL lengkap `20261122000000_init_schema.sql`**
  - Buat helper trigger `set_updated_at()`.
  - Buat tabel konfigurasi: `settings`, `slots` (dengan unique key `owner_id, local_time`).
  - Buat tabel koneksi: `connections` dan `connection_secrets` (revoked from anon & authenticated).
  - Buat tabel posting: `posts` (dengan indeks unik `ux_posts_slot_key`), `targets`, `target_events`, `uploads`, `api_limits`, `worker_heartbeats`.
  - Pasang RLS policies di semua tabel dengan `owner_id = auth.uid()`.
  - Buat fungsi database atomik `claim_targets` (service_role only, `FOR UPDATE SKIP LOCKED`).
  - Buat fungsi database `create_post_tx` (SECURITY DEFINER).
  - Buat views `v_post_overview` dan `v_usage_estimate` dengan `security_invoker = true`.
  - Inisialisasi bucket Storage `videos` dan `thumbnails` dengan policy owner.
- [ ] **Step 2: Tulis berkas `supabase/seed.sql`**
  Menyediakan slot default `06:00`, `12:00`, `16:00`, `19:00` dan default settings JSON.
- [ ] **Step 3: Verifikasi sintaks DDL & Commit**
  Run: `git add supabase && git commit -m "feat(supabase): create complete database schema, rls policies, and atomic functions"`

---

### Task 4: Kerangka Worker Penjadwal (`apps/worker`)

Membangun modul inti worker di laptop yang berjalan secara daemon, memancarkan detak berkala, dan mengeksekusi klaim tugas atomik.

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/config.ts`
- Create: `apps/worker/src/supabase.ts`
- Create: `apps/worker/src/crypto.ts`
- Create: `apps/worker/src/heartbeat.ts`
- Create: `apps/worker/src/scheduler.ts`
- Create: `apps/worker/src/main.ts`
- Test: `apps/worker/test/crypto.test.ts`
- Test: `apps/worker/test/scheduler.test.ts`

**Interfaces:**
- `encryptToken(plain: string, key: Buffer): Buffer` & `decryptToken(cipher: Buffer, key: Buffer): string` (AES-256-GCM).
- `sendHeartbeat(supabase: SupabaseClient, workerId: string, ownerId: string): Promise<void>`
- `runSchedulerCycle(ctx: WorkerContext): Promise<CycleSummary>`

- [ ] **Step 1: Write failing test untuk AES-256-GCM enkripsi token**
  Uji encrypt/decrypt token OAuth dan API key roundtrip dengan tag autentikasi.
- [ ] **Step 2: Implementasi `crypto.ts`**
  Menggunakan `crypto.createCipheriv('aes-256-gcm', ...)` dengan IV 12-byte dan auth tag 16-byte.
- [ ] **Step 3: Run test to verify crypto passes**
  Run: `pnpm --filter worker test`
- [ ] **Step 4: Implementasi `heartbeat.ts` & loop `scheduler.ts`**
  - Pemanggilan fungsi database `claim_targets`.
  - Evaluasi kebijakan `missed` jika `now - due_at > grace_minutes`.
  - Dispatching ke modul publisher berdasarkan `target.platform`.
- [ ] **Step 5: Verifikasi & Commit**
  Run: `git add apps/worker && git commit -m "feat(worker): setup worker core daemon, heartbeat, crypto, and claim scheduler"`

---

### Task 5: Kerangka Aplikasi Web Next.js (`apps/web`)

Membangun aplikasi Next.js (App Router) dengan Tailwind CSS, autentikasi Supabase, dan Route Handlers API internal (`/api/v1/*`).

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/middleware.ts`
- Create: `apps/web/src/lib/supabase/client.ts`
- Create: `apps/web/src/lib/supabase/server.ts`
- Create: `apps/web/src/app/api/v1/uploads/route.ts`
- Create: `apps/web/src/app/api/v1/posts/route.ts`
- Create: `apps/web/src/app/api/v1/slots/route.ts`
- Create: `apps/web/src/app/api/v1/status/route.ts`
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/src/app/page.tsx` (Queue Page)
- Create: `apps/web/src/app/new/page.tsx` (New Post Form)

**Interfaces:**
- Route Handlers mengembalikan error standar JSON: `{ error: { code, message, details } }`.
- Integrasi direct client-side upload ke Supabase Storage.
- Menerapkan fitur UI/UX yang disetujui:
  - Tombol **"Simpan & tambah lagi"** (S1).
  - Auto-fill hashtag posting sebelumnya (S2).
  - Keyboard shortcuts `N`, `Ctrl+Enter`, `Esc` (S3).

- [ ] **Step 1: Setup Next.js App Router & Supabase Auth SSR Client**
  Konfigurasi middleware proteksi sesi cookie (`SameSite=Lax`, `HttpOnly`).
- [ ] **Step 2: Implementasi API `POST /api/v1/uploads`**
  Membuat signed upload URL ke Supabase Storage (validasi $\le$ 50 MB untuk video).
- [ ] **Step 3: Implementasi API `POST /api/v1/posts` & `GET /api/v1/posts`**
  Memanggil fungsi database `create_post_tx` secara atomik.
- [ ] **Step 4: Implementasi Halaman Login, Queue (Antrean), dan Form Video Baru**
  Menerapkan sketsa wireframe dari `ui-ux-design.md`, termasuk spanduk `worker_offline` dan chip status per platform.
- [ ] **Step 5: Verifikasi Build & Commit**
  Run: `pnpm --filter web build && git commit -m "feat(web): setup next.js web app, auth middleware, api routes, and primary ui pages"`

---

## Verification Plan

### Automated Tests
1. **Paket Bersama (`packages/shared`)**:
   `pnpm --filter @bulk-socmed/shared test` (Validasi unit test slot calculator WIB, Zod schemas, dan target planner).
2. **Worker Crypto & Scheduler (`apps/worker`)**:
   `pnpm --filter worker test` (Validasi enkripsi token AES-256-GCM, loop klaim, dan mock scheduler).
3. **Web Build (`apps/web`)**:
   `pnpm --filter web build` (Validasi tipe TypeScript, kompilasi halaman Next.js, dan Route Handlers).

### Manual Verification
1. Verifikasi integrasi pnpm monorepo: `pnpm install` dan build semua paket.
2. Verifikasi berkas migrasi database Supabase terhadap aturan RLS dan transaksi fungsi `create_post_tx`.
3. Verifikasi flow unggah langsung: browser meminta signed URL -> upload ke Storage -> verifikasi objek ada sebelum post disimpan.
