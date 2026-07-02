-- ============================================================
-- SalesCommand — Full schema
-- Paste this into a fresh Supabase project's SQL editor and run.
-- ============================================================

create extension if not exists "uuid-ossp";

-- Enums
create type call_status   as enum ('booked','showed','no_show','closed','lost');
create type objection_type as enum (
  'money_logistics','money_fear','partner','think_about_it','fear_of_failure','na','other'
);
create type lead_status as enum ('pending','followed_up','converted','dead');
create type flag_level  as enum ('none','day3','day7','day10','day14');

-- ── Core tables ──────────────────────────────────────────────

create table if not exists public.reps (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users(id) on delete set null,
  name       text not null,
  avatar_url text,
  role       text not null default 'rep' check (role in ('admin','rep')),
  team       text,
  created_at timestamptz not null default now()
);

create table if not exists public.calls (
  id                   uuid primary key default uuid_generate_v4(),
  rep_id               uuid references public.reps(id) on delete set null,
  contact_id           text,
  close_opportunity_id text unique,
  status               call_status not null default 'booked',
  product_offered      text,
  outcome              text,
  cash_collected       numeric(12,2) not null default 0,
  revenue_generated    numeric(12,2) not null default 0,
  call_recording_url   text,
  call_date            timestamptz not null default now(),
  created_at           timestamptz not null default now()
);

create table if not exists public.objections (
  id         uuid primary key default uuid_generate_v4(),
  call_id    uuid references public.calls(id) on delete cascade,
  rep_id     uuid references public.reps(id) on delete set null,
  type       objection_type not null,
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id               uuid primary key default uuid_generate_v4(),
  rep_id           uuid references public.reps(id) on delete set null,
  contact_id       text,
  close_contact_id text unique,
  call_date        timestamptz,
  last_follow_up   timestamptz,
  notes            text,
  status           lead_status not null default 'pending',
  flag_level       flag_level  not null default 'none',
  created_at       timestamptz not null default now()
);

create table if not exists public.trophy_room (
  id                 uuid primary key default uuid_generate_v4(),
  rep_id             uuid references public.reps(id) on delete set null,
  call_id            uuid references public.calls(id) on delete cascade,
  title              text not null,
  description        text,
  call_recording_url text,
  thumbnail_url      text,
  tags               text[] default '{}',
  created_at         timestamptz not null default now()
);

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('products', '["Setter School","Closer Accelerator","Sales Team Buildout","Enterprise Coaching"]'::jsonb),
  ('follow_up_thresholds', '{"day3":3,"day7":7,"day10":10,"day14":14}'::jsonb)
on conflict (key) do nothing;

-- ── Tracking-sheet tables ────────────────────────────────────

create table if not exists public.daily_stats (
  id            uuid primary key default uuid_generate_v4(),
  rep_id        uuid references public.reps(id) on delete set null,
  rep_name      text,
  date          date not null,
  available     integer not null default 0,
  booked        integer not null default 0,
  showed        integer not null default 0,
  canceled      integer not null default 0,
  no_show       integer not null default 0,
  offer         integer not null default 0,
  deposit       integer not null default 0,
  closed        integer not null default 0,
  cash_collected  numeric(12,2) not null default 0,
  rev_generated   numeric(12,2) not null default 0,
  created_at    timestamptz not null default now(),
  unique (rep_name, date)
);

create table if not exists public.setter_stats (
  id                 uuid primary key default uuid_generate_v4(),
  setter_name        text not null,
  date               date not null,
  new_leads          integer not null default 0,
  dq                 integer not null default 0,
  follow_ups         integer not null default 0,
  calls_pitched      integer not null default 0,
  booked_calls       integer not null default 0,
  calls_on_calendar  integer not null default 0,
  calls_shown        integer not null default 0,
  no_shows           integer not null default 0,
  cancelled          integer not null default 0,
  reschedules        integer not null default 0,
  cash_collected     numeric(12,2) not null default 0,
  revenue            numeric(12,2) not null default 0,
  created_at         timestamptz not null default now(),
  unique (setter_name, date)
);

