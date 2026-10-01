-- Owner cabinet API. Every function confirms membership of the caller
-- (auth.uid() from the verified JWT) in the requested tenant before reading
-- or writing anything.

create or replace function app_private.booking_owner_json(b public.bookings)
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
    'occupied_until', b.ends_at + make_interval(mins => b.buffer_minutes),
    'service_id', b.service_id,
    'service_name', b.service_name,
    'price_cents', b.price_cents,
    'price_is_from', b.price_is_from,
    'duration_minutes', b.duration_minutes,
    'resource_id', b.resource_id,
    'resource_name', (select r.name from public.resources r where r.id = b.resource_id),
    'customer_name', b.customer_name,
    'customer_phone', b.customer_phone,
    'car', b.car,
    'comment', b.comment,
    'source', b.source,
    'is_demo', b.is_demo,
    'version', b.version,
    'arrived_at', b.arrived_at,
    'completed_at', b.completed_at,
    'cancelled_at', b.cancelled_at,
    'cancelled_by', b.cancelled_by,
    'cancel_reason', b.cancel_reason,
    'created_at', b.created_at,
    'paid_cents', coalesce((select sum(p.amount_cents) from public.payments p where p.booking_id = b.id and p.kind = 'payment'), 0),
    'refunded_cents', coalesce((select sum(p.amount_cents) from public.payments p where p.booking_id = b.id and p.kind = 'refund'), 0),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'amount_cents', p.amount_cents,
                                          'method', p.method, 'paid_at', p.paid_at, 'note', p.note)
                       order by p.paid_at)
      from public.payments p where p.booking_id = b.id
    ), '[]'::jsonb)
  )
$$;

create or replace function app_private.check_media_path(p_tenant uuid, p_path text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_path is not null and p_path !~ ('^' || p_tenant::text || '/(owner|config)/[A-Za-z0-9._-]{1,120}$') then
    perform app_private.fail('invalid_input', 'media path must be inside the studio folder');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------
create or replace function public.owner_my_tenants()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'role', m.role,
    'timezone', t.timezone, 'currency', t.currency
  ) order by t.name), '[]'::jsonb)
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid())
$$;

create or replace function public.owner_get_bookings(p_tenant uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_range tstzrange;
begin
  perform app_private.require_member(p_tenant);
  select * into t from public.tenants where id = p_tenant;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    perform app_private.fail('invalid_input', 'period');
  end if;
  v_range := app_private.local_day_range(t.timezone, p_from, p_to);
  return jsonb_build_object(
    'timezone', t.timezone,
    'from', p_from,
    'to', p_to,
    'bookings', coalesce((
      select jsonb_agg(app_private.booking_owner_json(b) order by b.starts_at)
      from public.bookings b
      where b.tenant_id = p_tenant
        and tstzrange(b.starts_at, b.ends_at, '[)') && v_range
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'resource_id', o.resource_id, 'resource_name', r.name,
        'starts_at', lower(o.period), 'ends_at', upper(o.period), 'note', o.note
      ) order by lower(o.period))
      from public.resource_occupancies o
      join public.resources r on r.id = o.resource_id
      where o.tenant_id = p_tenant and o.kind = 'block' and o.period && v_range
    ), '[]'::jsonb)
  );
end;
$$;

