-- DM alert engine: dedupe table for Slack pings + Slack member id mapping on
-- dm_users. Run in the Supabase SQL editor (Slice Squad project), after
-- dm_archive.sql.

alter table public.dm_users add column if not exists slack_user_id text;

create table if not exists public.dm_alerts (
  id uuid primary key default uuid_generate_v4(),
  conversation_id text not null references public.dm_conversations(id) on delete cascade,
  level text not null check (level in ('setter_60m', 'team_3h')),
  first_unanswered_at timestamptz not null,
  assigned_to text,
  waiting_minutes integer,
  notified_at timestamptz not null default now(),
  unique (conversation_id, level, first_unanswered_at)
);

create index if not exists dm_alerts_conversation_idx on public.dm_alerts (conversation_id);

alter table public.dm_alerts enable row level security;

create policy "Admins can manage dm_alerts" on public.dm_alerts
for all using (public.current_rep_role() = 'admin')
with check (public.current_rep_role() = 'admin');

create policy "Reps can view dm_alerts" on public.dm_alerts
for select using (auth.uid() is not null);
