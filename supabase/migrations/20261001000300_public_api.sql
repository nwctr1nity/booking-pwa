-- Public (anon) API: studio page, free slots, booking by token.
-- Core functions (app_private.core_*) raise on business errors. The public
-- wrappers at the end of this file count the request in the shared rate-limit
-- table first (outside the error-handling block, so the hit is committed even
-- when the request fails) and turn expected errors into {"error": code}.
-- The client never sends price, tenant id, duration or resource: they are
-- derived on the server from the slug and the service.

create or replace function app_private.booking_public_json(b public.bookings, p_token text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id,
    'status', b.status,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at,
    'service_name', b.service_name,
    'price_cents', b.price_cents,
    'price_is_from', b.price_is_from,
    'duration_minutes', b.duration_minutes,
    'customer_name', b.customer_name,
    'customer_phone', b.customer_phone,
    'car', b.car,
    'comment', b.comment,
    'resource_name', r.name,
    'is_demo', b.is_demo,
    'cancel_deadline', b.starts_at - make_interval(hours => t.cancellation_hours),
    'can_cancel', b.status = 'confirmed' and now() <= b.starts_at - make_interval(hours => t.cancellation_hours),
    'reminder', app_private.reminder_state(b.id),
    'studio', jsonb_build_object(
      'slug', t.slug, 'name', t.name, 'address', t.address, 'phone', t.phone,
      'timezone', t.timezone, 'currency', t.currency, 'map_url', t.map_url,
      'cancellation_hours', t.cancellation_hours, 'reminder_hours', t.reminder_hours
    )
  ) || case when p_token is null then '{}'::jsonb else jsonb_build_object('access_token', p_token) end
  from public.tenants t
  join public.resources r on r.id = b.resource_id and r.tenant_id = b.tenant_id
  where t.id = b.tenant_id
$$;

