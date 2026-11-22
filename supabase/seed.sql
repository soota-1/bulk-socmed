-- =============================================================================
-- Seed: Initial slots and settings for the owner
-- Run AFTER creating the owner account via Supabase Auth dashboard.
-- Replace <OWNER_UUID> with the actual auth.users.id of the owner.
-- =============================================================================

-- Default daily slots (WIB)
insert into public.slots (owner_id, local_time, is_active)
values
  ('<OWNER_UUID>', '06:00', true),
  ('<OWNER_UUID>', '12:00', true),
  ('<OWNER_UUID>', '16:00', true),
  ('<OWNER_UUID>', '19:00', true)
on conflict (owner_id, local_time) do nothing;

-- Default settings
insert into public.settings (owner_id, key, value)
values
  ('<OWNER_UUID>', 'timezone',                        '"Asia/Jakarta"'),
  ('<OWNER_UUID>', 'grace_minutes',                   '120'),
  ('<OWNER_UUID>', 'tiktok_window_days',              '2'),
  ('<OWNER_UUID>', 'buffer_queue_limit',              '10'),
  ('<OWNER_UUID>', 'retry_backoff_minutes',           '[1, 5, 15]'),
  ('<OWNER_UUID>', 'instagram_prepare_lead_minutes',  '10'),
  ('<OWNER_UUID>', 'min_lead_minutes',                '15'),
  ('<OWNER_UUID>', 'media_retention_days',            '3'),
  ('<OWNER_UUID>', 'event_retention_days',            '180'),
  ('<OWNER_UUID>', 'max_video_size_mb',               '50'),
  ('<OWNER_UUID>', 'storage_quota_mb',                '1024'),
  ('<OWNER_UUID>', 'egress_quota_mb',                 '5120'),
  ('<OWNER_UUID>', 'quota_warn_percent',              '80')
on conflict (owner_id, key) do update set value = excluded.value;
