-- Beauty salons: a new studio kind. Its booking form has no car, so the car
-- becomes optional for kind 'beauty' (other kinds still require 2–80 chars).

alter table public.tenants drop constraint tenants_kind_check;
alter table public.tenants add constraint tenants_kind_check
  check (kind in ('detailing', 'service', 'tire', 'wash', 'beauty', 'other'));

alter table public.bookings drop constraint bookings_car_check;
alter table public.bookings add constraint bookings_car_check check (char_length(car) <= 80);

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
  -- a beauty salon has no car: the field is optional there
  if char_length(v_car) > 80 or (t.kind <> 'beauty' and char_length(v_car) < 2) then
    perform app_private.fail('invalid_input', 'car');
  end if;
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