-- Statistics are computed here, in SQL, for a period of local dates in the
-- studio's timezone:
--   arrivals        cars actually accepted (status arrived/done), by arrival time
--   scheduled       non-cancelled bookings starting in the period
--   completed       jobs marked done, by completion time
--   received/refunded/net  real money movements, by payment time
--   planned_value   price of bookings still ahead (NOT revenue)
create or replace function public.owner_get_stats(p_tenant uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_range tstzrange;
  v jsonb;
begin
  perform app_private.require_member(p_tenant);
  select * into t from public.tenants where id = p_tenant;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    perform app_private.fail('invalid_input', 'period');
  end if;
  v_range := app_private.local_day_range(t.timezone, p_from, p_to);

  select jsonb_build_object(
    'timezone', t.timezone,
    'currency', t.currency,
    'from', p_from,
    'to', p_to,
    'arrivals', (select count(*) from public.bookings b
                 where b.tenant_id = p_tenant and b.status in ('arrived', 'done')
                   and coalesce(b.arrived_at, b.starts_at) <@ v_range),
    'scheduled', (select count(*) from public.bookings b
                  where b.tenant_id = p_tenant and b.status <> 'cancelled' and b.starts_at <@ v_range),
    'completed', (select count(*) from public.bookings b
                  where b.tenant_id = p_tenant and b.status = 'done' and b.completed_at <@ v_range),
    'cancelled', (select count(*) from public.bookings b
                  where b.tenant_id = p_tenant and b.status = 'cancelled' and b.starts_at <@ v_range),
    'no_show', (select count(*) from public.bookings b
                where b.tenant_id = p_tenant and b.status = 'no_show' and b.starts_at <@ v_range),
    'received_cents', coalesce((select sum(p.amount_cents) from public.payments p
                                where p.tenant_id = p_tenant and p.kind = 'payment' and p.paid_at <@ v_range), 0),
    'refunded_cents', coalesce((select sum(p.amount_cents) from public.payments p
                                where p.tenant_id = p_tenant and p.kind = 'refund' and p.paid_at <@ v_range), 0),
    'planned_value_cents', coalesce((select sum(b.price_cents) from public.bookings b
                                     where b.tenant_id = p_tenant and b.status in ('confirmed', 'arrived')
                                       and b.starts_at <@ v_range), 0)
  ) into v;
  return v || jsonb_build_object('net_cents', (v ->> 'received_cents')::bigint - (v ->> 'refunded_cents')::bigint);
end;
$$;

create or replace function public.owner_get_settings(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  perform app_private.require_member(p_tenant);
  select * into t from public.tenants where id = p_tenant;
  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'status', t.status, 'name', t.name, 'short_name', t.short_name,
      'timezone', t.timezone, 'currency', t.currency, 'accent_color', t.accent_color,
      'tagline', t.tagline, 'description', t.description, 'address', t.address,
      'address_note', t.address_note, 'map_url', t.map_url, 'phone', t.phone,
      'info_cards', t.info_cards, 'logo_path', t.logo_path, 'hero_path', t.hero_path,
      'cancellation_hours', t.cancellation_hours, 'slot_step_minutes', t.slot_step_minutes,
      'min_notice_minutes', t.min_notice_minutes, 'horizon_days', t.horizon_days
    ),
    'resources', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'is_active', r.is_active, 'sort', r.sort) order by r.sort, r.name)
      from public.resources r where r.tenant_id = p_tenant), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'description', s.description, 'category', s.category,
        'price_cents', s.price_cents, 'price_is_from', s.price_is_from,
        'duration_minutes', s.duration_minutes, 'buffer_minutes', s.buffer_minutes,
        'is_active', s.is_active, 'sort', s.sort,
        'resource_ids', coalesce((select jsonb_agg(sr.resource_id) from public.service_resources sr
                                  where sr.service_id = s.id), '[]'::jsonb)
      ) order by s.sort, s.name)
      from public.services s where s.tenant_id = p_tenant), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object(
        'weekday', h.weekday, 'opens', to_char(h.opens, 'HH24:MI'), 'closes', to_char(h.closes, 'HH24:MI'))
        order by h.weekday, h.opens)
      from public.working_hours h where h.tenant_id = p_tenant), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object(
        'day', e.day, 'is_closed', e.is_closed, 'opens', to_char(e.opens, 'HH24:MI'),
        'closes', to_char(e.closes, 'HH24:MI'), 'note', e.note) order by e.day)
      from public.schedule_exceptions e
      where e.tenant_id = p_tenant and e.day >= (now() at time zone t.timezone)::date - 1), '[]'::jsonb),
    'gallery', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'image_path', g.image_path, 'caption', g.caption, 'sort', g.sort,
        'updated_at', g.updated_at) order by g.sort, g.created_at)
      from public.gallery_items g where g.tenant_id = p_tenant), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Bookings: create / reschedule / cancel / status / payments / blocks
