-- =============================================================================
-- Migration: 20261122000000_init_schema.sql
-- Penjadwal Video Pendek - Initial schema
-- Database: Supabase (PostgreSQL 15+)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Helper trigger function
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Settings & Slots
-- ---------------------------------------------------------------------------

create table public.settings (
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (owner_id, key)
);

alter table public.settings enable row level security;

create policy settings_all_own on public.settings
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create trigger trg_settings_updated before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------

create table public.slots (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_time  time not null,              -- WIB time, e.g. '06:00'
  is_active   boolean not null default true,
  unique (owner_id, local_time)
);

alter table public.slots enable row level security;

create policy slots_all_own on public.slots
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Connections & Secrets
-- ---------------------------------------------------------------------------

create table public.connections (
  id                   bigint generated always as identity primary key,
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform             text not null check (platform in ('youtube', 'instagram', 'tiktok')),
  provider             text not null check (provider in ('youtube_api', 'instagram_graph', 'buffer')),
  display_name         text,
  external_account_id  text,
  status               text not null default 'active'
                       check (status in ('active', 'needs_reauth', 'disabled')),
  token_expires_at     timestamptz,
  details              jsonb not null default '{}',
  test_requested_at    timestamptz,
  last_test            jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One active connection per platform per owner
create unique index ux_connections_owner_platform
  on public.connections (owner_id, platform) where status <> 'disabled';

alter table public.connections enable row level security;

-- Users can only read their own connections (writes go via service_role / functions)
create policy connections_select_own on public.connections
  for select to authenticated using (owner_id = auth.uid());

create trigger trg_connections_updated before update on public.connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------

create table public.connection_secrets (
  connection_id      bigint primary key references public.connections (id) on delete cascade,
  access_token_enc   bytea,              -- AES-256-GCM encrypted
  refresh_token_enc  bytea,
  api_key_enc        bytea,             -- Buffer API key
  key_version        int not null default 1,
  updated_at         timestamptz not null default now()
);

alter table public.connection_secrets enable row level security;
-- Intentionally NO policies: only service_role can read/write
revoke all on public.connection_secrets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Posts (video entries)
-- ---------------------------------------------------------------------------

create table public.posts (
  id                      bigint generated always as identity primary key,
  owner_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title                   text check (char_length(title) <= 100),
  caption                 text not null,
  hashtags                text not null default '',

  video_object_path       text not null,
  video_size_bytes        bigint,
  video_duration_ms       integer,
  video_width             integer,
  video_height            integer,
  thumbnail_object_path   text,

  due_at                  timestamptz not null,
  slot_key                text,          -- 'YYYY-MM-DD@HH:MM' WIB; NULL if time overridden
  is_time_overridden      boolean not null default false,

  state                   text not null default 'active'
                          check (state in ('draft', 'active', 'cancelled')),
  media_deleted_at        timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  cancelled_at            timestamptz
);

-- One active entry per slot (slot_key is intentionally text, not FK to slots)
create unique index ux_posts_slot_key
  on public.posts (owner_id, slot_key)
  where state = 'active' and slot_key is not null;

create index ix_posts_owner_due on public.posts (owner_id, due_at);

alter table public.posts enable row level security;

create policy posts_select_own on public.posts
  for select to authenticated using (owner_id = auth.uid());

create trigger trg_posts_updated before update on public.posts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Targets (per-platform publishing state)
-- ---------------------------------------------------------------------------

create table public.targets (
  id                    bigint generated always as identity primary key,
  owner_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  post_id               bigint not null references public.posts (id) on delete cascade,
  platform              text not null check (platform in ('youtube', 'instagram', 'tiktok')),
  connection_id         bigint references public.connections (id),

  status                text not null default 'scheduled'
                        check (status in ('draft', 'scheduled', 'uploading', 'awaiting_platform',
                                          'published', 'failed', 'missed', 'cancelled')),
  step                  text,
  pending_action        text check (pending_action in ('retry', 'cancel', 'sync_changes')),

  planned_dispatch_at   timestamptz,
  run_at                timestamptz,
  hold_reason           text,

  attempt_count         integer not null default 0,
  lease_owner           text,
  lease_until           timestamptz,

  external_id           text,
  external_state        jsonb not null default '{}',
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

alter table public.targets enable row level security;

create policy targets_select_own on public.targets
  for select to authenticated using (owner_id = auth.uid());

create trigger trg_targets_updated before update on public.targets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Target Events (audit log)
-- ---------------------------------------------------------------------------

create table public.target_events (
  id           bigint generated always as identity primary key,
  target_id    bigint not null references public.targets (id) on delete cascade,
  at           timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  event        text not null
               check (event in ('status_change', 'step_done', 'api_call',
                                'retry_scheduled', 'recovered', 'action', 'note',
                                'error', 'hold', 'cancelled', 'sync_changes', 'retry', 'media_cleaned')),
  from_status  text,
  to_status    text,
  detail       jsonb   -- MUST NOT contain tokens, secrets, or signed URLs
);

create index ix_target_events_target on public.target_events (target_id, at desc);

alter table public.target_events enable row level security;

create policy target_events_select_own on public.target_events
  for select to authenticated
  using (exists (
    select 1 from public.targets t
    where t.id = target_id and t.owner_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 6. Uploads (temporary media staging)
-- ---------------------------------------------------------------------------

create table public.uploads (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind              text not null check (kind in ('video', 'thumbnail')),
  bucket            text not null check (bucket in ('videos', 'thumbnails')),
  object_path       text not null,
  filename          text not null,
  size_bytes        bigint not null,
  content_type      text,
  metadata          jsonb not null default '{}',
  state             text not null default 'pending'
                    check (state in ('pending', 'ready', 'consumed', 'expired')),
  consumed_post_id  bigint references public.posts (id) on delete set null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '24 hours'
);

create index ix_uploads_owner_state on public.uploads (owner_id, state);

alter table public.uploads enable row level security;

create policy uploads_own on public.uploads
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 7. API Limits (rate limit tracking)
-- ---------------------------------------------------------------------------

create table public.api_limits (
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform     text not null,
  "window"     text not null,          -- e.g. '24h', '30d' (quoted because window is a reserved keyword in PostgreSQL)
  remaining    integer,
  limit_total  integer,
  resets_at    timestamptz,
  observed_at  timestamptz not null default now(),
  primary key (owner_id, platform, "window")
);

alter table public.api_limits enable row level security;

create policy api_limits_select_own on public.api_limits
  for select to authenticated using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. Worker Heartbeats
-- ---------------------------------------------------------------------------

create table public.worker_heartbeats (
  worker_id     text primary key,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  last_tick_at  timestamptz not null,
  started_at    timestamptz not null,
  version       text,
  host_name     text
);

alter table public.worker_heartbeats enable row level security;

create policy worker_heartbeats_select_own on public.worker_heartbeats
  for select to authenticated using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 9. Views
-- ---------------------------------------------------------------------------

create view public.v_post_overview with (security_invoker = true) as
select
  p.id,
  p.title,
  p.caption,
  p.due_at,
  p.state,
  p.slot_key,
  max(t.status) filter (where t.platform = 'youtube')   as youtube_status,
  max(t.status) filter (where t.platform = 'instagram') as instagram_status,
  max(t.status) filter (where t.platform = 'tiktok')    as tiktok_status
from public.posts p
left join public.targets t on t.post_id = p.id
group by p.id;

-- Quota usage estimate (egress ≈ 2× video size: worker download + Buffer fetch)
create view public.v_usage_estimate with (security_invoker = true) as
select
  coalesce(sum(video_size_bytes) filter (where media_deleted_at is null and state <> 'cancelled'), 0)
      as storage_bytes_estimate,
  coalesce(sum(video_size_bytes) filter (where created_at >= date_trunc('month', now())), 0) * 2
      as egress_bytes_estimate_month
from public.posts;

-- ---------------------------------------------------------------------------
-- 10. Database Functions
-- ---------------------------------------------------------------------------

-- claim_targets: atomic lease grant, FOR UPDATE SKIP LOCKED
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

-- ---------------------------------------------------------------------------

-- create_post_tx: create post + 3 targets + mark upload consumed atomically
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
  returning id into v_post_id;  -- unique index violation => 23505

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

-- ---------------------------------------------------------------------------

-- request_target_retry
create or replace function public.request_target_retry(
  p_target_id bigint,
  p_publish_now boolean default false
) returns void language plpgsql security definer set search_path = public as $$
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

-- ---------------------------------------------------------------------------

-- cancel_post_tx
create or replace function public.cancel_post_tx(p_post_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  update posts
     set state = 'cancelled', slot_key = null, cancelled_at = now()
   where id = p_post_id and owner_id = v_owner and state <> 'cancelled';

  if not found then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;

  -- Targets not yet in a terminal state: request cancel from worker
  update targets
     set pending_action = 'cancel',
         run_at = now()
   where post_id = p_post_id
     and status not in ('published', 'failed', 'missed', 'cancelled');

  -- Targets that were never dispatched: cancel immediately
  update targets
     set status = 'cancelled'
   where post_id = p_post_id
     and status = 'scheduled'
     and external_id is null
     and pending_action = 'cancel';

  insert into target_events (target_id, event, detail)
  select id, 'action', jsonb_build_object('action', 'cancel')
  from targets where post_id = p_post_id;
end $$;

grant execute on function public.cancel_post_tx(bigint) to authenticated;

-- ---------------------------------------------------------------------------

-- request_connection_test
create or replace function public.request_connection_test(p_platform text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update connections
     set test_requested_at = now()
   where platform = p_platform
     and owner_id = auth.uid()
     and status = 'active';

  if not found then
    raise exception 'connection_not_found' using errcode = 'P0003';
  end if;
end $$;

grant execute on function public.request_connection_test(text) to authenticated;

-- ---------------------------------------------------------------------------

-- purge_expired: worker maintenance (service_role only)
create or replace function public.purge_expired(p_event_days int default 180)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Delete old target events
  delete from target_events
  where at < now() - make_interval(days => p_event_days);

  -- Mark expired uploads
  update uploads
     set state = 'expired'
   where state in ('pending', 'ready')
     and expires_at < now();
end $$;

revoke all on function public.purge_expired(int) from public, anon, authenticated;
grant execute on function public.purge_expired(int) to service_role;

-- ---------------------------------------------------------------------------
-- 11. Storage Buckets
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('videos',     'videos',     false, 52428800, array['video/mp4', 'video/quicktime']),
  ('thumbnails', 'thumbnails', false,  8388608, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Users can read and upload to their own folder
create policy media_select_own on storage.objects
  for select to authenticated
  using (bucket_id in ('videos', 'thumbnails')
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy media_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id in ('videos', 'thumbnails')
              and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 12. Realtime publications
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.posts, public.targets, public.worker_heartbeats, public.connections;
