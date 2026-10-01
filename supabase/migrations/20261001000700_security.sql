-- Access control.
--  * anon: no table access at all; only the public_* functions.
--  * authenticated: read-only SELECT on its own tenants' rows through RLS
--    (defence in depth); all writes go through owner_* functions that check
--    membership. Personal data, payments, tokens and jobs never reach anon.
--  * service_role: pipeline_* and notify_* functions (server scripts and the
--    notify-dispatch Edge Function only).

-- Supabase grants broad defaults on schema public; take them back.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

revoke all on schema app_private from public, anon, authenticated;
revoke all on all tables in schema app_private from public, anon, authenticated;
revoke execute on all functions in schema app_private from public, anon, authenticated;
alter default privileges in schema app_private revoke execute on functions from public;

-- Row level security on every table (no policy = no rows).
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.resources enable row level security;
alter table public.services enable row level security;
alter table public.service_resources enable row level security;
alter table public.working_hours enable row level security;
alter table public.schedule_exceptions enable row level security;
alter table public.gallery_items enable row level security;
alter table public.bookings enable row level security;
alter table public.resource_occupancies enable row level security;
alter table public.payments enable row level security;
alter table public.booking_events enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_jobs enable row level security;

-- Membership helper usable inside policies.
create or replace function public.current_user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tenant_id from public.tenant_members where user_id = (select auth.uid())
$$;
revoke execute on function public.current_user_tenant_ids() from public, anon;
grant execute on function public.current_user_tenant_ids() to authenticated;

grant select on public.tenants, public.tenant_members, public.resources, public.services,
  public.service_resources, public.working_hours, public.schedule_exceptions, public.gallery_items,
  public.bookings, public.resource_occupancies, public.payments, public.booking_events
  to authenticated;

create policy member_read on public.tenants for select to authenticated
  using (id in (select public.current_user_tenant_ids()));
create policy member_read on public.tenant_members for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
create policy member_read on public.resources for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
create policy member_read on public.services for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
create policy member_read on public.service_resources for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
create policy member_read on public.working_hours for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
create policy member_read on public.schedule_exceptions for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
create policy member_read on public.gallery_items for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
create policy member_read on public.bookings for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
create policy member_read on public.resource_occupancies for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
create policy member_read on public.payments for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
create policy member_read on public.booking_events for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
-- The token hash column is not readable even by members.
revoke select (access_token_hash, request_hash) on public.bookings from authenticated;
revoke select on public.bookings from authenticated;
grant select (id, tenant_id, service_id, resource_id, status, starts_at, ends_at, service_name, price_cents,
  price_is_from, duration_minutes, buffer_minutes, customer_name, customer_phone, car, comment, source, is_demo,
  version, arrived_at, completed_at, cancelled_at, cancelled_by, cancel_reason, created_by, created_at, updated_at)
  on public.bookings to authenticated;

-- Function grants -----------------------------------------------------------
grant execute on function
  public.public_get_studio(text),
  public.public_get_slots(text, uuid, date, integer),
  public.public_create_booking(text, uuid, timestamptz, text, text, text, text, text),
  public.public_get_booking(text, text),
  public.public_cancel_booking(text, text),
  public.public_save_push_subscription(text, text, text, text, text),
  public.public_remove_push_subscription(text, text, text)
to anon, authenticated;

grant execute on function
  public.owner_my_tenants(),
  public.owner_get_bookings(uuid, date, date),
  public.owner_get_stats(uuid, date, date),
  public.owner_get_settings(uuid),
  public.owner_create_booking(uuid, uuid, timestamptz, uuid, text, text, text, text, text),
  public.owner_reschedule_booking(uuid, uuid, timestamptz, uuid, integer),
  public.owner_cancel_booking(uuid, uuid, text),
  public.owner_set_booking_status(uuid, uuid, text),
  public.owner_add_payment(uuid, uuid, text, bigint, text, text, text),
  public.owner_block_resource(uuid, uuid, timestamptz, timestamptz, text),
  public.owner_unblock_resource(uuid, uuid),
  public.owner_update_profile(uuid, jsonb),
  public.owner_save_resource(uuid, jsonb),
  public.owner_save_service(uuid, jsonb),
  public.owner_save_hours(uuid, jsonb),
  public.owner_save_exception(uuid, jsonb),
  public.owner_delete_exception(uuid, date),
  public.owner_gallery_add(uuid, text, text),
  public.owner_gallery_replace(uuid, uuid, text),
  public.owner_gallery_caption(uuid, uuid, text),
  public.owner_gallery_delete(uuid, uuid),
  public.owner_gallery_move(uuid, uuid, integer)
to authenticated;

grant execute on function
  public.pipeline_publish_tenant(jsonb),
  public.pipeline_set_status(text, text),
  public.pipeline_add_member(text, uuid, text),
  public.pipeline_tenant_summary(text),
  public.pipeline_seed_demo(text),
  public.notify_claim_jobs(text, integer, integer),
  public.notify_complete_job(uuid, text, boolean, text, text[])
to service_role;

-- service_role keeps full table access for maintenance (it bypasses RLS).
grant all on all tables in schema public to service_role;
grant usage on schema app_private to service_role;
grant execute on function app_private.cleanup_rate_limits() to service_role;
