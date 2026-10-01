-- Scheduling. On Supabase, pg_cron + pg_net call the notify-dispatch Edge
-- Function every 5 minutes. The URL and secret live in Supabase Vault
-- (see SETUP.md); without them the job logs a notice and does nothing.
-- On plain PostgreSQL without pg_cron this migration is a no-op.

do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron/pg_net not available: skipping schedules (local PostgreSQL)';
    return;
  end if;

  create extension if not exists pg_cron;
  create extension if not exists pg_net with schema extensions;

  execute $fn$
    create or replace function app_private.invoke_notify_dispatch()
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      v_url text;
      v_secret text;
    begin
      select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notify_dispatch_url';
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_dispatch_secret';
      if v_url is null or v_secret is null then
        raise notice 'notify-dispatch not configured in Vault';
        return;
      end if;
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      );
    end;
    $body$
  $fn$;

  perform cron.unschedule(jobid) from cron.job where jobname in ('notify-dispatch', 'rate-limit-cleanup');
  perform cron.schedule('notify-dispatch', '*/5 * * * *', 'select app_private.invoke_notify_dispatch()');
  perform cron.schedule('rate-limit-cleanup', '17 3 * * *', 'select app_private.cleanup_rate_limits()');
end
$outer$;
