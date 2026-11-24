# Database Design: Penjadwal Video Pendek

| | |
|---|---|
| Versi | 2.0 (Supabase Postgres, menggantikan SQLite) |
| Tanggal | 21 November 2026 |
| Mesin | Supabase (Postgres 15+), Auth, Storage, Realtime |
| Dokumen terkait | `prd.md`, `system-design.md`, `api-specification.md` |

Dokumen ini mendefinisikan skema data, aturan akses, fungsi database, dan kueri penting. Alur dan komponen ada di `system-design.md`.

---

## 1. Prinsip

1. **Database adalah satu-satunya jalur antara antarmuka (Vercel) dan pekerja (laptop).** Niat pemilik dicatat sebagai data (`pending_action`), dan pekerja membacanya.
2. **Satu entri video (`posts`), tiga target (`targets`).** Satu target per platform. Status dan kesalahan dicatat per target.
3. **Waktu memakai `timestamptz`** (disimpan UTC). Konversi ke WIB hanya saat ditampilkan atau saat menghitung slot.
4. **Rahasia tidak pernah terbaca pengguna.** Token dan API key ada di tabel terpisah yang tidak punya kebijakan akses untuk pengguna.
5. **Pembatasan di database, bukan hanya di kode.** Status valid, slot tidak ganda, target tidak ganda, dan kepemilikan baris dijaga lewat `CHECK`, indeks unik, dan RLS.
6. **Penulisan penting lewat fungsi database.** Pengguna yang login hanya dapat **membaca** `posts`, `targets`, dan tabel turunan; perubahan dilakukan lewat fungsi `SECURITY DEFINER` yang memeriksa `auth.uid()`. Ini mencegah browser mengubah status secara langsung.
7. **Kerangka multi-pengguna sudah ada.** Setiap tabel bermilik memiliki `owner_id` dan RLS, walau saat ini hanya ada satu pemilik.

## 2. Diagram hubungan

```
auth.users 1───* connections 1───1 connection_secrets
    │                 │
    │                 └───────* targets *───────1 posts
    │                                │             │
    ├──* slots                       │             └───* uploads (consumed_post_id)
    ├──* settings                    └───* target_events
    ├──* api_limits
    └──* worker_heartbeats

Storage: bucket videos, thumbnails  (jalur: <owner_id>/<upload_id>/<berkas>)
```

## 3. Konvensi

| Hal | Aturan |
|---|---|
| Skema | `public` |
| Primary key | `bigint generated always as identity` (agar mudah dibaca di antarmuka); `uploads.id` memakai `uuid` |
| `owner_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |
| Enumerasi | `text` dengan `CHECK` (lebih mudah diubah daripada tipe enum) |
| `updated_at` | Dijaga pemicu `set_updated_at()` |
| Pekerja | Memakai `service_role` (melewati RLS); tidak bergantung pada kebijakan pengguna |

## 4. Skema (DDL)

Berkas `supabase/migrations/0001_init.sql`.

### 4.1 Fungsi bantu

```sql
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
```

### 4.2 Pengaturan dan slot

```sql
create table public.settings (
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (owner_id, key)
);