-- ---------------------------------------------------------------------------
create or replace function app_private.core_get_studio(p_slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  t := app_private.tenant_by_slug(p_slug);
  return jsonb_build_object(
    'id', t.id,
    'slug', t.slug,
    'status', t.status,
    'is_preview', t.status = 'preview',
    'name', t.name,
    'short_name', t.short_name,
    'kind', t.kind,
    'timezone', t.timezone,
    'currency', t.currency,
    'locale', t.locale,
    'accent_color', t.accent_color,
    'tagline', t.tagline,
    'description', t.description,
    'address', t.address,
    'address_note', t.address_note,
    'map_url', t.map_url,
    'phone', t.phone,
    'info_cards', t.info_cards,
    'logo_path', t.logo_path,
    'hero_path', t.hero_path,
    'cancellation_hours', t.cancellation_hours,
    'reminder_hours', t.reminder_hours,
    'horizon_days', t.horizon_days,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'description', s.description, 'category', s.category,
        'price_cents', s.price_cents, 'price_is_from', s.price_is_from,
        'duration_minutes', s.duration_minutes
      ) order by s.sort, s.name)
      from public.services s
      where s.tenant_id = t.id and s.is_active
        and exists (
          select 1 from public.service_resources sr
          join public.resources r on r.id = sr.resource_id and r.is_active
          where sr.service_id = s.id
        )
    ), '[]'::jsonb),
    'gallery', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'image_path', g.image_path, 'caption', g.caption,
                                          'updated_at', g.updated_at)
                       order by g.sort, g.created_at)
      from public.gallery_items g where g.tenant_id = t.id
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', to_char(h.opens, 'HH24:MI'),
                                          'closes', to_char(h.closes, 'HH24:MI'))
                       order by h.weekday, h.opens)
      from public.working_hours h where h.tenant_id = t.id
    ), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object('day', e.day, 'is_closed', e.is_closed,
                                          'opens', to_char(e.opens, 'HH24:MI'),
                                          'closes', to_char(e.closes, 'HH24:MI'), 'note', e.note)
                       order by e.day)
      from public.schedule_exceptions e
      where e.tenant_id = t.id
        and e.day >= (now() at time zone t.timezone)::date
        and e.day < (now() at time zone t.timezone)::date + 60
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
create or replace function app_private.core_get_slots(
  p_slug text, p_service_id uuid, p_from date, p_days integer default 7
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  s public.services;
  v_today date;
  v_from date;
  v_to date;
begin
  t := app_private.tenant_by_slug(p_slug);
  select * into s from public.services where id = p_service_id and tenant_id = t.id and is_active;
  if not found then
    perform app_private.fail('service_unavailable');
  end if;
  v_today := (now() at time zone t.timezone)::date;
  v_from := greatest(coalesce(p_from, v_today), v_today);
  v_to := least(v_from + greatest(1, least(coalesce(p_days, 7), 14)) - 1, v_today + t.horizon_days);
  if v_to < v_from then
    return jsonb_build_object('timezone', t.timezone, 'days', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'timezone', t.timezone,
    'service_id', s.id,
    'duration_minutes', s.duration_minutes,
    'from', v_from,
    'to', v_to,
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.day,
        'is_open', exists (select 1 from app_private.day_intervals(t.id, d.day)),
        'slots', coalesce((
          select jsonb_agg(jsonb_build_object('starts_at', c.starts_at, 'available', c.available)
                           order by c.starts_at)
          from app_private.compute_slots(t.id, s.id, v_from, v_to) c
          where (c.starts_at at time zone t.timezone)::date = d.day
        ), '[]'::jsonb)
      ) order by d.day), '[]'::jsonb)
      from (select g::date as day from generate_series(v_from, v_to, interval '1 day') g) d
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic booking creation. One transaction:
--   advisory lock on (tenant, idempotency key) -> replay check -> validation ->
--   insert booking + occupancy on the first free suitable resource.
-- A concurrent winner on the same resource makes the EXCLUDE constraint fire;
-- the sub-transaction is rolled back and the next resource is tried.
create or replace function app_private.core_create_booking(
  p_slug text,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_name text,
  p_phone text,
  p_car text,
  p_comment text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  s public.services;
  b public.bookings;
  v_phone text := app_private.normalize_phone(p_phone);
  v_name text := btrim(coalesce(p_name, ''));
  v_car text := btrim(coalesce(p_car, ''));
  v_comment text := btrim(coalesce(p_comment, ''));
  v_hash text;
  v_token text;
  r record;
  v_done boolean := false;
begin
  t := app_private.tenant_by_slug(p_slug);
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,100}$' then
    perform app_private.fail('invalid_input', 'idempotency_key');
  end if;

  v_hash := encode(extensions.digest(concat_ws('|', p_service_id, p_starts_at, v_name, v_phone, v_car, v_comment), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(t.id::text || ':' || p_idempotency_key, 0));

  select * into b from public.bookings where tenant_id = t.id and idempotency_key = p_idempotency_key;
  if found then
    if b.request_hash <> v_hash then
      perform app_private.fail('idempotency_conflict', 'the same request key was used for different data');
    end if;
    return app_private.booking_public_json(b, app_private.derive_access_token(t.id, p_idempotency_key))
           || jsonb_build_object('replayed', true);
  end if;


  if char_length(v_name) not between 2 and 80 then perform app_private.fail('invalid_input', 'name'); end if;
  if v_phone is null or v_phone !~ '^\+?[0-9]{10,15}$' then perform app_private.fail('invalid_input', 'phone'); end if;
  if char_length(v_car) not between 2 and 80 then perform app_private.fail('invalid_input', 'car'); end if;
  if char_length(v_comment) > 500 then perform app_private.fail('invalid_input', 'comment'); end if;

  select * into s from public.services where id = p_service_id and tenant_id = t.id and is_active;
  if not found then
    perform app_private.fail('service_unavailable');
  end if;
  if p_starts_at is null or not app_private.is_valid_start(t.id, s.id, p_starts_at) then
    perform app_private.fail('slot_unavailable', 'this time is not offered by the schedule');
  end if;

  v_token := app_private.derive_access_token(t.id, p_idempotency_key);

  for r in
    select res.id
    from public.service_resources sr
    join public.resources res on res.id = sr.resource_id and res.is_active and res.tenant_id = t.id
    where sr.service_id = s.id and sr.tenant_id = t.id
    order by res.sort, res.name, res.id
  loop
    begin
      insert into public.bookings(
        tenant_id, service_id, resource_id, status, starts_at, ends_at,
        service_name, price_cents, price_is_from, duration_minutes, buffer_minutes,
        customer_name, customer_phone, car, comment, source, is_demo,
        idempotency_key, request_hash, access_token_hash
      ) values (
        t.id, s.id, r.id, 'confirmed', p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes),
        s.name, s.price_cents, s.price_is_from, s.duration_minutes, s.buffer_minutes,
        v_name, v_phone, v_car, v_comment, 'client', t.status = 'preview',
        p_idempotency_key, v_hash, app_private.hash_token(v_token)
      ) returning * into b;

      insert into public.resource_occupancies(tenant_id, resource_id, booking_id, kind, period)
      values (t.id, r.id, b.id, 'booking',
              tstzrange(b.starts_at, b.ends_at + make_interval(mins => b.buffer_minutes), '[)'));
      v_done := true;
      exit;
    exception when exclusion_violation then
      -- this resource was taken meanwhile; the sub-transaction undid the insert
      null;
    end;
  end loop;

  if not v_done then
    perform app_private.fail('slot_taken', 'this time has just been booked');
  end if;

  perform app_private.log_event(t.id, b.id, 'created', 'client',
    jsonb_build_object('starts_at', b.starts_at, 'resource_id', b.resource_id));
  return app_private.booking_public_json(b, v_token) || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