-- ---------------------------------------------------------------------------
create or replace function public.owner_create_booking(
  p_tenant uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_resource_id uuid,
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
  r record;
  v_phone text := app_private.normalize_phone(p_phone);
  v_hash text;
  v_done boolean := false;
begin
  perform app_private.require_member(p_tenant);
  select * into t from public.tenants where id = p_tenant;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,100}$' then
    perform app_private.fail('invalid_input', 'idempotency_key');
  end if;
  v_hash := encode(extensions.digest(concat_ws('|', 'owner', p_service_id, p_starts_at, p_resource_id,
    btrim(p_name), v_phone, btrim(p_car), btrim(coalesce(p_comment, ''))), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || p_idempotency_key, 0));
  select * into b from public.bookings where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
  if found then
    if b.request_hash <> v_hash then
      perform app_private.fail('idempotency_conflict');
    end if;
    return app_private.booking_owner_json(b) || jsonb_build_object('replayed', true);
  end if;

  select * into s from public.services where id = p_service_id and tenant_id = p_tenant;
  if not found then perform app_private.fail('service_unavailable'); end if;
  if p_starts_at is null then perform app_private.fail('invalid_input', 'starts_at'); end if;
  if v_phone is null or v_phone !~ '^\+?[0-9]{10,15}$' then perform app_private.fail('invalid_input', 'phone'); end if;

  for r in
    select res.id from public.resources res
    where res.tenant_id = p_tenant and res.is_active
      and (case when p_resource_id is not null then res.id = p_resource_id
                else exists (select 1 from public.service_resources sr where sr.service_id = s.id and sr.resource_id = res.id) end)
    order by res.sort, res.name, res.id
  loop
    begin
      insert into public.bookings(
        tenant_id, service_id, resource_id, status, starts_at, ends_at,
        service_name, price_cents, price_is_from, duration_minutes, buffer_minutes,
        customer_name, customer_phone, car, comment, source, is_demo,
        idempotency_key, request_hash, created_by
      ) values (
        p_tenant, s.id, r.id, 'confirmed', p_starts_at, p_starts_at + make_interval(mins => s.duration_minutes),
        s.name, s.price_cents, s.price_is_from, s.duration_minutes, s.buffer_minutes,
        btrim(p_name), v_phone, btrim(p_car), btrim(coalesce(p_comment, '')), 'owner', t.status = 'preview',
        p_idempotency_key, v_hash, (select auth.uid())
      ) returning * into b;
      insert into public.resource_occupancies(tenant_id, resource_id, booking_id, kind, period, created_by)
      values (p_tenant, r.id, b.id, 'booking',
              tstzrange(b.starts_at, b.ends_at + make_interval(mins => b.buffer_minutes), '[)'), (select auth.uid()));
      v_done := true;
      exit;
    exception when exclusion_violation then
      null;
    end;
  end loop;
  if not v_done then
    perform app_private.fail('slot_taken');
  end if;
  perform app_private.log_event(p_tenant, b.id, 'created', 'owner',
    jsonb_build_object('starts_at', b.starts_at, 'resource_id', b.resource_id));
  return app_private.booking_owner_json(b) || jsonb_build_object('replayed', false);
end;
$$;

