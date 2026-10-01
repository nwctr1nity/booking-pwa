-- Reminder outbox. A job exists only when the booking has at least one push
-- subscription. Reschedule/cancel cancel the outdated job; the dedupe key
-- includes the start time so a moved booking gets exactly one new job.
-- Preview (demo) studios get 'suppressed' jobs: visible, never delivered.

create or replace function app_private.reminder_key(b public.bookings)
returns text
language sql
immutable
set search_path = ''
as $$
  select b.id::text || ':reminder:' || floor(extract(epoch from b.starts_at))::bigint::text
$$;

create or replace function app_private.reminder_state(p_booking uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  j public.notification_jobs;
  v_subs integer;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  select count(*) into v_subs from public.push_subscriptions where booking_id = p_booking;
  select * into j from public.notification_jobs where dedupe_key = app_private.reminder_key(b);
  return jsonb_build_object(
    'subscriptions', v_subs,
    'run_at', j.run_at,
    'state', case
      when b.status <> 'confirmed' then 'inactive'
      when v_subs = 0 then 'not_subscribed'
      when j.id is null then 'too_late'
      when j.status = 'suppressed' then 'preview'
      when j.status in ('pending', 'processing') then 'scheduled'
      when j.status = 'sent' then 'sent'
      when j.status = 'failed' then 'failed'
      else 'not_subscribed'
    end
  );
end;
$$;

create or replace function app_private.sync_reminder(p_booking uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  t public.tenants;
  v_key text;
  v_run timestamptz;
  v_suppress boolean;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then return; end if;
  select * into t from public.tenants where id = b.tenant_id;
  v_key := app_private.reminder_key(b);
  v_run := b.starts_at - make_interval(hours => t.reminder_hours);

  -- anything not matching the current start time is obsolete
  update public.notification_jobs
     set status = 'cancelled', last_error = 'booking moved', lease_until = null
   where booking_id = b.id and status in ('pending', 'processing', 'suppressed') and dedupe_key <> v_key;

  if b.status <> 'confirmed'
     or not exists (select 1 from public.push_subscriptions s where s.booking_id = b.id) then
    update public.notification_jobs
       set status = 'cancelled',
           last_error = case when b.status <> 'confirmed' then 'booking ' || b.status else 'unsubscribed' end,
           lease_until = null
     where booking_id = b.id and status in ('pending', 'processing', 'suppressed');
    return;
  end if;

  if v_run <= now() then
    return; -- less than reminder_hours left: nothing to schedule
  end if;

  v_suppress := t.status <> 'live' or b.is_demo;
  insert into public.notification_jobs(tenant_id, booking_id, run_at, status, dedupe_key, last_error)
  values (b.tenant_id, b.id, v_run,
          case when v_suppress then 'suppressed' else 'pending' end,
          v_key,
          case when v_suppress then 'preview studio: notifications are not delivered' end)
  on conflict (dedupe_key) do update
     set status = excluded.status, last_error = excluded.last_error, run_at = excluded.run_at,
         attempts = 0, lease_until = null, locked_by = null
   where public.notification_jobs.status = 'cancelled';
end;
$$;

create or replace function app_private.bookings_sync_reminder_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.sync_reminder(new.id);
  return null;
end;
$$;

create trigger bookings_sync_reminder
  after update of status, starts_at on public.bookings
  for each row
  when (old.status is distinct from new.status or old.starts_at is distinct from new.starts_at)
  execute function app_private.bookings_sync_reminder_trg();

-- ---------------------------------------------------------------------------
-- Worker API (service_role only): claim with a lease, then complete.
-- ---------------------------------------------------------------------------
create or replace function public.notify_claim_jobs(p_worker text, p_limit integer default 20, p_lease_seconds integer default 120)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_result jsonb;
begin
  if coalesce(p_worker, '') = '' then perform app_private.fail('invalid_input', 'worker'); end if;

  -- drop jobs whose booking no longer matches (defensive; triggers normally do this)
  update public.notification_jobs j
     set status = 'cancelled', last_error = 'stale at claim', lease_until = null
    from public.bookings b
   where b.id = j.booking_id
     and j.status in ('pending', 'processing')
     and (b.status <> 'confirmed' or j.dedupe_key <> app_private.reminder_key(b));

  with due as (
    select id from public.notification_jobs
    where ((status = 'pending' and run_at <= now())
        or (status = 'processing' and lease_until < now()))
    order by run_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.notification_jobs j
     set status = 'processing',
         locked_by = p_worker,
         lease_until = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 900))),
         attempts = j.attempts + 1
    from due
   where j.id = due.id;

  select coalesce(array_agg(id), '{}') into v_ids
    from public.notification_jobs where locked_by = p_worker and status = 'processing' and lease_until > now();

  select coalesce(jsonb_agg(jsonb_build_object(
      'job_id', j.id,
      'attempt', j.attempts,
      'booking_id', b.id,
      'starts_at', b.starts_at,
      'service_name', b.service_name,
      'tenant_slug', t.slug,
      'tenant_name', t.name,
      'timezone', t.timezone,
      'address', t.address,
      'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint,
                                   'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
                                 from public.push_subscriptions s where s.booking_id = b.id), '[]'::jsonb)
    )), '[]'::jsonb)
    into v_result
    from public.notification_jobs j
    join public.bookings b on b.id = j.booking_id
    join public.tenants t on t.id = j.tenant_id
   where j.id = any(v_ids);
  return v_result;
end;
$$;

create or replace function public.notify_complete_job(
  p_job_id uuid, p_worker text, p_ok boolean, p_error text default null, p_gone_endpoints text[] default '{}'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  j public.notification_jobs;
begin
  select * into j from public.notification_jobs where id = p_job_id for update;
  if not found or j.locked_by is distinct from p_worker or j.status <> 'processing' then
    return jsonb_build_object('updated', false); -- lease lost or job cancelled meanwhile
  end if;
  if coalesce(array_length(p_gone_endpoints, 1), 0) > 0 then
    delete from public.push_subscriptions where booking_id = j.booking_id and endpoint = any(p_gone_endpoints);
  end if;
  if p_ok then
    update public.notification_jobs set status = 'sent', sent_at = now(), lease_until = null, last_error = null
     where id = j.id;
  elsif j.attempts >= j.max_attempts
        or not exists (select 1 from public.push_subscriptions where booking_id = j.booking_id) then
    update public.notification_jobs set status = 'failed', lease_until = null, last_error = left(p_error, 500)
     where id = j.id;
  else
    update public.notification_jobs
       set status = 'pending', lease_until = null, locked_by = null, last_error = left(p_error, 500),
           run_at = now() + make_interval(mins => power(2, j.attempts)::integer)
     where id = j.id;
  end if;
  return jsonb_build_object('updated', true);
end;
$$;
