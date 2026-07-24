-- ManyChat enrichment columns. Run in the Supabase SQL editor (Slice Squad
-- project), after dm_archive.sql / dm_alerts.sql.

alter table public.dm_conversations
  add column if not exists mc_subscriber_id text,
  add column if not exists mc_chat_url text,
  add column if not exists mc_assigned text;