-- Atomic reschedule. The occupancy row is moved inside this transaction; if
-- the new range is taken the whole call fails and the original booking and
-- its occupancy stay exactly as they were.
create or replace function public.owner_reschedule_booking(
  p_tenant uuid,
  p_booking_id uuid,
  p_new_starts_at timestamptz,
  p_resource_id uuid default null,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  r record;
  v_new_end timestamptz;
  v_done boolean := false;
  v_old_start timestamptz;
  v_old_resource uuid;
begin
  perform app_private.require_member(p_tenant);
  select * into b from public.bookings where id = p_booking_id and tenant_id = p_tenant for update;
  if not found then perform app_private.fail('booking_not_found'); end if;

  -- idempotent replay: already at the requested place
  if b.starts_at = p_new_starts_at and (p_resource_id is null or b.resource_id = p_resource_id) then
    return app_private.booking_owner_json(b);
  end if;
  if p_expected_version is not null and b.version <> p_expected_version then
    perform app_private.fail('version_conflict', 'the booking was changed by someone else');
  end if;
  if b.status <> 'confirmed' then
    perform app_private.fail('cannot_reschedule', 'only confirmed bookings can be moved');
  end if;
  if p_new_starts_at is null then perform app_private.fail('invalid_input', 'starts_at'); end if;

  v_new_end := p_new_starts_at + make_interval(mins => b.duration_minutes);
  v_old_start := b.starts_at;
  v_old_resource := b.resource_id;

  for r in
    select res.id from public.resources res
    where res.tenant_id = p_tenant and res.is_active
      and (case when p_resource_id is not null then res.id = p_resource_id
                else exists (select 1 from public.service_resources sr where sr.service_id = b.service_id and sr.resource_id = res.id) end)
    order by (res.id = b.resource_id) desc, res.sort, res.name, res.id
  loop
    begin
      update public.resource_occupancies
         set resource_id = r.id,
             period = tstzrange(p_new_starts_at, v_new_end + make_interval(mins => b.buffer_minutes), '[)')
       where booking_id = b.id;
      if not found then
        insert into public.resource_occupancies(tenant_id, resource_id, booking_id, kind, period, created_by)
        values (p_tenant, r.id, b.id, 'booking',
                tstzrange(p_new_starts_at, v_new_end + make_interval(mins => b.buffer_minutes), '[)'), (select auth.uid()));
      end if;
      v_done := true;
      update public.bookings
         set starts_at = p_new_starts_at, ends_at = v_new_end, resource_id = r.id, version = version + 1
       where id = b.id
      returning * into b;
      exit;
    exception when exclusion_violation then
      null;
    end;
  end loop;
  if not v_done then
    perform app_private.fail('slot_taken', 'the new time is occupied');
  end if;
  perform app_private.log_event(p_tenant, b.id, 'rescheduled', 'owner', jsonb_build_object(
    'from', v_old_start, 'to', b.starts_at, 'from_resource', v_old_resource, 'to_resource', b.resource_id));
  perform app_private.sync_reminder(b.id);
  return app_private.booking_owner_json(b);
end;
$$;

create or replace function public.owner_cancel_booking(p_tenant uuid, p_booking_id uuid, p_reason text default '')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  perform app_private.require_member(p_tenant);
  select * into b from public.bookings where id = p_booking_id and tenant_id = p_tenant for update;
  if not found then perform app_private.fail('booking_not_found'); end if;
  if b.status = 'cancelled' then
    return app_private.booking_owner_json(b);
  end if;
  if b.status = 'done' then
    perform app_private.fail('cannot_cancel', 'the job is already done');
  end if;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'owner',
         cancel_reason = left(coalesce(p_reason, ''), 200), version = version + 1
   where id = b.id
  returning * into b;
  delete from public.resource_occupancies where booking_id = b.id;
  perform app_private.log_event(p_tenant, b.id, 'cancelled', 'owner', jsonb_build_object('reason', p_reason));
  perform app_private.sync_reminder(b.id);
  return app_private.booking_owner_json(b);
end;
$$;

create or replace function public.owner_set_booking_status(p_tenant uuid, p_booking_id uuid, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  v_allowed boolean;
begin
  perform app_private.require_member(p_tenant);
  select * into b from public.bookings where id = p_booking_id and tenant_id = p_tenant for update;
  if not found then perform app_private.fail('booking_not_found'); end if;
  if b.status = p_status then
    return app_private.booking_owner_json(b);
  end if;
  v_allowed := (b.status, p_status) in (
    ('confirmed', 'arrived'), ('confirmed', 'no_show'),
    ('arrived', 'done'), ('arrived', 'confirmed'),
    ('done', 'arrived'), ('no_show', 'confirmed')
  );
  if not v_allowed then
    perform app_private.fail('invalid_transition', b.status || ' -> ' || coalesce(p_status, 'null'));
  end if;
  update public.bookings
     set status = p_status,
         arrived_at = case when p_status = 'arrived' then coalesce(arrived_at, now())
                           when p_status in ('confirmed', 'no_show') then null else arrived_at end,
         completed_at = case when p_status = 'done' then now() when p_status = 'arrived' then null else completed_at end,
         version = version + 1
   where id = b.id
  returning * into b;
  perform app_private.log_event(p_tenant, b.id, 'status', 'owner', jsonb_build_object('status', p_status));
  perform app_private.sync_reminder(b.id);
  return app_private.booking_owner_json(b);
end;
$$;

create or replace function public.owner_add_payment(
  p_tenant uuid,
  p_booking_id uuid,
  p_kind text,
  p_amount_cents bigint,
  p_method text,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  p public.payments;
  v_paid bigint;
  v_refunded bigint;
begin
  perform app_private.require_member(p_tenant);
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,100}$' then
    perform app_private.fail('invalid_input', 'idempotency_key');
  end if;
  select * into b from public.bookings where id = p_booking_id and tenant_id = p_tenant for update;
  if not found then perform app_private.fail('booking_not_found'); end if;

  select * into p from public.payments where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
  if found then
    if p.booking_id <> b.id or p.kind <> p_kind or p.amount_cents <> p_amount_cents then
      perform app_private.fail('idempotency_conflict');
    end if;
    return app_private.booking_owner_json(b);
  end if;

  if p_kind not in ('payment', 'refund') then perform app_private.fail('invalid_input', 'kind'); end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then
    perform app_private.fail('invalid_input', 'amount');
  end if;
  if p_kind = 'refund' then
    select coalesce(sum(amount_cents) filter (where kind = 'payment'), 0),
           coalesce(sum(amount_cents) filter (where kind = 'refund'), 0)
      into v_paid, v_refunded
      from public.payments where booking_id = b.id;
    if p_amount_cents > v_paid - v_refunded then
      perform app_private.fail('refund_exceeds_paid');
    end if;
  end if;

  insert into public.payments(tenant_id, booking_id, kind, amount_cents, method, note, idempotency_key, is_demo, created_by)
  values (p_tenant, b.id, p_kind, p_amount_cents, coalesce(p_method, 'card'), left(coalesce(p_note, ''), 200),
          p_idempotency_key, b.is_demo, (select auth.uid()));
  perform app_private.log_event(p_tenant, b.id, p_kind, 'owner', jsonb_build_object('amount_cents', p_amount_cents));
  return app_private.booking_owner_json(b);
end;
$$;

create or replace function public.owner_block_resource(
  p_tenant uuid, p_resource_id uuid, p_from timestamptz, p_to timestamptz, p_note text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app_private.require_member(p_tenant);
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '60 days' then
    perform app_private.fail('invalid_input', 'period');
  end if;
  if not exists (select 1 from public.resources where id = p_resource_id and tenant_id = p_tenant) then
    perform app_private.fail('invalid_input', 'resource');
  end if;
  begin
    insert into public.resource_occupancies(tenant_id, resource_id, kind, period, note, created_by)
    values (p_tenant, p_resource_id, 'block', tstzrange(p_from, p_to, '[)'), left(coalesce(p_note, ''), 200), (select auth.uid()))
    returning id into v_id;
  exception when exclusion_violation then
    perform app_private.fail('slot_taken', 'the resource is busy in this period');
  end;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.owner_unblock_resource(p_tenant uuid, p_block_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_member(p_tenant);
  delete from public.resource_occupancies where id = p_block_id and tenant_id = p_tenant and kind = 'block';
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create or replace function public.owner_update_profile(p_tenant uuid, p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k text;
  v_allowed text[] := array['name','short_name','tagline','description','address','address_note','map_url',
                            'phone','info_cards','cancellation_hours','logo_path','hero_path'];
  c jsonb;
begin
  perform app_private.require_member(p_tenant);
  if jsonb_typeof(p_patch) <> 'object' then perform app_private.fail('invalid_input', 'patch'); end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not k = any(v_allowed) then perform app_private.fail('invalid_input', k); end if;
  end loop;
  if p_patch ? 'info_cards' then
    if jsonb_typeof(p_patch -> 'info_cards') <> 'array' or jsonb_array_length(p_patch -> 'info_cards') > 3 then
      perform app_private.fail('invalid_input', 'info_cards');
    end if;
    for c in select jsonb_array_elements(p_patch -> 'info_cards') loop
      if char_length(coalesce(c ->> 'title', '')) not between 1 and 40
         or char_length(coalesce(c ->> 'text', '')) > 160 then
        perform app_private.fail('invalid_input', 'info_cards');
      end if;
    end loop;
  end if;
  if p_patch ? 'logo_path' then perform app_private.check_media_path(p_tenant, p_patch ->> 'logo_path'); end if;
  if p_patch ? 'hero_path' then perform app_private.check_media_path(p_tenant, p_patch ->> 'hero_path'); end if;
  if p_patch ? 'phone' then
    p_patch := jsonb_set(p_patch, '{phone}', to_jsonb(coalesce(app_private.normalize_phone(p_patch ->> 'phone'), '')));
  end if;

  update public.tenants set
    name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else name end,
    short_name = case when p_patch ? 'short_name' then btrim(p_patch ->> 'short_name') else short_name end,
    tagline = case when p_patch ? 'tagline' then coalesce(p_patch ->> 'tagline', '') else tagline end,
    description = case when p_patch ? 'description' then coalesce(p_patch ->> 'description', '') else description end,
    address = case when p_patch ? 'address' then coalesce(p_patch ->> 'address', '') else address end,
    address_note = case when p_patch ? 'address_note' then coalesce(p_patch ->> 'address_note', '') else address_note end,
    map_url = case when p_patch ? 'map_url' then nullif(p_patch ->> 'map_url', '') else map_url end,
    phone = case when p_patch ? 'phone' then p_patch ->> 'phone' else phone end,
    info_cards = case when p_patch ? 'info_cards' then p_patch -> 'info_cards' else info_cards end,
    cancellation_hours = case when p_patch ? 'cancellation_hours' then (p_patch ->> 'cancellation_hours')::integer else cancellation_hours end,
    logo_path = case when p_patch ? 'logo_path' then nullif(p_patch ->> 'logo_path', '') else logo_path end,
    hero_path = case when p_patch ? 'hero_path' then nullif(p_patch ->> 'hero_path', '') else hero_path end,
    owner_locked = (select array_agg(distinct x) from unnest(owner_locked || array(select jsonb_object_keys(p_patch))) x)
  where id = p_tenant;
  return public.owner_get_settings(p_tenant);
exception
  when check_violation or invalid_text_representation or numeric_value_out_of_range then
    perform app_private.fail('invalid_input', sqlerrm);
    return null;
end;
$$;

create or replace function public.owner_save_resource(p_tenant uuid, p_resource jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_resource ->> 'id', '')::uuid;
begin
  perform app_private.require_member(p_tenant);
  if v_id is null then
    insert into public.resources(tenant_id, name, is_active, sort, owner_modified)
    values (p_tenant, btrim(p_resource ->> 'name'), coalesce((p_resource ->> 'is_active')::boolean, true),
            coalesce((p_resource ->> 'sort')::integer, 100), true);
  else
    update public.resources set
      name = coalesce(btrim(p_resource ->> 'name'), name),
      is_active = coalesce((p_resource ->> 'is_active')::boolean, is_active),
      sort = coalesce((p_resource ->> 'sort')::integer, sort),
      owner_modified = true
    where id = v_id and tenant_id = p_tenant;
    if not found then perform app_private.fail('not_found'); end if;
  end if;
  return public.owner_get_settings(p_tenant);
exception
  when check_violation or not_null_violation or invalid_text_representation then
    perform app_private.fail('invalid_input', sqlerrm);
    return null;
end;
$$;

create or replace function public.owner_save_service(p_tenant uuid, p_service jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_service ->> 'id', '')::uuid;
  v_resources uuid[];
begin
  perform app_private.require_member(p_tenant);
  select coalesce(array_agg(x::uuid), '{}') into v_resources
    from jsonb_array_elements_text(coalesce(p_service -> 'resource_ids', '[]'::jsonb)) x;
  if cardinality(v_resources) = 0 then
    perform app_private.fail('invalid_input', 'resource_ids');
  end if;
  if (select count(*) from public.resources where tenant_id = p_tenant and id = any(v_resources)) <> cardinality(v_resources) then
    perform app_private.fail('invalid_input', 'resource_ids');
  end if;

  if v_id is null then
    insert into public.services(tenant_id, name, description, category, price_cents, price_is_from,
                                duration_minutes, buffer_minutes, is_active, sort, owner_modified)
    values (p_tenant, btrim(p_service ->> 'name'), coalesce(p_service ->> 'description', ''),
            coalesce(p_service ->> 'category', ''), (p_service ->> 'price_cents')::bigint,
            coalesce((p_service ->> 'price_is_from')::boolean, false),
            (p_service ->> 'duration_minutes')::integer, coalesce((p_service ->> 'buffer_minutes')::integer, 0),
            coalesce((p_service ->> 'is_active')::boolean, true), coalesce((p_service ->> 'sort')::integer, 100), true)
    returning id into v_id;
  else
    update public.services set
      name = btrim(p_service ->> 'name'),
      description = coalesce(p_service ->> 'description', ''),
      category = coalesce(p_service ->> 'category', ''),
      price_cents = (p_service ->> 'price_cents')::bigint,
      price_is_from = coalesce((p_service ->> 'price_is_from')::boolean, false),
      duration_minutes = (p_service ->> 'duration_minutes')::integer,
      buffer_minutes = coalesce((p_service ->> 'buffer_minutes')::integer, 0),
      is_active = coalesce((p_service ->> 'is_active')::boolean, true),
      sort = coalesce((p_service ->> 'sort')::integer, sort),
      owner_modified = true
    where id = v_id and tenant_id = p_tenant;
    if not found then perform app_private.fail('not_found'); end if;
  end if;

  delete from public.service_resources where service_id = v_id and not (resource_id = any(v_resources));
  insert into public.service_resources(tenant_id, service_id, resource_id)
  select p_tenant, v_id, r from unnest(v_resources) r
  on conflict do nothing;
  return public.owner_get_settings(p_tenant);
exception
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    perform app_private.fail('invalid_input', sqlerrm);
    return null;
end;
$$;

create or replace function public.owner_save_hours(p_tenant uuid, p_hours jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_member(p_tenant);
  if jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) > 28 then
    perform app_private.fail('invalid_input', 'hours');
  end if;
  delete from public.working_hours where tenant_id = p_tenant;
  insert into public.working_hours(tenant_id, weekday, opens, closes)
  select p_tenant, (h ->> 'weekday')::smallint, (h ->> 'opens')::time, (h ->> 'closes')::time
  from jsonb_array_elements(p_hours) h;
  if exists (
    select 1 from public.working_hours a join public.working_hours b
      on a.tenant_id = b.tenant_id and a.weekday = b.weekday and a.id < b.id
     and a.opens < b.closes and b.opens < a.closes
    where a.tenant_id = p_tenant
  ) then
    perform app_private.fail('invalid_input', 'overlapping hours');
  end if;
  update public.tenants set owner_locked = (select array_agg(distinct x) from unnest(owner_locked || '{hours}'::text[]) x)
  where id = p_tenant;
  return public.owner_get_settings(p_tenant);
exception
  when check_violation or not_null_violation or invalid_datetime_format or invalid_text_representation then
    perform app_private.fail('invalid_input', sqlerrm);
    return null;
end;
$$;

create or replace function public.owner_save_exception(p_tenant uuid, p_exception jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_member(p_tenant);
  insert into public.schedule_exceptions(tenant_id, day, is_closed, opens, closes, note, owner_modified)
  values (p_tenant, (p_exception ->> 'day')::date, coalesce((p_exception ->> 'is_closed')::boolean, true),
          nullif(p_exception ->> 'opens', '')::time, nullif(p_exception ->> 'closes', '')::time,
          coalesce(p_exception ->> 'note', ''), true)
  on conflict (tenant_id, day) do update set
    is_closed = excluded.is_closed, opens = excluded.opens, closes = excluded.closes,
    note = excluded.note, owner_modified = true;
  return public.owner_get_settings(p_tenant);
exception
  when check_violation or not_null_violation or invalid_datetime_format then
    perform app_private.fail('invalid_input', sqlerrm);
    return null;
end;
$$;

create or replace function public.owner_delete_exception(p_tenant uuid, p_day date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_member(p_tenant);
  delete from public.schedule_exceptions where tenant_id = p_tenant and day = p_day;
  return public.owner_get_settings(p_tenant);
end;
$$;

-- Gallery: add a card, replace one photo, change one caption, delete, move.
-- Each touches exactly one row; other works stay where they are.
create or replace function public.owner_gallery_add(p_tenant uuid, p_image_path text, p_caption text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_member(p_tenant);
  perform app_private.check_media_path(p_tenant, p_image_path);
  if p_image_path is null then perform app_private.fail('invalid_input', 'image_path'); end if;
  insert into public.gallery_items(tenant_id, image_path, caption, sort, owner_modified)
  values (p_tenant, p_image_path, left(coalesce(p_caption, ''), 140),
          coalesce((select max(sort) + 1 from public.gallery_items where tenant_id = p_tenant), 0), true);
  return public.owner_get_settings(p_tenant);
end;
$$;

create or replace function public.owner_gallery_replace(p_tenant uuid, p_item_id uuid, p_image_path text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_member(p_tenant);
  perform app_private.check_media_path(p_tenant, p_image_path);
  update public.gallery_items set image_path = p_image_path, owner_modified = true
   where id = p_item_id and tenant_id = p_tenant;
  if not found then perform app_private.fail('not_found'); end if;
  return public.owner_get_settings(p_tenant);
end;
$$;

create or replace function public.owner_gallery_caption(p_tenant uuid, p_item_id uuid, p_caption text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_member(p_tenant);
  if char_length(coalesce(p_caption, '')) > 140 then perform app_private.fail('invalid_input', 'caption'); end if;
  update public.gallery_items set caption = coalesce(p_caption, ''), owner_modified = true
   where id = p_item_id and tenant_id = p_tenant;
  if not found then perform app_private.fail('not_found'); end if;
  return public.owner_get_settings(p_tenant);
end;
$$;

create or replace function public.owner_gallery_delete(p_tenant uuid, p_item_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_member(p_tenant);
  delete from public.gallery_items where id = p_item_id and tenant_id = p_tenant;
  return public.owner_get_settings(p_tenant);
end;
$$;

create or replace function public.owner_gallery_move(p_tenant uuid, p_item_id uuid, p_direction integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.gallery_items;
  b public.gallery_items;
begin
  perform app_private.require_member(p_tenant);
  select * into a from public.gallery_items where id = p_item_id and tenant_id = p_tenant for update;
  if not found then perform app_private.fail('not_found'); end if;
  if p_direction < 0 then
    select * into b from public.gallery_items where tenant_id = p_tenant and (sort, created_at) < (a.sort, a.created_at)
    order by sort desc, created_at desc limit 1 for update;
  else
    select * into b from public.gallery_items where tenant_id = p_tenant and (sort, created_at) > (a.sort, a.created_at)
    order by sort, created_at limit 1 for update;
  end if;
  if found then
    update public.gallery_items set sort = b.sort, owner_modified = true where id = a.id;
    update public.gallery_items set sort = a.sort, owner_modified = true where id = b.id;
    if a.sort = b.sort then
      update public.gallery_items set sort = a.sort + sign(p_direction)::integer where id = a.id;
    end if;
  end if;
  return public.owner_get_settings(p_tenant);
end;
$$;