-- ── Post-call form table ─────────────────────────────────────

create table if not exists public.closer_calls (
  id                 uuid primary key default uuid_generate_v4(),
  form_timestamp     timestamptz,
  rep_name           text not null,
  date               date,
  lead_email         text,
  setter             text,
  problem            text,
  goal               text,
  obstacles          text,
  prospect_job       text,
  notes              text,
  offer_made         boolean not null default false,
  lead_status        text,
  call_recording_url text,
  cash_collected     numeric(12,2) not null default 0,
  revenue            numeric(12,2) not null default 0,
  created_at         timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────

create index if not exists calls_rep_id_idx        on public.calls(rep_id);
create index if not exists calls_status_idx        on public.calls(status);
create index if not exists calls_call_date_idx     on public.calls(call_date);
create index if not exists objections_rep_id_idx   on public.objections(rep_id);
create index if not exists leads_flag_level_idx    on public.leads(flag_level);
create index if not exists trophy_room_rep_id_idx  on public.trophy_room(rep_id);
create index if not exists daily_stats_date_idx    on public.daily_stats(date);
create index if not exists setter_stats_date_idx   on public.setter_stats(date);
create index if not exists closer_calls_date_idx   on public.closer_calls(date);

-- ── RLS ──────────────────────────────────────────────────────

alter table public.reps         enable row level security;
alter table public.calls        enable row level security;
alter table public.objections   enable row level security;
alter table public.leads        enable row level security;
alter table public.trophy_room  enable row level security;
alter table public.app_settings enable row level security;
alter table public.daily_stats  enable row level security;
alter table public.setter_stats enable row level security;
alter table public.closer_calls enable row level security;

create or replace function public.current_rep_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.reps where user_id = auth.uid() limit 1), 'rep')
$$;

create or replace function public.current_rep_id()
returns uuid language sql stable security definer set search_path = public as $$
  select (select id from public.reps where user_id = auth.uid() limit 1)
$$;

-- reps
create policy "Admins can manage reps"  on public.reps for all
  using (public.current_rep_role() = 'admin') with check (public.current_rep_role() = 'admin');
create policy "Reps can view reps"      on public.reps for select using (auth.uid() is not null);

-- calls
create policy "Admins can manage calls" on public.calls for all
  using (public.current_rep_role() = 'admin') with check (public.current_rep_role() = 'admin');
create policy "Reps can view calls"     on public.calls for select using (auth.uid() is not null);

-- objections
create policy "Admins can manage objections" on public.objections for all
  using (public.current_rep_role() = 'admin') with check (public.current_rep_role() = 'admin');
create policy "Reps can view objections"     on public.objections for select using (auth.uid() is not null);

-- leads
create policy "Admins can manage leads" on public.leads for all
  using (public.current_rep_role() = 'admin') with check (public.current_rep_role() = 'admin');
create policy "Reps can view leads"     on public.leads for select using (auth.uid() is not null);

-- trophy_room
create policy "Admins can manage trophies" on public.trophy_room for all
  using (public.current_rep_role() = 'admin') with check (public.current_rep_role() = 'admin');
create policy "Reps can view trophies"     on public.trophy_room for select using (auth.uid() is not null);

-- app_settings
create policy "Admins can manage app settings"    on public.app_settings for all
  using (public.current_rep_role() = 'admin') with check (public.current_rep_role() = 'admin');
create policy "Authenticated can read app settings" on public.app_settings for select using (auth.uid() is not null);

-- daily_stats, setter_stats, closer_calls (service-role writes only; all authed users can read)
create policy "Authenticated can read daily_stats"  on public.daily_stats  for select using (auth.uid() is not null);
create policy "Authenticated can read setter_stats" on public.setter_stats for select using (auth.uid() is not null);
create policy "Authenticated can read closer_calls" on public.closer_calls for select using (auth.uid() is not null);
