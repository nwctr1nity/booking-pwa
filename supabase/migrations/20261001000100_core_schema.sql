-- Core multi-tenant schema for the booking app.
-- Every dependent table carries tenant_id and references its parent through a
-- composite (tenant_id, id) foreign key, so rows can never point across tenants.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public;

-- ---------------------------------------------------------------------------
-- Helpers that table definitions depend on
-- ---------------------------------------------------------------------------
create or replace function app_private.is_valid_timezone(tz text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  perform now() at time zone tz;
  return tz is not null and length(tz) > 0;
exception when others then
  return false;
end;
$$;

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenants (one row per studio)
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  status text not null default 'preview'
    check (status in ('preview', 'live', 'disabled')),
  name text not null check (char_length(name) between 2 and 80),
  short_name text not null check (char_length(short_name) between 1 and 24),
  kind text not null default 'detailing'
    check (kind in ('detailing', 'service', 'tire', 'wash', 'other')),
  timezone text not null check (app_private.is_valid_timezone(timezone)),
  currency text not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  locale text not null default 'ru-RU',
  accent_color text not null default '#4690FF' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  tagline text not null default '' check (char_length(tagline) <= 120),
  description text not null default '' check (char_length(description) <= 1000),
  address text not null default '' check (char_length(address) <= 200),
  address_note text not null default '' check (char_length(address_note) <= 200),
  map_url text check (map_url is null or map_url ~ '^https://'),
  phone text not null default '' check (phone ~ '^(\+?[0-9]{10,15})?$'),
  info_cards jsonb not null default '[]'::jsonb
    check (jsonb_typeof(info_cards) = 'array' and jsonb_array_length(info_cards) <= 3),
  logo_path text,
  hero_path text,
  cancellation_hours integer not null default 12 check (cancellation_hours between 0 and 168),
  slot_step_minutes integer not null default 30 check (slot_step_minutes in (15, 20, 30, 60)),
  min_notice_minutes integer not null default 60 check (min_notice_minutes between 0 and 2880),
  horizon_days integer not null default 30 check (horizon_days between 1 and 120),
  reminder_hours integer not null default 24 check (reminder_hours between 1 and 72),
  -- Field names the owner edited in the cabinet; the config pipeline never
  -- overwrites them on re-publish.
  owner_locked text[] not null default '{}',
  config_hash text,
  published_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger tenants_touch before update on public.tenants
  for each row execute function app_private.touch_updated_at();

create table public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on public.tenant_members(user_id);

-- ---------------------------------------------------------------------------
-- Catalogue: resources (boxes/posts), services, schedule, gallery
-- ---------------------------------------------------------------------------
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text,
  name text not null check (char_length(name) between 1 and 60),
  is_active boolean not null default true,
  sort integer not null default 0,
  owner_modified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);
create trigger resources_touch before update on public.resources
  for each row execute function app_private.touch_updated_at();

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text,
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '' check (char_length(description) <= 400),
  category text not null default '' check (char_length(category) <= 40),
  price_cents bigint not null check (price_cents >= 0),
  price_is_from boolean not null default false,
  duration_minutes integer not null check (duration_minutes between 15 and 14 * 24 * 60),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 24 * 60),
  is_active boolean not null default true,
  sort integer not null default 0,
  owner_modified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);
create trigger services_touch before update on public.services
  for each row execute function app_private.touch_updated_at();

create table public.service_resources (
  tenant_id uuid not null,
  service_id uuid not null,
  resource_id uuid not null,
  primary key (service_id, resource_id),
  foreign key (tenant_id, service_id) references public.services(tenant_id, id) on delete cascade,
  foreign key (tenant_id, resource_id) references public.resources(tenant_id, id) on delete cascade
);
create index service_resources_tenant_idx on public.service_resources(tenant_id);

-- Weekly hours. weekday is ISO (1 = Monday ... 7 = Sunday). Several rows per
-- day describe a lunch break. Hours define when a car can be *accepted*.
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  opens time not null,
  closes time not null,
  check (opens < closes)
);
create index working_hours_tenant_idx on public.working_hours(tenant_id, weekday);

