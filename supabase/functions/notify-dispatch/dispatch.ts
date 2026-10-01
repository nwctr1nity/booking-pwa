// Outbox worker logic, independent of the runtime: claim due reminder jobs
// (lease + SKIP LOCKED in SQL), send Web Push to every device of the booking,
// report the result. Completion is checked by the worker id in SQL, so a job
// whose lease expired and was taken by another run cannot be completed twice.
import { sendPush, type SendResult, type VapidKeys } from '../_shared/webpush.ts';

export interface ClaimedJob {
  job_id: string;
  attempt: number;
  booking_id: string;
  starts_at: string;
  service_name: string;
  tenant_slug: string;
  tenant_name: string;
  timezone: string;
  address: string;
  subscriptions: { endpoint: string; keys: { p256dh: string; auth: string } }[];
}

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export function reminderPayload(job: ClaimedJob) {
  const when = new Intl.DateTimeFormat('ru-RU', { timeZone: job.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(job.starts_at));
  return {
    title: `Напоминание: ${job.service_name}`,
    body: `${job.tenant_name}, ${when}${job.address ? `. ${job.address}` : ''}`,
    url: `/s/${encodeURIComponent(job.tenant_slug)}/my`,
    tag: `booking-${job.booking_id}`,
  };
}

export async function dispatch(
  rpc: Rpc,
  vapid: VapidKeys,
  opts: { worker?: string; limit?: number; leaseSeconds?: number; send?: typeof sendPush } = {},
) {
  const worker = opts.worker ?? crypto.randomUUID();
  const jobs = (await rpc('notify_claim_jobs', { p_worker: worker, p_limit: opts.limit ?? 50, p_lease_seconds: opts.leaseSeconds ?? 120 })) as ClaimedJob[];
  const send = opts.send ?? sendPush;
  const summary = { worker, claimed: jobs.length, sent: 0, failed: 0, gone: 0 };

  for (const job of jobs) {
    const payload = reminderPayload(job);
    const results: SendResult[] = await Promise.all(job.subscriptions.map((s) => send(s, payload, vapid, { ttl: 6 * 3600, topic: `b${job.booking_id.replace(/-/g, '').slice(0, 30)}` })));
    const ok = results.some((r) => r.ok);
    const gone = results.filter((r) => r.gone).map((r) => r.endpoint);
    const error = ok ? null : results.map((r) => r.error ?? `${r.status}`).join('; ').slice(0, 500) || 'no subscriptions';
    await rpc('notify_complete_job', { p_job_id: job.job_id, p_worker: worker, p_ok: ok, p_error: error, p_gone_endpoints: gone });
    if (ok) summary.sent++;
    else summary.failed++;
    summary.gone += gone.length;
  }
  return summary;
}
