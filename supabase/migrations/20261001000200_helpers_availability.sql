-- Internal helpers and the availability engine.
-- All functions use an empty search_path and fully qualified names.

-- Raise an application error the frontend can map to a message.
-- The error code is put in MESSAGE so every client sees it; HINT carries text.
create or replace function app_private.fail(code text, hint text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = code, hint = coalesce(hint, code);
end;
$$;

create or replace function app_private.tenant_by_slug(p_slug text)
returns public.tenants
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  select * into t from public.tenants where slug = lower(p_slug) and status <> 'disabled';
  if not found then
    perform app_private.fail('tenant_not_found');
  end if;
  return t;
end;
$$;

create or replace function app_private.is_member(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = p_tenant and m.user_id = (select auth.uid())
  )
$$;

create or replace function app_private.require_member(p_tenant uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not app_private.is_member(p_tenant) then
    raise exception using errcode = '42501', message = 'forbidden', hint = 'not a member of this studio';
  end if;
end;
$$;

-- Client IP as seen by PostgREST (Cloudflare / proxies first).
create or replace function app_private.request_ip()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  return coalesce(
    nullif(h ->> 'cf-connecting-ip', ''),
    nullif(h ->> 'x-real-ip', ''),
    nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''),
    'unknown'
  );
end;
$$;

create or replace function app_private.cleanup_rate_limits()
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (
    delete from app_private.rate_limit_counters where window_start < now() - interval '1 day' returning 1
  ) select count(*)::integer from d
$$;

-- Tokens: derived with HMAC from (tenant, idempotency key) so a retried request
-- gets the same token back, while the database stores only its SHA-256.
create or replace function app_private.derive_access_token(p_tenant uuid, p_idempotency_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select translate(rtrim(encode(
    extensions.hmac(p_tenant::text || ':' || p_idempotency_key,
                    (select value from app_private.secrets where name = 'booking_token_key'),
                    'sha256'), 'base64'), '='), '+/', '-_')
$$;

create or replace function app_private.hash_token(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select extensions.digest(p_token, 'sha256')
$$;

create or replace function app_private.normalize_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null then null
    else (case when left(trim(p), 1) = '+' then '+' else '' end) || regexp_replace(p, '[^0-9]', '', 'g')
  end
$$;

-- Local-day bounds of a studio as timestamptz [start, end).
create or replace function app_private.local_day_range(p_tz text, p_from date, p_to date)
returns tstzrange
language sql
immutable
set search_path = ''
as $$
  select tstzrange((p_from::timestamp) at time zone p_tz, ((p_to + 1)::timestamp) at time zone p_tz, '[)')
$$;

-- Working intervals for one local date: exception first, weekly hours otherwise.
create or replace function app_private.day_intervals(p_tenant uuid, p_day date)
returns table (opens time, closes time)
language sql
stable
security definer
set search_path = ''
as $$
  with ex as (
    select * from public.schedule_exceptions e where e.tenant_id = p_tenant and e.day = p_day
  )
  select e.opens, e.closes from ex e where not e.is_closed
  union all
  select h.opens, h.closes
  from public.working_hours h
  where h.tenant_id = p_tenant
    and h.weekday = extract(isodow from p_day)::smallint
    and not exists (select 1 from ex)
$$;

-- Candidate start moments for a service between two local dates, with the
-- first suitable free resource for each. Rules:
--  * starts lie on the slot grid inside a working interval (opens <= t < closes);
--  * a job that fits in the interval must also finish by its close;
--    longer jobs (e.g. two days) run on continuously and occupy the resource
--    for the whole duration plus the buffer;
--  * a start must respect min notice and the booking horizon;
--  * a resource is free when no occupancy (booking or block) overlaps
--    [start, start + duration + buffer).
create or replace function app_private.compute_slots(
  p_tenant uuid,
  p_service uuid,
  p_from date,
  p_to date,
  p_ignore_booking uuid default null,
  p_enforce_notice boolean default true
)
returns table (starts_at timestamptz, resource_id uuid, available boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select * from public.tenants where id = p_tenant
  ),
  s as (
    select sv.* from public.services sv where sv.id = p_service and sv.tenant_id = p_tenant
  ),
  days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  ),
  iv as (
    select days.day,
           (extract(epoch from i.opens) / 60)::integer as open_m,
           (extract(epoch from i.closes) / 60)::integer as close_m
    from days cross join lateral app_private.day_intervals(p_tenant, days.day) i
  ),
  cand as (
    select distinct
      (iv.day::timestamp + make_interval(mins => iv.open_m + g * t.slot_step_minutes)) at time zone t.timezone as starts_at,
      s.duration_minutes, s.buffer_minutes
    from iv
    cross join t
    cross join s
    cross join lateral generate_series(0, (iv.close_m - iv.open_m - 1) / t.slot_step_minutes) g
    where iv.open_m + g * t.slot_step_minutes < iv.close_m
      and (
        -- a job that fits into the interval must finish by its close;
        -- a longer job (e.g. two days) runs on continuously
        s.duration_minutes > iv.close_m - iv.open_m
        or iv.open_m + g * t.slot_step_minutes + s.duration_minutes <= iv.close_m
      )
  )
  select c.starts_at,
         r.id as resource_id,
         r.id is not null as available
  from cand c
  cross join t
  left join lateral (
    select res.id
    from public.service_resources sr
    join public.resources res on res.id = sr.resource_id and res.tenant_id = p_tenant and res.is_active
    where sr.service_id = p_service and sr.tenant_id = p_tenant
      and not exists (
        select 1 from public.resource_occupancies o
        where o.resource_id = res.id
          and o.period && tstzrange(c.starts_at,
                                    c.starts_at + make_interval(mins => c.duration_minutes + c.buffer_minutes), '[)')
          and (p_ignore_booking is null or o.booking_id is distinct from p_ignore_booking)
      )
    order by res.sort, res.name, res.id
    limit 1
  ) r on true
  where (not p_enforce_notice or c.starts_at >= now() + make_interval(mins => t.min_notice_minutes))
    and (not p_enforce_notice or c.starts_at < now() + make_interval(days => t.horizon_days))
  order by c.starts_at
$$;

-- Is p_start one of the schedule's acceptance moments for this service?
create or replace function app_private.is_valid_start(p_tenant uuid, p_service uuid, p_start timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenants t
    cross join lateral app_private.compute_slots(
      p_tenant, p_service,
      ((p_start at time zone t.timezone)::date),
      ((p_start at time zone t.timezone)::date)
    ) c
    where t.id = p_tenant and c.starts_at = p_start
  )
$$;

create or replace function app_private.log_event(
  p_tenant uuid, p_booking uuid, p_type text, p_actor text, p_data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.booking_events(tenant_id, booking_id, type, actor, actor_id, data)
  values (p_tenant, p_booking, p_type, p_actor, (select auth.uid()), coalesce(p_data, '{}'::jsonb))
$$;