create table public.slots (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_time  time not null,                       -- jam WIB, mis. 06:00
  is_active   boolean not null default true,
  unique (owner_id, local_time)
);
```

Nilai awal slot: `06:00`, `12:00`, `16:00`, `19:00`.

### 4.3 Koneksi akun

```sql
create table public.connections (
  id                   bigint generated always as identity primary key,
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform             text not null check (platform in ('youtube', 'instagram', 'tiktok')),
  provider             text not null check (provider in ('youtube_api', 'instagram_graph', 'buffer')),
  display_name         text,
  external_account_id  text,        -- channelId YouTube / ID akun IG / channelId TikTok di Buffer
  status               text not null default 'active'
                       check (status in ('active', 'needs_reauth', 'disabled')),
  token_expires_at     timestamptz,
  details              jsonb not null default '{}',    -- cache non-rahasia (batas posting, antrean Buffer)
  test_requested_at    timestamptz,
  last_test            jsonb,                          -- {"at": "...", "ok": true, "error": null}
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Satu koneksi aktif per platform per pemilik
create unique index ux_connections_owner_platform
  on public.connections (owner_id, platform) where status <> 'disabled';

create trigger trg_connections_updated before update on public.connections
  for each row execute function public.set_updated_at();
```

### 4.4 Rahasia koneksi (tanpa akses pengguna)

```sql
create table public.connection_secrets (
  connection_id      bigint primary key references public.connections (id) on delete cascade,
  access_token_enc   bytea,           -- AES-256-GCM
  refresh_token_enc  bytea,
  api_key_enc        bytea,           -- API key Buffer
  key_version        int not null default 1,
  updated_at         timestamptz not null default now()
);

alter table public.connection_secrets enable row level security;
-- Sengaja TANPA kebijakan: hanya service_role yang dapat membaca atau menulis.
revoke all on public.connection_secrets from anon, authenticated;
```

### 4.5 Entri video

```sql
create table public.posts (
  id                      bigint generated always as identity primary key,
  owner_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title                   text check (char_length(title) <= 100),
  caption                 text not null,
  hashtags                text not null default '',

  video_object_path       text not null,           -- jalur di bucket 'videos'
  video_size_bytes        bigint,
  video_duration_ms       integer,
  video_width             integer,
  video_height            integer,
  thumbnail_object_path   text,                    -- jalur di bucket 'thumbnails' (opsional)

  due_at                  timestamptz not null,    -- waktu tayang publik
  slot_key                text,                    -- 'YYYY-MM-DD@HH:MM' (WIB); NULL bila jam ditimpa
  is_time_overridden      boolean not null default false,

  state                   text not null default 'active'
                          check (state in ('draft', 'active', 'cancelled')),
  media_deleted_at        timestamptz,             -- berkas di Storage dan cache sudah dibersihkan

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  cancelled_at            timestamptz
);

-- Satu entri aktif per slot; slot kosong lagi bila entri dibatalkan atau jamnya ditimpa
create unique index ux_posts_slot_key
  on public.posts (owner_id, slot_key)
  where state = 'active' and slot_key is not null;

create index ix_posts_owner_due on public.posts (owner_id, due_at);

create trigger trg_posts_updated before update on public.posts
  for each row execute function public.set_updated_at();
```

`slot_key` sengaja berupa teks, bukan kunci asing ke `slots`. Mengubah atau menghapus slot tidak mengubah entri yang sudah terjadwal.

### 4.6 Target per platform

```sql
create table public.targets (
  id                    bigint generated always as identity primary key,
  owner_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  post_id               bigint not null references public.posts (id) on delete cascade,
  platform              text not null check (platform in ('youtube', 'instagram', 'tiktok')),
  connection_id         bigint references public.connections (id),

  status                text not null default 'scheduled'
                        check (status in ('draft', 'scheduled', 'uploading', 'awaiting_platform',
                                          'published', 'failed', 'missed', 'cancelled')),
  step                  text,                         -- langkah terakhir yang selesai (bagian 7)
  pending_action        text check (pending_action in ('retry', 'cancel', 'sync_changes')),

  planned_dispatch_at   timestamptz,                  -- kapan pekerja harus mulai bekerja
  run_at                timestamptz,                  -- kapan target boleh dipilih pekerja berikutnya
  hold_reason           text,                         -- mis. 'needs_reauth'; bila terisi, dilewati

  attempt_count         integer not null default 0,   -- percobaan ulang sementara
  lease_owner           text,
  lease_until           timestamptz,

  external_id           text,     -- video_id YouTube / media_id IG / id posting Buffer
  external_state        jsonb not null default '{}',  -- lihat bagian 7
  public_url            text,

  idempotency_key       text not null unique,
  last_error_code       text,
  last_error_message    text,

  first_dispatched_at   timestamptz,
  published_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (post_id, platform)
);

create index ix_targets_runnable on public.targets (run_at)
  where run_at is not null;
create index ix_targets_owner_status on public.targets (owner_id, status);
create index ix_targets_platform_status on public.targets (platform, status);

create trigger trg_targets_updated before update on public.targets
  for each row execute function public.set_updated_at();
```

Catatan kolom:

- **`planned_dispatch_at`** adalah rencana awal; **`run_at`** adalah waktu efektif berikutnya (bisa lebih lambat setelah *backoff*). Keduanya `NULL` untuk entri draf.
- **`pending_action`** adalah niat pemilik yang menunggu pekerja (bagian 6).
- **`lease_*`** adalah hak kerja sementara agar dua pekerja tidak mengerjakan target yang sama. Lease tidak mengubah `status`.
- **`hold_reason`** menahan target tanpa menghitungnya sebagai gagal.

### 4.7 Riwayat kejadian

```sql
create table public.target_events (
  id           bigint generated always as identity primary key,
  target_id    bigint not null references public.targets (id) on delete cascade,
  at           timestamptz not null default now(),
  event        text not null
               check (event in ('status_change', 'step_done', 'api_call',
                                'retry_scheduled', 'recovered', 'action', 'note')),
  from_status  text,
  to_status    text,
  detail       jsonb                       -- TIDAK boleh berisi token, kunci, atau tautan bertanda tangan
);

create index ix_target_events_target on public.target_events (target_id, at desc);
```

### 4.8 Unggahan sementara

```sql
create table public.uploads (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind              text not null check (kind in ('video', 'thumbnail')),
  bucket            text not null check (bucket in ('videos', 'thumbnails')),
  object_path       text not null,
  filename          text not null,
  size_bytes        bigint not null,
  content_type      text,
  metadata          jsonb not null default '{}',      -- durasi, lebar, tinggi dari browser
  state             text not null default 'pending'
                    check (state in ('pending', 'ready', 'consumed', 'expired')),
  consumed_post_id  bigint references public.posts (id) on delete set null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '24 hours'
);

create index ix_uploads_owner_state on public.uploads (owner_id, state);
```

`pending` berarti URL unggah sudah dibuat; `ready` berarti objek sudah terverifikasi di Storage; `consumed` berarti dipakai sebuah entri; `expired` berarti dibersihkan pekerja.

### 4.9 Batas API

```sql
create table public.api_limits (
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform     text not null,
  "window"     text not null,                -- mis. '24h', '30d' (dikutip karena window adalah reserved word PostgreSQL)
  remaining    integer,
  limit_total  integer,
  resets_at    timestamptz,
  observed_at  timestamptz not null default now(),
  primary key (owner_id, platform, "window")
);
```

Diisi pekerja dari `content_publishing_limit` (Instagram) dan header batas Buffer. Dibaca sebelum memposting.

### 4.10 Detak pekerja

```sql
create table public.worker_heartbeats (
  worker_id     text primary key,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  last_tick_at  timestamptz not null,
  started_at    timestamptz not null,
  version       text,
  host_name     text
);
```

Pekerja menulis (upsert) tiap putaran. Antarmuka menganggap pekerja berhenti bila `last_tick_at` lebih dari 3 menit lalu.

### 4.11 Tampilan

```sql
create view public.v_post_overview with (security_invoker = true) as
select
  p.id, p.title, p.caption, p.due_at, p.state, p.slot_key,
  max(t.status) filter (where t.platform = 'youtube')   as youtube_status,
  max(t.status) filter (where t.platform = 'instagram') as instagram_status,
  max(t.status) filter (where t.platform = 'tiktok')    as tiktok_status
from public.posts p
left join public.targets t on t.post_id = p.id
group by p.id;

-- Perkiraan pemakaian untuk peringatan kuota (egress ≈ 2× ukuran video: pekerja + Buffer)
create view public.v_usage_estimate with (security_invoker = true) as
select
  coalesce(sum(video_size_bytes) filter (where media_deleted_at is null and state <> 'cancelled'), 0)
      as storage_bytes_estimate,
  coalesce(sum(video_size_bytes) filter (where created_at >= date_trunc('month', now())), 0) * 2
      as egress_bytes_estimate_month
from public.posts;
```

`security_invoker = true` membuat RLS pengguna berlaku pada tampilan.

## 5. Row Level Security (RLS)

RLS **aktif pada semua tabel**. Pekerja memakai `service_role` sehingga melewati RLS.

| Tabel | Pengguna login boleh | Kebijakan |
|---|---|---|
| `settings` | baca, tambah, ubah, hapus baris miliknya | `owner_id = auth.uid()` |
| `slots` | baca, tambah, ubah, hapus baris miliknya | `owner_id = auth.uid()` |
| `connections` | **baca saja** | `owner_id = auth.uid()` |
| `connection_secrets` | **tidak ada akses** | Tanpa kebijakan; hak akses dicabut |
| `posts` | **baca saja** | `owner_id = auth.uid()` |
| `targets` | **baca saja** | `owner_id = auth.uid()` |
| `target_events` | **baca saja** | `exists (select 1 from targets t where t.id = target_id and t.owner_id = auth.uid())` |
| `uploads` | baca, tambah, hapus miliknya | `owner_id = auth.uid()` |
| `api_limits` | baca saja | `owner_id = auth.uid()` |
| `worker_heartbeats` | baca saja | `owner_id = auth.uid()` |

Contoh kebijakan:

```sql
alter table public.posts enable row level security;

create policy posts_select_own on public.posts
  for select to authenticated using (owner_id = auth.uid());

alter table public.slots enable row level security;

create policy slots_all_own on public.slots
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
```

**Pengaturan Auth (di dasbor Supabase):** pendaftaran pengguna baru **dimatikan** setelah akun pemilik dibuat; MFA TOTP diaktifkan; tautan reset kata sandi dibatasi ke alamat Vercel.

## 6. Fungsi database

Fungsi bertanda **definer** berjalan dengan hak pemilik fungsi dan **wajib** memeriksa `auth.uid()`; pengguna tidak punya hak menulis langsung ke tabelnya.

| Fungsi | Pemanggil | Fungsi |
|---|---|---|
| `claim_targets(worker, limit, lease_seconds)` | pekerja (`service_role`) | Memilih dan mengunci target siap kerja secara atomik |
| `create_post_tx(p jsonb)` | pengguna (definer) | Membuat entri, tiga target, dan memakai unggahan, dalam satu transaksi |
| `update_post_tx(post_id, p jsonb)` | pengguna (definer) | Mengubah teks, thumbnail, atau jam, dan menandai target `sync_changes` bila perlu |
| `cancel_post_tx(post_id)` | pengguna (definer) | Menandai entri `cancelled` dan target `pending_action = cancel` |
| `request_target_retry(target_id, publish_now)` | pengguna (definer) | Menandai target `failed` atau `missed` untuk dicoba ulang |
| `request_connection_test(platform)` | pengguna (definer) | Mengisi `connections.test_requested_at` |
| `purge_expired(event_days)` | pekerja | Membersihkan `target_events` lama dan unggahan kedaluwarsa |

### 6.1 `claim_targets`

Atomik: pemilihan dan penetapan *lease* dalam satu pernyataan.

```sql
create or replace function public.claim_targets(
  p_worker text, p_limit int, p_lease_seconds int
) returns setof public.targets
language sql security definer set search_path = public as $$
  update public.targets t
  set lease_owner = p_worker,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      updated_at  = now()
  where t.id in (
    select id from public.targets
    where (status in ('scheduled', 'uploading', 'awaiting_platform')
           or pending_action is not null)
      and run_at is not null
      and run_at <= now()
      and hold_reason is null
      and (lease_until is null or lease_until <= now())
    order by run_at
    limit p_limit
    for update skip locked
  )
  returning t.*;
$$;

revoke all on function public.claim_targets(text, int, int) from public, anon, authenticated;
grant execute on function public.claim_targets(text, int, int) to service_role;
```

Batas satu pekerjaan per platform dijaga di pekerja, bukan di SQL.

### 6.2 `create_post_tx`

Isi `p`: `title`, `caption`, `hashtags`, `video_object_path`, `video_size_bytes`, `video_duration_ms`, `video_width`, `video_height`, `thumbnail_object_path`, `due_at`, `slot_key`, `is_time_overridden`, `state`, `upload_ids` (array uuid), dan `targets` (array `{platform, dispatch_at}`; `dispatch_at` dihitung di sisi aplikasi oleh `plan()` pada paket bersama).

```sql
create or replace function public.create_post_tx(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_owner   uuid := auth.uid();
  v_post_id bigint;
  v_state   text := coalesce(p->>'state', 'active');
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into posts (owner_id, title, caption, hashtags, video_object_path, video_size_bytes,
                     video_duration_ms, video_width, video_height, thumbnail_object_path,
                     due_at, slot_key, is_time_overridden, state)
  values (v_owner, p->>'title', p->>'caption', coalesce(p->>'hashtags', ''),
          p->>'video_object_path', (p->>'video_size_bytes')::bigint,
          (p->>'video_duration_ms')::int, (p->>'video_width')::int, (p->>'video_height')::int,
          p->>'thumbnail_object_path', (p->>'due_at')::timestamptz, p->>'slot_key',
          coalesce((p->>'is_time_overridden')::boolean, false), v_state)
  returning id into v_post_id;      -- pelanggaran ux_posts_slot_key menghasilkan galat 23505

  insert into targets (owner_id, post_id, platform, connection_id, status,
                       planned_dispatch_at, run_at, idempotency_key)
  select v_owner, v_post_id, x.platform, c.id,
         case when v_state = 'draft' then 'draft' else 'scheduled' end,
         case when v_state = 'draft' then null else x.dispatch_at end,
         case when v_state = 'draft' then null else x.dispatch_at end,
         v_post_id::text || ':' || x.platform || ':v1'
  from jsonb_to_recordset(p->'targets') as x(platform text, dispatch_at timestamptz)
  left join connections c
         on c.owner_id = v_owner and c.platform = x.platform and c.status <> 'disabled';

  update uploads
     set state = 'consumed', consumed_post_id = v_post_id
   where owner_id = v_owner
     and id in (select value::uuid
                from jsonb_array_elements_text(coalesce(p->'upload_ids', '[]'::jsonb)));

  insert into target_events (target_id, event, to_status, detail)
  select id, 'note', status, jsonb_build_object('msg', 'created')
  from targets where post_id = v_post_id;

  return v_post_id;
end $$;

grant execute on function public.create_post_tx(jsonb) to authenticated;
```

### 6.3 `request_target_retry`

```sql
create or replace function public.request_target_retry(p_target_id bigint, p_publish_now boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  update targets
     set pending_action = 'retry',
         run_at         = now(),
         external_state = external_state || jsonb_build_object('retry_publish_now', p_publish_now)
   where id = p_target_id
     and owner_id = auth.uid()
     and status in ('failed', 'missed')
     and pending_action is null;

  if not found then
    raise exception 'not_retryable' using errcode = 'P0001';
  end if;

  insert into target_events (target_id, event, detail)
  values (p_target_id, 'action', jsonb_build_object('action', 'retry'));
end $$;

grant execute on function public.request_target_retry(bigint, boolean) to authenticated;
```

### 6.4 Fungsi lain

`update_post_tx`, `cancel_post_tx`, `request_connection_test`, dan `purge_expired` mengikuti pola yang sama: periksa `auth.uid()` (atau `service_role` untuk `purge_expired`), ubah baris yang relevan, atur `run_at = now()` untuk target yang harus dikerjakan pekerja, dan catat `target_events`.

- `update_post_tx` mengevaluasi **aturan kunci** (`api-specification.md` bagian 5.5) berdasarkan `step` setiap target dan menolak seluruh perubahan bila ada target yang terkunci (galat `post_locked`, `details` memuat platform yang terkunci).
- `cancel_post_tx` mengosongkan slot (`slot_key = null`) dan menandai target `pending_action = cancel`; target yang belum pernah dikirim ke platform langsung `cancelled`.

## 7. Status, transisi, dan `step`

### 7.1 Transisi status target

| Dari | Ke | Pemicu |
|---|---|---|
| `draft` | `scheduled` | Pemilik menjadwalkan |
| `scheduled` | `uploading` | Pekerja mulai mengerjakan langkah pertama |
| `uploading` | `awaiting_platform` | Platform menerima jadwal (YouTube, Buffer) atau kontainer siap (Instagram) |
| `awaiting_platform` | `published` | Platform melaporkan terbit |
| `uploading` / `awaiting_platform` | `failed` | Galat permanen, atau percobaan ulang habis |
| `scheduled` / `uploading` | `missed` | Waktu lewat melebihi `grace_minutes` |
| `failed` / `missed` | `scheduled` | `retry` dikerjakan pekerja |
| apa pun yang belum akhir | `cancelled` | `cancel` dikerjakan pekerja |

Status akhir: `published`, `failed`, `missed`, `cancelled`. Target berstatus akhir tidak dipilih penjadwal **kecuali** memiliki `pending_action`.

### 7.2 Nilai `step`

`step` menandai langkah terakhir yang selesai agar pekerjaan dilanjutkan dari sana. Teks bebas, nilainya didefinisikan penerbit:

| Platform | Nilai `step` (berurutan) |
|---|---|
| youtube | `fetch_media` → `upload` → `wait_processing` → `set_thumbnail` → `await_publish` |
| instagram | `check_limit` → `fetch_media` → `cover_prepare` → `create_container` → `upload_video` → `wait_finished` → `publish_requested` → `done` |
| tiktok | `window_check` → `sign_url` → `create_post` → `await_publish` |

`publish_requested` pada Instagram adalah penanda kritis: ditulis **sebelum** memanggil `media_publish`. Bila pekerja mati pada kondisi ini, pemulihan tidak mengulang buta, melainkan memeriksa akun Instagram terlebih dulu (`system-design.md` bagian 10.2).

### 7.3 Contoh `external_state`

```json
{ "upload_uri": "https://...", "processing": "succeeded", "thumbnail_set": true }
```
```json
{ "container_id": "17999...", "cover_object_path": "<owner>/<upload>/cover.jpg" }
```
```json
{ "buffer_post_id": "6650...", "buffer_channel_id": "abc", "signed_url_expires_at": "2026-11-23T05:00:00Z", "retry_publish_now": false }
```

`external_state` tidak boleh menyimpan tautan bertanda tangan itu sendiri (hanya waktu kedaluwarsanya); tautan dibuat ulang saat dibutuhkan.

## 8. Kueri penting

### 8.1 Slot kosong berikutnya

Dua langkah: ambil slot yang sudah terisi dari database, lalu cari slot berikutnya di kode TypeScript (`packages/shared`), karena logika zona waktu lebih aman di aplikasi.

```sql
select slot_key
from public.posts
where owner_id = auth.uid()
  and state = 'active'
  and slot_key is not null
  and slot_key >= :today_key;      -- 'YYYY-MM-DD@00:00'
```

```ts
function nextFreeSlot(nowWib: Date, slotTimes: string[], occupied: Set<string>, minLeadMin: number) {
  for (let d = 0; ; d++) {
    const day = addDays(startOfDayWib(nowWib), d);
    for (const t of [...slotTimes].sort()) {
      const candidate = atWib(day, t);
      const key = `${formatDate(day)}@${t}`;
      if (candidate >= addMinutes(nowWib, minLeadMin) && !occupied.has(key)) return { candidate, key };
    }
  }
}
```

`min_lead_minutes` (nilai awal 15) mencegah slot yang terlalu dekat. Indeks unik `ux_posts_slot_key` menjadi pengaman terakhir; bila dua permintaan berebut slot, yang kalah mendapat galat `23505` dan aplikasi mencari slot lain atau melaporkan `slot_taken`.

### 8.2 Target yang perlu pemulihan saat pekerja mulai

```sql
select id, platform, step, external_id
from public.targets
where status = 'uploading'
  and (lease_until is null or lease_until <= now());
```

Tiap target diperiksa dengan `reconcile()` per platform sebelum dilanjutkan.

### 8.3 Target yang waktunya sudah lewat (kebijakan terlewat)

```sql
select t.id, t.platform, p.due_at
from public.targets t
join public.posts p on p.id = t.post_id
where t.status in ('scheduled', 'uploading')
  and p.due_at < now();
```

Pekerja membandingkan `now() - due_at` dengan `grace_minutes`: dalam batas, kerjakan; di luar batas, `missed`.

### 8.4 Ruang antrean Buffer

```sql
select count(*) as in_buffer
from public.targets
where platform = 'tiktok' and status = 'awaiting_platform';
```

Bila `in_buffer < buffer_queue_limit`, target TikTok berikutnya yang `due_at`-nya masuk jendela pengiriman boleh dikirim.

### 8.5 Target TikTok yang masuk jendela pengiriman

```sql
select t.id
from public.targets t
join public.posts p on p.id = t.post_id
where t.platform = 'tiktok'
  and t.status = 'scheduled'
  and p.state = 'active'
  and p.due_at <= now() + make_interval(days => :window_days)
order by p.due_at;
```

### 8.6 Pembersihan berkas (Storage dan cache)

```sql
select p.id, p.video_object_path, p.thumbnail_object_path
from public.posts p
where p.media_deleted_at is null
  and not exists (
        select 1 from public.targets t
        where t.post_id = p.id
          and t.status not in ('published', 'failed', 'missed', 'cancelled'))
  and (select max(coalesce(t.published_at, t.updated_at))
       from public.targets t where t.post_id = p.id)
      < now() - make_interval(days => :retention_days);
```

Setelah objek dihapus lewat Storage API, pekerja mengisi `media_deleted_at`. Target `failed` hanya bisa dicoba ulang selama berkas masih ada.

### 8.7 Unggahan yang tidak dipakai

```sql
select id, bucket, object_path
from public.uploads
where state in ('pending', 'ready') and expires_at < now();
```

Objek dihapus dari Storage, baris diubah menjadi `expired`.

### 8.8 Menyambung ulang akun

```sql
-- Setelah akun berhasil disambung ulang: lepaskan penahanan
update public.targets set hold_reason = null
where connection_id = :connection_id and hold_reason = 'needs_reauth';

-- Saat token gagal diperbarui permanen: tahan target platform itu
update public.targets set hold_reason = 'needs_reauth'
where connection_id = :connection_id
  and status in ('scheduled', 'uploading', 'awaiting_platform');
```

### 8.9 Peringatan pekerja berhenti

```sql
select worker_id, last_tick_at, now() - last_tick_at as age
from public.worker_heartbeats
where owner_id = auth.uid()
order by last_tick_at desc
limit 1;
```

Antarmuka menganggap pekerja berhenti bila `age` lebih dari 3 menit atau tidak ada baris sama sekali.

## 9. Penyimpanan (Supabase Storage)

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('videos',     'videos',     false, 52428800, array['video/mp4', 'video/quicktime']),
  ('thumbnails', 'thumbnails', false,  8388608, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Pengguna hanya dapat membaca dan mengunggah ke folder miliknya
create policy media_select_own on storage.objects
  for select to authenticated
  using (bucket_id in ('videos', 'thumbnails')
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy media_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id in ('videos', 'thumbnails')
              and (storage.foldername(name))[1] = auth.uid()::text);
```

- Batas berkas video **50 MB** mengikuti batas paket gratis.
- Pengguna tidak punya kebijakan `update` dan `delete`; pembersihan dilakukan pekerja dengan `service_role`.
- Bucket privat; tautan bertanda tangan dibuat untuk pratinjau (10 menit) dan untuk Buffer (sampai jam terbit ditambah 6 jam).
- Jalur objek: `<owner_id>/<upload_id>/<nama_berkas>`.

## 10. Realtime

```sql
alter publication supabase_realtime add table
  public.posts, public.targets, public.worker_heartbeats, public.connections;
```

Antarmuka berlangganan perubahan tabel ini sehingga status tampil tanpa memuat ulang. RLS berlaku pada Realtime: pengguna hanya menerima perubahan baris miliknya. `connection_secrets` tidak pernah masuk publikasi.

## 11. Pengaturan awal (`settings`)

| Kunci | Nilai awal (JSON) |
|---|---|
| `timezone` | `"Asia/Jakarta"` |
| `grace_minutes` | `120` |
| `tiktok_window_days` | `2` |
| `buffer_queue_limit` | `10` |
| `retry_backoff_minutes` | `[1, 5, 15]` |
| `instagram_prepare_lead_minutes` | `10` |
| `min_lead_minutes` | `15` |
| `media_retention_days` | `3` |
| `event_retention_days` | `180` |
| `max_video_size_mb` | `50` |
| `storage_quota_mb` | `1024` |
| `egress_quota_mb` | `5120` |
| `quota_warn_percent` | `80` |

Baris pengaturan dan slot awal dibuat oleh skrip *seed* setelah akun pemilik ada (butuh `owner_id`).

## 12. Retensi, cadangan, dan migrasi

- **Volume:** sekitar 4 entri dan 12 target per hari; sekitar 1.500 entri dan 4.400 target per tahun. Riwayat kejadian puluhan ribu baris per tahun, jauh di bawah batas 500 MB paket gratis.
- **Retensi:** `target_events` lebih tua dari `event_retention_days` dihapus pekerja. `posts` dan `targets` disimpan sebagai riwayat; hanya berkas medianya yang dibersihkan.
- **Cadangan:** paket gratis tidak punya cadangan otomatis. Pekerja mengekspor tabel inti sebagai JSON ke `data/backups/<tanggal>/` setiap hari (tanpa `connection_secrets`) dan menyimpan 7 salinan. Pemulihan dilakukan dengan mengimpor berkas itu ke proyek baru.
- **Migrasi:** berkas SQL bernomor di `supabase/migrations/`, diterapkan dengan Supabase CLI. Tidak ada migrasi mundur; perubahan skema yang merusak didahului ekspor cadangan.
- **Pemulihan proyek dijeda:** proyek gratis dijeda setelah seminggu tanpa aktivitas; detak pekerja mencegahnya. Bila terjadi, pulihkan lewat dasbor Supabase.

## 13. Catatan untuk versi berlangganan (tidak dikerjakan sekarang)

Kerangka multi-pengguna sudah ada: `owner_id` dan RLS pada semua tabel bermilik, rahasia dan Storage dipisah per pemilik, dan pekerja tidak mengandalkan laptop. Yang perlu ditambah kelak: pendaftaran, kuota per pengguna, `worker_heartbeats` per pekerja multi-pemilik, penagihan, indeks unik koneksi yang sudah per pemilik, dan peningkatan paket Supabase dan Vercel. Bentuk tabel `targets` tidak perlu diubah.
