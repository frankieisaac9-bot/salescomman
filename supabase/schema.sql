create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;

create type call_status as enum ('booked', 'showed', 'no_show', 'closed', 'lost');
create type objection_type as enum ('partner', 'think_about_it', 'fear', 'money', 'other');
create type lead_status as enum ('pending', 'followed_up', 'converted', 'dead');
create type flag_level as enum ('none', 'day3', 'day7', 'day10', 'day14');

create table if not exists public.reps (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  avatar_url text,
  role text not null default 'rep' check (role in ('admin', 'rep')),
  team text,
  created_at timestamptz not null default now()
);

create table if not exists public.calls (
  id uuid primary key default uuid_generate_v4(),
  rep_id uuid references public.reps(id) on delete set null,
  contact_id text,
  close_opportunity_id text unique,
  status call_status not null default 'booked',
  product_offered text,
  outcome text,
  cash_collected numeric(12,2) not null default 0,
  revenue_generated numeric(12,2) not null default 0,
  call_recording_url text,
  call_date timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.objections (
  id uuid primary key default uuid_generate_v4(),
  call_id uuid references public.calls(id) on delete cascade,
  rep_id uuid references public.reps(id) on delete set null,
  type objection_type not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default uuid_generate_v4(),
  rep_id uuid references public.reps(id) on delete set null,
  contact_id text,
  close_contact_id text unique,
  call_date timestamptz,
  last_follow_up timestamptz,
  notes text,
  status lead_status not null default 'pending',
  flag_level flag_level not null default 'none',
  created_at timestamptz not null default now()
);

create table if not exists public.trophy_room (
  id uuid primary key default uuid_generate_v4(),
  rep_id uuid references public.reps(id) on delete set null,
  call_id uuid references public.calls(id) on delete cascade,
  title text not null,
  description text,
  call_recording_url text,
  thumbnail_url text,
  tags text[] default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.sheet_imports (
  id uuid primary key default uuid_generate_v4(),
  source text not null check (source in ('numbers', 'post_call')),
  external_row_id text,
  payload jsonb not null,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source, external_row_id)
);

create table if not exists public.sheet_numbers (
  id uuid primary key default uuid_generate_v4(),
  rep_id uuid references public.reps(id) on delete set null,
  metric_date date not null default now(),
  new_leads integer not null default 0,
  disqualified integer not null default 0,
  follow_ups integer not null default 0,
  calls_pitched integer not null default 0,
  dials integer not null default 0,
  conversations integer not null default 0,
  offers integer not null default 0,
  booked_calls integer not null default 0,
  showed_calls integer not null default 0,
  no_shows integer not null default 0,
  cancelled integer not null default 0,
  reschedules integer not null default 0,
  closed_calls integer not null default 0,
  cash_collected numeric(12,2) not null default 0,
  revenue_generated numeric(12,2) not null default 0,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rep_id, metric_date)
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values
  ('products', '["Setter School", "Closer Accelerator", "Sales Team Buildout", "Enterprise Coaching"]'::jsonb),
  ('follow_up_thresholds', '{"day3":3,"day7":7,"day10":10,"day14":14}'::jsonb)
on conflict (key) do nothing;

create index if not exists calls_rep_id_idx on public.calls(rep_id);
create index if not exists calls_status_idx on public.calls(status);
create index if not exists calls_call_date_idx on public.calls(call_date);
create index if not exists objections_rep_id_idx on public.objections(rep_id);
create index if not exists leads_flag_level_idx on public.leads(flag_level);
create index if not exists trophy_room_rep_id_idx on public.trophy_room(rep_id);
create index if not exists sheet_numbers_rep_date_idx on public.sheet_numbers(rep_id, metric_date);

alter table public.reps enable row level security;
alter table public.calls enable row level security;
alter table public.objections enable row level security;
alter table public.leads enable row level security;
alter table public.trophy_room enable row level security;
alter table public.sheet_imports enable row level security;
alter table public.sheet_numbers enable row level security;
alter table public.app_settings enable row level security;

create or replace function public.current_rep_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.reps where user_id = auth.uid() limit 1), 'rep')
$$;

create or replace function public.current_rep_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select (select id from public.reps where user_id = auth.uid() limit 1)
$$;

create policy "Admins can manage reps" on public.reps
for all using (public.current_rep_role() = 'admin')
with check (public.current_rep_role() = 'admin');

create policy "Reps can view reps" on public.reps
for select using (auth.uid() is not null);

create policy "Admins can manage calls" on public.calls
for all using (public.current_rep_role() = 'admin')
with check (public.current_rep_role() = 'admin');

create policy "Reps can manage own calls" on public.calls
for all using (rep_id = public.current_rep_id())
with check (rep_id = public.current_rep_id());

create policy "Reps can view global calls" on public.calls
for select using (auth.uid() is not null);

create policy "Admins can manage objections" on public.objections
for all using (public.current_rep_role() = 'admin')
with check (public.current_rep_role() = 'admin');

create policy "Reps can manage own objections" on public.objections
for all using (rep_id = public.current_rep_id())
with check (rep_id = public.current_rep_id());

create policy "Reps can view global objections" on public.objections
for select using (auth.uid() is not null);

create policy "Admins can manage leads" on public.leads
for all using (public.current_rep_role() = 'admin')
with check (public.current_rep_role() = 'admin');

create policy "Reps can manage own leads" on public.leads
for all using (rep_id = public.current_rep_id())
with check (rep_id = public.current_rep_id());

create policy "Admins can manage trophies" on public.trophy_room
for all using (public.current_rep_role() = 'admin')
with check (public.current_rep_role() = 'admin');

create policy "Reps can view trophies" on public.trophy_room
for select using (auth.uid() is not null);

create policy "Admins can manage sheet imports" on public.sheet_imports
for all using (public.current_rep_role() = 'admin')
with check (public.current_rep_role() = 'admin');

create policy "Admins can manage sheet numbers" on public.sheet_numbers
for all using (public.current_rep_role() = 'admin')
with check (public.current_rep_role() = 'admin');

create policy "Reps can view sheet numbers" on public.sheet_numbers
for select using (auth.uid() is not null);

create policy "Admins can manage app settings" on public.app_settings
for all using (public.current_rep_role() = 'admin')
with check (public.current_rep_role() = 'admin');

create policy "Authenticated can read app settings" on public.app_settings
for select using (auth.uid() is not null);

create or replace function public.update_lead_flag_levels()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.leads
  set flag_level = case
    when call_date is null then 'none'::flag_level
    when now()::date - call_date::date >= 14 then 'day14'::flag_level
    when now()::date - call_date::date >= 10 then 'day10'::flag_level
    when now()::date - call_date::date >= 7 then 'day7'::flag_level
    when now()::date - call_date::date >= 3 then 'day3'::flag_level
    else 'none'::flag_level
  end
  where status in ('pending', 'followed_up');
end;
$$;

select cron.schedule(
  'salescommand-daily-lead-flags',
  '0 8 * * *',
  $$select public.update_lead_flag_levels();$$
);

alter publication supabase_realtime add table public.calls;
