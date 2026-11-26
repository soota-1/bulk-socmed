-- Migration: Allow tiktok_direct and tiktok_api in connections_provider_check
alter table public.connections drop constraint if exists connections_provider_check;
alter table public.connections add constraint connections_provider_check
  check (provider in ('youtube_api', 'instagram_graph', 'buffer', 'tiktok_direct', 'tiktok_api'));
