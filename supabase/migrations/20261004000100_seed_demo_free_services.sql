-- Demo bookings for free services (e.g. «Осмотр и расчёт стоимости», 0 ₸) no
-- longer get a 0 payment, which the payments amount check rejects.

create or replace function public.pipeline_seed_demo(p_slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  s record;
  v_start timestamptz;
  v_res uuid;
  v_id uuid;
  v_n integer := 0;
  v_names text[] := array['Алексей','Марина','Игорь','Ольга','Дмитрий','Наталья','Сергей','Екатерина'];
  v_cars text[] := array['BMW X5 · А123ВС77','Kia K5 · М456ОР199','Toyota Camry · Е789КХ750','Audi Q7 · Т321УХ77',
                         'Lada Vesta · В654НК178','Mercedes GLE · О987РА77','Hyundai Tucson · К246МЕ197','VW Polo · Н135СТ50'];
  i integer;
  v_status text;
begin
  select * into t from public.tenants where slug = p_slug;
  if not found then perform app_private.fail('tenant_not_found'); end if;
  if t.status <> 'preview' then
    return jsonb_build_object('created', 0, 'reason', 'studio is live');
  end if;
  delete from public.bookings where tenant_id = t.id and is_demo;

  for i in 0..7 loop
    select sv.* into s from public.services sv
    where sv.tenant_id = t.id and sv.is_active and sv.duration_minutes <= 480
    order by sv.sort offset (i % 3) limit 1;
    if not found then exit; end if;
    -- -6..+4 days, 10:00 / 14:00 local
    v_start := ((((now() at time zone t.timezone)::date + (i - 5))::timestamp
                + make_interval(hours => case when i % 2 = 0 then 10 else 14 end)) at time zone t.timezone);
    select r.id into v_res
    from public.service_resources sr join public.resources r on r.id = sr.resource_id and r.is_active
    where sr.service_id = s.id
      and not exists (select 1 from public.resource_occupancies o where o.resource_id = r.id
                      and o.period && tstzrange(v_start, v_start + make_interval(mins => s.duration_minutes + s.buffer_minutes), '[)'))
    order by r.sort limit 1;
    continue when v_res is null;
    v_status := case when v_start + make_interval(mins => s.duration_minutes) < now() then 'done'
                     when v_start < now() then 'arrived' else 'confirmed' end;
    insert into public.bookings(tenant_id, service_id, resource_id, status, starts_at, ends_at, service_name,
      price_cents, price_is_from, duration_minutes, buffer_minutes, customer_name, customer_phone, car, source,
      is_demo, idempotency_key, request_hash, arrived_at, completed_at)
    values (t.id, s.id, v_res, v_status, v_start, v_start + make_interval(mins => s.duration_minutes), s.name,
      s.price_cents, s.price_is_from, s.duration_minutes, s.buffer_minutes, v_names[i + 1],
      '+7900000' || lpad((1000 + i)::text, 4, '0'), v_cars[i + 1], 'demo', true,
      'demo-' || t.id || '-' || i, 'demo',
      case when v_status in ('arrived', 'done') then v_start end,
      case when v_status = 'done' then v_start + make_interval(mins => s.duration_minutes) end)
    returning id into v_id;
    insert into public.resource_occupancies(tenant_id, resource_id, booking_id, kind, period)
    values (t.id, v_res, v_id, 'booking',
            tstzrange(v_start, v_start + make_interval(mins => s.duration_minutes + s.buffer_minutes), '[)'));
    if v_status = 'done' and s.price_cents > 0 then
      insert into public.payments(tenant_id, booking_id, kind, amount_cents, method, paid_at, idempotency_key, is_demo)
      values (t.id, v_id, 'payment', s.price_cents, case when i % 2 = 0 then 'card' else 'cash' end,
              v_start + make_interval(mins => s.duration_minutes), 'demo-pay-' || v_id, true);
    end if;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('created', v_n);
end;
$$;
