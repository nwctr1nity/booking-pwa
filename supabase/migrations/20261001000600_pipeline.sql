-- Tenant pipeline API, callable only with the service_role key by the
-- tenant:* scripts. business.json is the input; the database is the runtime
-- source. Re-publishing never touches bookings, payments, owner uploads or
-- anything the owner edited in the cabinet.

create or replace function public.pipeline_publish_tenant(p_config jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c jsonb := p_config;
  t public.tenants;
  v_locked text[];
  v_skipped text[] := '{}';
  v_media jsonb := '[]'::jsonb;
  r jsonb;
  s jsonb;
  g jsonb;
  d jsonb;
  v_day text;
  v_iso smallint;
  v_sid uuid;
  v_i integer;
  v_logo text;
  v_hero text;
  v_created boolean;
  v_days text[] := array['mon','tue','wed','thu','fri','sat','sun'];
begin
  if coalesce(c ->> 'slug', '') = '' then perform app_private.fail('invalid_input', 'slug'); end if;

  select * into t from public.tenants where slug = c ->> 'slug' for update;
  v_created := not found;
  v_locked := coalesce(t.owner_locked, '{}');

  if v_created then
    insert into public.tenants(slug, name, short_name, kind, timezone, currency, locale, accent_color, status)
    values (c ->> 'slug', c ->> 'name', c ->> 'short_name', coalesce(c ->> 'kind', 'detailing'),
            c ->> 'timezone', coalesce(c ->> 'currency', 'RUB'), coalesce(c ->> 'locale', 'ru-RU'),
            coalesce(c ->> 'accent_color', '#4690FF'), 'preview')
    returning * into t;
  end if;

  v_logo := case when c #>> '{images,logo}' is not null
                 then t.id::text || '/config/' || regexp_replace(c #>> '{images,logo}', '^.*/', '') end;
  v_hero := case when c #>> '{images,hero}' is not null
                 then t.id::text || '/config/' || regexp_replace(c #>> '{images,hero}', '^.*/', '') end;

  update public.tenants set
    name = case when 'name' = any(v_locked) then name else c ->> 'name' end,
    short_name = case when 'short_name' = any(v_locked) then short_name else c ->> 'short_name' end,
    kind = coalesce(c ->> 'kind', kind),
    timezone = c ->> 'timezone',
    currency = coalesce(c ->> 'currency', currency),
    locale = coalesce(c ->> 'locale', locale),
    accent_color = coalesce(c ->> 'accent_color', accent_color),
    tagline = case when 'tagline' = any(v_locked) then tagline else coalesce(c ->> 'tagline', '') end,
    description = case when 'description' = any(v_locked) then description else coalesce(c ->> 'description', '') end,
    address = case when 'address' = any(v_locked) then address else coalesce(c #>> '{contacts,address}', '') end,
    address_note = case when 'address_note' = any(v_locked) then address_note else coalesce(c #>> '{contacts,address_note}', '') end,
    map_url = case when 'map_url' = any(v_locked) then map_url else c #>> '{contacts,map_url}' end,
    phone = case when 'phone' = any(v_locked) then phone else coalesce(app_private.normalize_phone(c #>> '{contacts,phone}'), '') end,
    info_cards = case when 'info_cards' = any(v_locked) then info_cards else coalesce(c -> 'info_cards', '[]'::jsonb) end,
    cancellation_hours = case when 'cancellation_hours' = any(v_locked) then cancellation_hours
                              else coalesce((c #>> '{booking,cancellation_hours}')::integer, cancellation_hours) end,
    slot_step_minutes = coalesce((c #>> '{booking,slot_step_minutes}')::integer, slot_step_minutes),
    min_notice_minutes = coalesce((c #>> '{booking,min_notice_minutes}')::integer, min_notice_minutes),
    horizon_days = coalesce((c #>> '{booking,horizon_days}')::integer, horizon_days),
    reminder_hours = coalesce((c #>> '{booking,reminder_hours}')::integer, reminder_hours),
    logo_path = case when 'logo_path' = any(v_locked) then logo_path else v_logo end,
    hero_path = case when 'hero_path' = any(v_locked) then hero_path else v_hero end,
    config_hash = c ->> 'config_hash',
    published_at = now()
  where id = t.id
  returning * into t;

  select v_skipped || array(select 'tenant.' || x from unnest(v_locked) x) into v_skipped;
  if v_logo is not null and not ('logo_path' = any(v_locked)) then
    v_media := v_media || jsonb_build_object('file', c #>> '{images,logo}', 'path', v_logo);
  end if;
  if v_hero is not null and not ('hero_path' = any(v_locked)) then
    v_media := v_media || jsonb_build_object('file', c #>> '{images,hero}', 'path', v_hero);
  end if;

  -- resources
  v_i := 0;
  for r in select * from jsonb_array_elements(coalesce(c -> 'resources', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.resources(tenant_id, key, name, sort, is_active)
    values (t.id, r ->> 'key', r ->> 'name', v_i, true)
    on conflict (tenant_id, key) do update
      set name = excluded.name, sort = excluded.sort, is_active = true
      where not public.resources.owner_modified;
    if exists (select 1 from public.resources where tenant_id = t.id and key = r ->> 'key' and owner_modified) then
      v_skipped := v_skipped || ('resource.' || (r ->> 'key'));
    end if;
  end loop;
  update public.resources set is_active = false
   where tenant_id = t.id and key is not null and not owner_modified
     and not (key = any(array(select x ->> 'key' from jsonb_array_elements(coalesce(c -> 'resources', '[]'::jsonb)) x)));

  -- services (prices in major units in the file, cents in the database)
  v_i := 0;
  for s in select * from jsonb_array_elements(coalesce(c -> 'services', '[]'::jsonb)) loop
    v_i := v_i + 1;
    if exists (select 1 from public.services where tenant_id = t.id and key = s ->> 'key' and owner_modified) then
      v_skipped := v_skipped || ('service.' || (s ->> 'key'));
      continue;
    end if;
    insert into public.services(tenant_id, key, name, description, category, price_cents, price_is_from,
                                duration_minutes, buffer_minutes, is_active, sort)
    values (t.id, s ->> 'key', s ->> 'name', coalesce(s ->> 'description', ''), coalesce(s ->> 'category', ''),
            round((s ->> 'price')::numeric * 100)::bigint, coalesce((s ->> 'price_is_from')::boolean, false),
            (s ->> 'duration_minutes')::integer, coalesce((s ->> 'buffer_minutes')::integer, 0), true, v_i)
    on conflict (tenant_id, key) do update set
      name = excluded.name, description = excluded.description, category = excluded.category,
      price_cents = excluded.price_cents, price_is_from = excluded.price_is_from,
      duration_minutes = excluded.duration_minutes, buffer_minutes = excluded.buffer_minutes,
      is_active = true, sort = excluded.sort
    returning id into v_sid;

    delete from public.service_resources where service_id = v_sid;
    insert into public.service_resources(tenant_id, service_id, resource_id)
    select t.id, v_sid, res.id
    from public.resources res
    where res.tenant_id = t.id
      and res.key = any(array(select jsonb_array_elements_text(coalesce(s -> 'resources', '[]'::jsonb))));
  end loop;
  update public.services set is_active = false
   where tenant_id = t.id and key is not null and not owner_modified
     and not (key = any(array(select x ->> 'key' from jsonb_array_elements(coalesce(c -> 'services', '[]'::jsonb)) x)));

  -- weekly hours
  if 'hours' = any(v_locked) then
    v_skipped := v_skipped || 'hours'::text;
  else
    delete from public.working_hours where tenant_id = t.id;
    for v_iso in 1..7 loop
      v_day := v_days[v_iso];
      for d in select * from jsonb_array_elements(coalesce(c #> array['hours', v_day], '[]'::jsonb)) loop
        insert into public.working_hours(tenant_id, weekday, opens, closes)
        values (t.id, v_iso, (d ->> 0)::time, (d ->> 1)::time);
      end loop;
    end loop;
  end if;

  -- closed dates / special days (owner-edited days are kept)
  for d in select * from jsonb_array_elements(coalesce(c -> 'closed_dates', '[]'::jsonb)) loop
    insert into public.schedule_exceptions(tenant_id, day, is_closed, opens, closes, note)
    values (t.id, (d ->> 'date')::date, d ->> 'opens' is null,
            (d ->> 'opens')::time, (d ->> 'closes')::time, coalesce(d ->> 'note', ''))
    on conflict (tenant_id, day) do update set
      is_closed = excluded.is_closed, opens = excluded.opens, closes = excluded.closes, note = excluded.note
      where not public.schedule_exceptions.owner_modified;
  end loop;

  -- gallery: config cards by key; owner cards (key null) and owner-edited cards stay
  v_i := 0;
  for g in select * from jsonb_array_elements(coalesce(c -> 'gallery', '[]'::jsonb)) loop
    v_i := v_i + 1;
    if exists (select 1 from public.gallery_items where tenant_id = t.id and key = g ->> 'key' and owner_modified) then
      v_skipped := v_skipped || ('gallery.' || (g ->> 'key'));
      continue;
    end if;
    insert into public.gallery_items(tenant_id, key, image_path, caption, sort)
    values (t.id, g ->> 'key', t.id::text || '/config/' || regexp_replace(g ->> 'image', '^.*/', ''),
            coalesce(g ->> 'caption', ''), v_i)
    on conflict (tenant_id, key) do update set
      image_path = excluded.image_path, caption = excluded.caption, sort = excluded.sort;
    v_media := v_media || jsonb_build_object('file', g ->> 'image',
                 'path', t.id::text || '/config/' || regexp_replace(g ->> 'image', '^.*/', ''));
  end loop;
  delete from public.gallery_items
   where tenant_id = t.id and key is not null and not owner_modified
     and not (key = any(array(select x ->> 'key' from jsonb_array_elements(coalesce(c -> 'gallery', '[]'::jsonb)) x)));

  return jsonb_build_object(
    'tenant_id', t.id,
    'slug', t.slug,
    'status', t.status,
    'created', v_created,
    'media', v_media,
    'skipped_owner_edits', to_jsonb(v_skipped)
  );
end;
$$;

-- Going live removes the demo bookings (and with them demo payments, jobs and
-- subscriptions). Going back to preview keeps real data untouched.
create or replace function public.pipeline_set_status(p_slug text, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_deleted integer := 0;
begin
  select * into t from public.tenants where slug = p_slug for update;
  if not found then perform app_private.fail('tenant_not_found'); end if;
  if p_status not in ('preview', 'live', 'disabled') then perform app_private.fail('invalid_input', 'status'); end if;
  if p_status = 'live' and t.status <> 'live' then
    with d as (delete from public.bookings where tenant_id = t.id and is_demo returning 1)
    select count(*) into v_deleted from d;
  end if;
  update public.tenants
     set status = p_status,
         activated_at = case when p_status = 'live' then coalesce(activated_at, now()) else activated_at end
   where id = t.id
  returning * into t;
  return jsonb_build_object('slug', t.slug, 'status', t.status, 'demo_bookings_removed', v_deleted);
end;
$$;

create or replace function public.pipeline_add_member(p_slug text, p_user_id uuid, p_role text default 'owner')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.tenants;
begin
  select * into t from public.tenants where slug = p_slug;
  if not found then perform app_private.fail('tenant_not_found'); end if;
  insert into public.tenant_members(tenant_id, user_id, role) values (t.id, p_user_id, coalesce(p_role, 'owner'))
  on conflict (tenant_id, user_id) do update set role = excluded.role;
  return jsonb_build_object('tenant_id', t.id, 'user_id', p_user_id, 'role', coalesce(p_role, 'owner'));
end;
$$;

create or replace function public.pipeline_tenant_summary(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'slug', t.slug, 'status', t.status, 'name', t.name, 'config_hash', t.config_hash,
    'published_at', t.published_at, 'activated_at', t.activated_at,
    'logo_path', t.logo_path, 'hero_path', t.hero_path,
    'services_active', (select count(*) from public.services s where s.tenant_id = t.id and s.is_active),
    'resources_active', (select count(*) from public.resources r where r.tenant_id = t.id and r.is_active),
    'hours_rows', (select count(*) from public.working_hours h where h.tenant_id = t.id),
    'gallery', (select count(*) from public.gallery_items g where g.tenant_id = t.id),
    'members', (select count(*) from public.tenant_members m where m.tenant_id = t.id),
    'bookings_demo', (select count(*) from public.bookings b where b.tenant_id = t.id and b.is_demo),
    'bookings_real', (select count(*) from public.bookings b where b.tenant_id = t.id and not b.is_demo),
    'bookable_services_without_resource', (
      select count(*) from public.services s where s.tenant_id = t.id and s.is_active
        and not exists (select 1 from public.service_resources sr join public.resources r on r.id = sr.resource_id and r.is_active
                        where sr.service_id = s.id))
  )
  from public.tenants t where t.slug = p_slug
$$;

-- Demo bookings for a preview studio: a few finished and paid jobs in the past
-- week and upcoming ones, all flagged is_demo. Used by seed.sql and by
-- tenant:publish --demo. Does nothing for a live studio.
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
    if v_status = 'done' then
      insert into public.payments(tenant_id, booking_id, kind, amount_cents, method, paid_at, idempotency_key, is_demo)
      values (t.id, v_id, 'payment', s.price_cents, case when i % 2 = 0 then 'card' else 'cash' end,
              v_start + make_interval(mins => s.duration_minutes), 'demo-pay-' || v_id, true);
    end if;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('created', v_n);
end;
$$;