-- Dated overrides: a holiday (is_closed) or special hours for one day.
create table public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  is_closed boolean not null default true,
  opens time,
  closes time,
  note text not null default '' check (char_length(note) <= 120),
  owner_modified boolean not null default false,
  unique (tenant_id, day),
  check (is_closed or (opens is not null and closes is not null and opens < closes))
);

create table public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text,
  image_path text not null,
  caption text not null default '' check (char_length(caption) <= 140),
  sort integer not null default 0,
  owner_modified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);
create index gallery_items_tenant_idx on public.gallery_items(tenant_id, sort);
create trigger gallery_items_touch before update on public.gallery_items
  for each row execute function app_private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Bookings, occupancy, payments
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null,
  resource_id uuid not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'arrived', 'done', 'cancelled', 'no_show')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Snapshots: later catalogue edits never change an existing booking.
  service_name text not null,
  price_cents bigint not null check (price_cents >= 0),
  price_is_from boolean not null default false,
  duration_minutes integer not null,
  buffer_minutes integer not null default 0,
  customer_name text not null check (char_length(customer_name) between 2 and 80),
  customer_phone text not null check (customer_phone ~ '^\+?[0-9]{10,15}$'),
  car text not null check (char_length(car) between 2 and 80),
  comment text not null default '' check (char_length(comment) <= 500),
  source text not null check (source in ('client', 'owner', 'demo')),
  is_demo boolean not null default false,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 100),
  request_hash text not null,
  access_token_hash bytea,
  version integer not null default 1,
  arrived_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('client', 'owner', 'system')),
  cancel_reason text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  check (ends_at > starts_at),
  foreign key (tenant_id, service_id) references public.services(tenant_id, id),
  foreign key (tenant_id, resource_id) references public.resources(tenant_id, id)
);
create unique index bookings_token_idx on public.bookings(access_token_hash) where access_token_hash is not null;
create index bookings_tenant_start_idx on public.bookings(tenant_id, starts_at);
create trigger bookings_touch before update on public.bookings
  for each row execute function app_private.touch_updated_at();

-- One table for everything that holds a resource: bookings and manual blocks.
-- The EXCLUDE constraint is the single source of truth against double booking.
create table public.resource_occupancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  resource_id uuid not null,
  booking_id uuid,
  kind text not null check (kind in ('booking', 'block')),
  period tstzrange not null,
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, resource_id) references public.resources(tenant_id, id) on delete cascade,
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade,
  unique (booking_id),
  check ((kind = 'booking') = (booking_id is not null)),
  check (not isempty(period) and lower_inc(period) and not upper_inc(period)
         and not lower_inf(period) and not upper_inf(period)),
  constraint resource_occupancies_no_overlap
    exclude using gist (resource_id with =, period with &&)
);
create index resource_occupancies_tenant_idx on public.resource_occupancies using gist (tenant_id, period);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('payment', 'refund')),
  amount_cents bigint not null check (amount_cents > 0),
  method text not null default 'card' check (method in ('cash', 'card', 'transfer', 'other')),
  paid_at timestamptz not null default now(),
  note text not null default '' check (char_length(note) <= 200),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 100),
  is_demo boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);
create index payments_tenant_paid_idx on public.payments(tenant_id, paid_at);

create table public.booking_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  booking_id uuid not null,
  type text not null,
  actor text not null check (actor in ('client', 'owner', 'system')),
  actor_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);
create index booking_events_booking_idx on public.booking_events(booking_id);

-- ---------------------------------------------------------------------------
-- Notifications (Web Push) and abuse limits
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  endpoint text not null check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (booking_id, endpoint),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  kind text not null default 'reminder' check (kind in ('reminder')),
  channel text not null default 'webpush' check (channel in ('webpush')),
  run_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled', 'suppressed')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  lease_until timestamptz,
  locked_by text,
  dedupe_key text not null unique,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);
create index notification_jobs_due_idx on public.notification_jobs(run_at) where status in ('pending', 'processing');
create trigger notification_jobs_touch before update on public.notification_jobs
  for each row execute function app_private.touch_updated_at();

-- Fixed-window counters shared by all API instances. Updated atomically with
-- INSERT .. ON CONFLICT so concurrent requests cannot both slip under a limit.
create table app_private.rate_limit_counters (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

create table app_private.secrets (
  name text primary key,
  value text not null
);
insert into app_private.secrets(name, value)
values ('booking_token_key', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;
