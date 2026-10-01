import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createOwner, createTestDb, service, user, type TestDb } from './harness.ts';
import { book, monday, msk, setupStudio } from './fixtures.ts';

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

const sub = (n: number) => ({
  p_endpoint: `https://push.example.test/send/${n}`,
  p_p256dh: 'B'.repeat(87),
  p_auth: 'A'.repeat(22),
});
const jobs = (bookingId: string) =>
  db.admin(`select status, run_at, dedupe_key, attempts, last_error from public.notification_jobs where booking_id = $1 order by created_at`, [bookingId]);

describe('reminder outbox', () => {
  it('subscription schedules exactly one reminder 24h before; repeat subscribe is deduplicated', async () => {
    const s = await setupStudio(db, 'ob-basic');
    const b = await book(db, anon(), s.slug, s.service.wash, msk(monday(), '12:00'));
    expect(b.reminder.state).toBe('not_subscribed');
    const st = await db.rpc(anon(), 'public_save_push_subscription', { p_slug: s.slug, p_token: b.access_token, ...sub(1) });
    expect(st.state).toBe('scheduled');
    await db.rpc(anon(), 'public_save_push_subscription', { p_slug: s.slug, p_token: b.access_token, ...sub(1) });
    const list = await jobs(b.id);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('pending');
    expect(new Date(list[0].run_at).toISOString()).toBe(new Date(new Date(msk(monday(), '12:00')).getTime() - 24 * 3600_000).toISOString());
  });

  it('reschedule cancels the old job and creates one for the new time; cancel cancels it', async () => {
    const s = await setupStudio(db, 'ob-move');
    const owner = await createOwner(db, 'ob@x.test', s.slug);
    const b = await book(db, anon(), s.slug, s.service.wash, msk(monday(), '12:00'));
    await db.rpc(anon(), 'public_save_push_subscription', { p_slug: s.slug, p_token: b.access_token, ...sub(2) });
    await db.rpc(user(owner), 'owner_reschedule_booking', { p_tenant: s.id, p_booking_id: b.id, p_new_starts_at: msk(monday(), '15:00') });
    let list = await jobs(b.id);
    expect(list.map((j) => j.status)).toEqual(['cancelled', 'pending']);
    expect(new Date(list[1].run_at).toISOString()).toBe(new Date(new Date(msk(monday(), '15:00')).getTime() - 24 * 3600_000).toISOString());
    await db.rpc(anon(), 'public_cancel_booking', { p_slug: s.slug, p_token: b.access_token });
    list = await jobs(b.id);
    expect(list.map((j) => j.status)).toEqual(['cancelled', 'cancelled']);
    const read = await db.rpc(anon(), 'public_get_booking', { p_slug: s.slug, p_token: b.access_token });
    expect(read.reminder.state).toBe('inactive');
  });

  it('preview studios get suppressed jobs that are never claimed', async () => {
    const s = await setupStudio(db, 'ob-preview', {}, false);
    const b = await book(db, anon(), s.slug, s.service.wash, msk(monday(), '12:00'));
    expect(b.is_demo).toBe(true);
    const st = await db.rpc(anon(), 'public_save_push_subscription', { p_slug: s.slug, p_token: b.access_token, ...sub(3) });
    expect(st.state).toBe('preview');
    await db.admin(`update public.notification_jobs set run_at = now() - interval '1 minute' where booking_id = $1`, [b.id]);
    const claimed = await db.rpc(service, 'notify_claim_jobs', { p_worker: 'w-preview', p_limit: 50, p_lease_seconds: 60 });
    expect(claimed.find((j: any) => j.booking_id === b.id)).toBeUndefined();
  });

  it('claims with a lease, never hands the same job to two workers, completes and retries', async () => {
    const s = await setupStudio(db, 'ob-lease');
    const ids: string[] = [];
    for (const t of ['10:00', '12:00', '14:00']) {
      const b = await book(db, anon(`10.9.0.${ids.length}`), s.slug, s.service.wash, msk(monday(), t));
      await db.rpc(anon(), 'public_save_push_subscription', { p_slug: s.slug, p_token: b.access_token, ...sub(10 + ids.length) });
      ids.push(b.id);
    }
    await db.admin(`update public.notification_jobs set run_at = now() - interval '1 minute' where booking_id = any($1)`, [ids]);
    const [w1, w2] = await Promise.all([
      db.rpc(service, 'notify_claim_jobs', { p_worker: 'w1', p_limit: 2, p_lease_seconds: 60 }),
      db.rpc(service, 'notify_claim_jobs', { p_worker: 'w2', p_limit: 2, p_lease_seconds: 60 }),
    ]);
    const all = [...w1, ...w2].map((j: any) => j.job_id);
    expect(all).toHaveLength(3);
    expect(new Set(all).size).toBe(3);
    expect(w1[0].subscriptions[0].keys.auth).toBe('A'.repeat(22));

    const first = w1[0];
    // a worker that does not hold the lease cannot complete it
    expect((await db.rpc(service, 'notify_complete_job', { p_job_id: first.job_id, p_worker: 'w2', p_ok: true })).updated).toBe(false);
    expect((await db.rpc(service, 'notify_complete_job', { p_job_id: first.job_id, p_worker: 'w1', p_ok: true })).updated).toBe(true);
    // a temporary failure goes back to pending with backoff
    const second = w1[1] ?? w2[0];
    const holder = w1[1] ? 'w1' : 'w2';
    await db.rpc(service, 'notify_complete_job', { p_job_id: second.job_id, p_worker: holder, p_ok: false, p_error: '503 from push service' });
    const [row] = await db.admin(`select status, run_at > now() later, attempts from public.notification_jobs where id = $1`, [second.job_id]);
    expect(row).toMatchObject({ status: 'pending', later: true, attempts: 1 });
    // a gone endpoint (410) removes the subscription and fails the job
    const third = [...w1, ...w2].find((j: any) => j.job_id !== first.job_id && j.job_id !== second.job_id);
    const thirdHolder = w1.some((j: any) => j.job_id === third.job_id) ? 'w1' : 'w2';
    await db.rpc(service, 'notify_complete_job', {
      p_job_id: third.job_id, p_worker: thirdHolder, p_ok: false, p_error: '410 gone', p_gone_endpoints: [third.subscriptions[0].endpoint],
    });
    const [gone] = await db.admin(`select status from public.notification_jobs where id = $1`, [third.job_id]);
    expect(gone.status).toBe('failed');
    const states = await db.admin(`select status from public.notification_jobs where id = $1`, [first.job_id]);
    expect(states[0].status).toBe('sent');
  });

  it('an expired lease is reclaimed by another worker', async () => {
    const s = await setupStudio(db, 'ob-expire');
    const b = await book(db, anon(), s.slug, s.service.wash, msk(monday(), '16:00'));
    await db.rpc(anon(), 'public_save_push_subscription', { p_slug: s.slug, p_token: b.access_token, ...sub(30) });
    await db.admin(`update public.notification_jobs set run_at = now() - interval '1 minute' where booking_id = $1`, [b.id]);
    const a = await db.rpc(service, 'notify_claim_jobs', { p_worker: 'crashed', p_limit: 10, p_lease_seconds: 60 });
    expect(a.some((j: any) => j.booking_id === b.id)).toBe(true);
    expect((await db.rpc(service, 'notify_claim_jobs', { p_worker: 'other', p_limit: 10, p_lease_seconds: 60 })).some((j: any) => j.booking_id === b.id)).toBe(false);
    await db.admin(`update public.notification_jobs set lease_until = now() - interval '1 second' where booking_id = $1`, [b.id]);
    const c = await db.rpc(service, 'notify_claim_jobs', { p_worker: 'other', p_limit: 10, p_lease_seconds: 60 });
    const job = c.find((j: any) => j.booking_id === b.id);
    expect(job.attempt).toBe(2);
    expect((await db.rpc(service, 'notify_complete_job', { p_job_id: job.job_id, p_worker: 'crashed', p_ok: true })).updated).toBe(false);
  });

  it('a booking made less than 24h ahead reports too_late instead of pretending', async () => {
    const s = await setupStudio(db, 'ob-late', {
      hours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['00:00', '23:30']]])),
    });
    const slots = await db.rpc(anon(), 'public_get_slots', { p_slug: s.slug, p_service_id: s.service.wash, p_from: null, p_days: 1 });
    const first = slots.days.flatMap((d: any) => d.slots).find((x: any) => x.available);
    const b = await book(db, anon(), s.slug, s.service.wash, first.starts_at);
    const st = await db.rpc(anon(), 'public_save_push_subscription', { p_slug: s.slug, p_token: b.access_token, ...sub(40) });
    expect(st.state).toBe('too_late');
  });
});
