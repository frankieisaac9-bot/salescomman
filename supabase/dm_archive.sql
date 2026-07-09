-- DM archive: conversations + messages exported from GoHighLevel before the
-- ManyChat migration. Run once in the Supabase SQL editor (Slice Squad project).
-- Forward-going Instagram webhook data will land in these same tables with
-- source = 'instagram'.

create table if not exists public.dm_conversations (
  id text primary key,                -- GHL conversation id (or IG thread id later)
  source text not null default 'ghl',
  location_id text,
  contact_id text,
  contact_name text,
  email text,
  phone text,
  assigned_to text,                   -- GHL user id of assigned setter
  last_message_date timestamptz,
  last_message_direction text,
  last_message_type text,
  unread_count integer,
  tags text[],
  raw jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.dm_messages (
  id text primary key,                -- GHL message id
  conversation_id text not null references public.dm_conversations(id) on delete cascade,
  source text not null default 'ghl',
  contact_id text,
  direction text,                     -- 'inbound' (lead) | 'outbound' (team)
  body text,
  message_type text,                  -- TYPE_INSTAGRAM, TYPE_SMS, ...
  content_type text,
  status text,
  user_id text,                       -- GHL user id who sent it (manual outbound only)
  sent_source text,                   -- GHL "source": app / workflow / bulk_actions ...
  alt_id text,                        -- native IG message id — joins with Meta webhook data later
  attachments jsonb,
  meta jsonb,
  date_added timestamptz,
  synced_at timestamptz not null default now()
);

create table if not exists public.dm_users (
  id text primary key,                -- GHL user id
  name text,
  first_name text,
  last_name text,
  email text,
  raw jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists dm_messages_conversation_date_idx on public.dm_messages (conversation_id, date_added);
create index if not exists dm_messages_user_idx on public.dm_messages (user_id);
create index if not exists dm_messages_date_idx on public.dm_messages (date_added);
create index if not exists dm_conversations_assigned_idx on public.dm_conversations (assigned_to);
create index if not exists dm_conversations_last_message_idx on public.dm_conversations (last_message_date);

alter table public.dm_conversations enable row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_users enable row level security;

create policy "Admins can manage dm_conversations" on public.dm_conversations
for all using (public.current_rep_role() = 'admin')
with check (public.current_rep_role() = 'admin');

create policy "Reps can view dm_conversations" on public.dm_conversations
for select using (auth.uid() is not null);

create policy "Admins can manage dm_messages" on public.dm_messages
for all using (public.current_rep_role() = 'admin')
with check (public.current_rep_role() = 'admin');

create policy "Reps can view dm_messages" on public.dm_messages
for select using (auth.uid() is not null);

create policy "Admins can manage dm_users" on public.dm_users
for all using (public.current_rep_role() = 'admin')
with check (public.current_rep_role() = 'admin');

create policy "Reps can view dm_users" on public.dm_users
for select using (auth.uid() is not null);