create or replace function app_private.booking_by_token(p_slug text, p_token text, p_lock boolean default false)
returns public.bookings
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  b public.bookings;
begin
  t := app_private.tenant_by_slug(p_slug);
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,60}$' then
    perform app_private.fail('booking_not_found');
  end if;
  if p_lock then
    select * into b from public.bookings
    where tenant_id = t.id and access_token_hash = app_private.hash_token(p_token) for update;
  else
    select * into b from public.bookings
    where tenant_id = t.id and access_token_hash = app_private.hash_token(p_token);
  end if;
  if not found then
    perform app_private.fail('booking_not_found');
  end if;
  return b;
end;
$$;

create or replace function app_private.core_get_booking(p_slug text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  b := app_private.booking_by_token(p_slug, p_token);
  return app_private.booking_public_json(b);
end;
$$;

create or replace function app_private.core_cancel_booking(p_slug text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  t public.tenants;
begin
  b := app_private.booking_by_token(p_slug, p_token, true);
  if b.status = 'cancelled' then
    return app_private.booking_public_json(b);
  end if;
  select * into t from public.tenants where id = b.tenant_id;
  if b.status <> 'confirmed' then
    perform app_private.fail('cannot_cancel', 'the car has already been accepted');
  end if;
  if now() > b.starts_at - make_interval(hours => t.cancellation_hours) then
    perform app_private.fail('cancel_deadline_passed', 'please call the studio');
  end if;

  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'client', version = version + 1
   where id = b.id
  returning * into b;
  delete from public.resource_occupancies where booking_id = b.id;
  perform app_private.log_event(b.tenant_id, b.id, 'cancelled', 'client');
  perform app_private.sync_reminder(b.id);
  return app_private.booking_public_json(b);
end;
$$;

create or replace function app_private.core_save_push_subscription(
  p_slug text, p_token text, p_endpoint text, p_p256dh text, p_auth text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  b := app_private.booking_by_token(p_slug, p_token);
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_=-]{40,200}$'
     or coalesce(p_auth, '') !~ '^[A-Za-z0-9_=-]{8,100}$' then
    perform app_private.fail('invalid_input', 'subscription');
  end if;
  if b.status <> 'confirmed' then
    perform app_private.fail('cannot_subscribe', 'booking is not active');
  end if;
  insert into public.push_subscriptions(tenant_id, booking_id, endpoint, p256dh, auth)
  values (b.tenant_id, b.id, p_endpoint, p_p256dh, p_auth)
  on conflict (booking_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
  perform app_private.sync_reminder(b.id);
  return app_private.reminder_state(b.id);
end;
$$;

create or replace function app_private.core_remove_push_subscription(p_slug text, p_token text, p_endpoint text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  b := app_private.booking_by_token(p_slug, p_token);
  delete from public.push_subscriptions where booking_id = b.id and endpoint = p_endpoint;
  perform app_private.sync_reminder(b.id);
  return app_private.reminder_state(b.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------
create or replace function app_private.rate_allow(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into app_private.rate_limit_counters as c (bucket, window_start, hits)
  values (p_bucket, w, 1)
  on conflict (bucket, window_start) do update set hits = c.hits + 1
  returning hits into n;
  return n <= p_limit;
end;
$$;

create or replace function public.public_get_studio(p_slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_msg text;
  v_hint text;
begin
  if not app_private.rate_allow('read:' || app_private.request_ip(), 600, 600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  begin
    return app_private.core_get_studio(p_slug);
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    return jsonb_build_object('error', v_msg, 'hint', v_hint);
  end;
end;
$$;

create or replace function public.public_get_slots(p_slug text, p_service_id uuid, p_from date, p_days integer default 7)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_msg text;
  v_hint text;
begin
  if not app_private.rate_allow('read:' || app_private.request_ip(), 600, 600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  begin
    return app_private.core_get_slots(p_slug, p_service_id, p_from, p_days);
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    return jsonb_build_object('error', v_msg, 'hint', v_hint);
  end;
end;
$$;

create or replace function public.public_create_booking(
  p_slug text, p_service_id uuid, p_starts_at timestamptz, p_name text, p_phone text,
  p_car text, p_comment text, p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_msg text;
  v_hint text;
  v_ip text := app_private.request_ip();
begin
  -- every attempt counts, including failed ones (the hit is committed)
  if not app_private.rate_allow('book:' || lower(coalesce(p_slug, '')) || ':' || v_ip, 8, 600)
     or not app_private.rate_allow('book:' || v_ip, 30, 3600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  begin
    return app_private.core_create_booking(p_slug, p_service_id, p_starts_at, p_name, p_phone, p_car, p_comment, p_idempotency_key);
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    return jsonb_build_object('error', v_msg, 'hint', v_hint);
  end;
end;
$$;

create or replace function public.public_get_booking(p_slug text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_msg text;
  v_hint text;
begin
  if not app_private.rate_allow('token:' || app_private.request_ip(), 120, 600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  begin
    return app_private.core_get_booking(p_slug, p_token);
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    return jsonb_build_object('error', v_msg, 'hint', v_hint);
  end;
end;
$$;

create or replace function public.public_cancel_booking(p_slug text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_msg text;
  v_hint text;
begin
  if not app_private.rate_allow('token:' || app_private.request_ip(), 120, 600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  begin
    return app_private.core_cancel_booking(p_slug, p_token);
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    return jsonb_build_object('error', v_msg, 'hint', v_hint);
  end;
end;
$$;

create or replace function public.public_save_push_subscription(
  p_slug text, p_token text, p_endpoint text, p_p256dh text, p_auth text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_msg text;
  v_hint text;
begin
  if not app_private.rate_allow('token:' || app_private.request_ip(), 120, 600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  begin
    return app_private.core_save_push_subscription(p_slug, p_token, p_endpoint, p_p256dh, p_auth);
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    return jsonb_build_object('error', v_msg, 'hint', v_hint);
  end;
end;
$$;

create or replace function public.public_remove_push_subscription(p_slug text, p_token text, p_endpoint text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_msg text;
  v_hint text;
begin
  if not app_private.rate_allow('token:' || app_private.request_ip(), 120, 600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  begin
    return app_private.core_remove_push_subscription(p_slug, p_token, p_endpoint);
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    return jsonb_build_object('error', v_msg, 'hint', v_hint);
  end;
end;
$$;
