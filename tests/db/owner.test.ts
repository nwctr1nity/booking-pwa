import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createOwner, createTestDb, idem, user, type TestDb } from './harness.ts';
import { book, monday, msk, setupStudio, slotsOn } from './fixtures.ts';

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

const plusDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('owner bookings', () => {
  it('sees client bookings, creates a manual one on a chosen bay', async () => {
    const s = await setupStudio(db, 'own-list');
    const owner = await createOwner(db, 'list@x.test', s.slug);
    const day = monday();
    const client = await book(db, anon(), s.slug, s.service.wash, msk(day, '10:00'));
    const manual = await db.rpc(user(owner), 'owner_create_booking', {
      p_tenant: s.id, p_service_id: s.service.wash, p_starts_at: msk(day, '10:15'), p_resource_id: s.resource['bay-2'],
      p_name: 'Пётр', p_phone: '89001112233', p_car: 'Lada', p_comment: 'по телефону', p_idempotency_key: idem(),
    });
    expect(manual.resource_id).toBe(s.resource['bay-2']);
    expect(manual.source).toBe('owner');
    const list = await db.rpc(user(owner), 'owner_get_bookings', { p_tenant: s.id, p_from: day, p_to: day });
    expect(list.bookings.map((b: any) => b.id)).toEqual([client.id, manual.id]);
    expect(list.bookings[0].customer_phone).toBe('+79001234567');
  });

  it('reschedule moves the booking atomically; a failed move keeps the original intact', async () => {
    const s = await setupStudio(db, 'own-move');
    const owner = await createOwner(db, 'move@x.test', s.slug);
    const day = monday();
    const a = await book(db, anon('10.0.0.1'), s.slug, s.service.single, msk(day, '10:00'));
    const b = await book(db, anon('10.0.0.2'), s.slug, s.service.single, msk(day, '14:00'));
    const ownerA = (await db.rpc(user(owner), 'owner_get_bookings', { p_tenant: s.id, p_from: day, p_to: day })).bookings[0];

    // into b's time: conflict
    await expect(db.rpc(user(owner), 'owner_reschedule_booking', {
      p_tenant: s.id, p_booking_id: a.id, p_new_starts_at: msk(day, '13:00'), p_expected_version: ownerA.version,
    })).rejects.toMatchObject({ message: 'slot_taken' });
    const [occ] = await db.admin(`select lower(period) l from public.resource_occupancies where booking_id = $1`, [a.id]);
    expect(new Date(occ.l).toISOString()).toBe(msk(day, '10:00'));
    const after = await db.rpc(anon(), 'public_get_booking', { p_slug: s.slug, p_token: a.access_token });
    expect(new Date(after.starts_at).toISOString()).toBe(msk(day, '10:00'));

    // valid move
    const moved = await db.rpc(user(owner), 'owner_reschedule_booking', {
      p_tenant: s.id, p_booking_id: a.id, p_new_starts_at: msk(day, '16:00'), p_expected_version: ownerA.version,
    });
    expect(new Date(moved.starts_at).toISOString()).toBe(msk(day, '16:00'));
    expect(moved.version).toBe(ownerA.version + 1);
    // replay of the same move is a no-op, a stale version is rejected
    const replay = await db.rpc(user(owner), 'owner_reschedule_booking', {
      p_tenant: s.id, p_booking_id: a.id, p_new_starts_at: msk(day, '16:00'), p_expected_version: ownerA.version,
    });
    expect(replay.version).toBe(moved.version);
    await expect(db.rpc(user(owner), 'owner_reschedule_booking', {
      p_tenant: s.id, p_booking_id: a.id, p_new_starts_at: msk(day, '17:00'), p_expected_version: ownerA.version,
    })).rejects.toMatchObject({ message: 'version_conflict' });

    const slots = new Map((await slotsOn(db, anon(), s.slug, s.service.single, day)).map((x) => [new Date(x.starts_at).toISOString(), x.available]));
    expect(slots.get(msk(day, '10:00'))).toBe(true);
    expect(slots.get(msk(day, '16:00'))).toBe(false);
    void b;
  });

  it('reschedule can move a two-day job to another day', async () => {
    const s = await setupStudio(db, 'own-move-long');
    const owner = await createOwner(db, 'long@x.test', s.slug);
    const day = monday();
    const job = await book(db, anon(), s.slug, s.service.ceramic, msk(day, '10:00'));
    const moved = await db.rpc(user(owner), 'owner_reschedule_booking', {
      p_tenant: s.id, p_booking_id: job.id, p_new_starts_at: msk(plusDays(day, 7), '10:00'),
    });
    expect(new Date(moved.ends_at).toISOString()).toBe(msk(plusDays(day, 9), '10:00'));
    const free = await slotsOn(db, anon(), s.slug, s.service.single, plusDays(day, 1));
    expect(free.some((x) => x.available)).toBe(true);
  });

  it('status flow, payments, refunds and SQL statistics', async () => {
    const s = await setupStudio(db, 'own-stats');
    const owner = await createOwner(db, 'stats@x.test', s.slug);
    const day = monday();
    const u = user(owner);
    const b1 = await book(db, anon('10.1.0.1'), s.slug, s.service.wash, msk(day, '10:00'));
    const b2 = await book(db, anon('10.1.0.2'), s.slug, s.service.single, msk(day, '12:00'));
    const b3 = await book(db, anon('10.1.0.3'), s.slug, s.service.wash, msk(day, '16:00'));

    await expect(db.rpc(u, 'owner_set_booking_status', { p_tenant: s.id, p_booking_id: b1.id, p_status: 'done' }))
      .rejects.toMatchObject({ message: 'invalid_transition' });
    await db.rpc(u, 'owner_set_booking_status', { p_tenant: s.id, p_booking_id: b1.id, p_status: 'arrived' });
    const done = await db.rpc(u, 'owner_set_booking_status', { p_tenant: s.id, p_booking_id: b1.id, p_status: 'done' });
    expect(done.completed_at).toBeTruthy();
    await db.rpc(u, 'owner_set_booking_status', { p_tenant: s.id, p_booking_id: b2.id, p_status: 'arrived' });

    const payKey = idem();
    await db.rpc(u, 'owner_add_payment', { p_tenant: s.id, p_booking_id: b1.id, p_kind: 'payment', p_amount_cents: 300000, p_method: 'card', p_note: '', p_idempotency_key: payKey });
    await db.rpc(u, 'owner_add_payment', { p_tenant: s.id, p_booking_id: b1.id, p_kind: 'payment', p_amount_cents: 300000, p_method: 'card', p_note: '', p_idempotency_key: payKey });
    await expect(db.rpc(u, 'owner_add_payment', { p_tenant: s.id, p_booking_id: b1.id, p_kind: 'refund', p_amount_cents: 400000, p_method: 'card', p_note: '', p_idempotency_key: idem() }))
      .rejects.toMatchObject({ message: 'refund_exceeds_paid' });
    const refunded = await db.rpc(u, 'owner_add_payment', { p_tenant: s.id, p_booking_id: b1.id, p_kind: 'refund', p_amount_cents: 50000, p_method: 'card', p_note: 'скидка', p_idempotency_key: idem() });
    expect(refunded.paid_cents).toBe(300000);
    expect(refunded.refunded_cents).toBe(50000);
    await db.rpc(u, 'owner_cancel_booking', { p_tenant: s.id, p_booking_id: b3.id, p_reason: 'клиент заболел' });

    // Stats for today (the payments happened now) and for the booking day.
    const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    const statsToday = await db.rpc(u, 'owner_get_stats', { p_tenant: s.id, p_from: today, p_to: today });
    expect(statsToday.received_cents).toBe(300000);
    expect(statsToday.refunded_cents).toBe(50000);
    expect(statsToday.net_cents).toBe(250000);

    const statsDay = await db.rpc(u, 'owner_get_stats', { p_tenant: s.id, p_from: day, p_to: day });
    expect(statsDay.scheduled).toBe(2);      // b1 + b2 (b3 cancelled)
    expect(statsDay.cancelled).toBe(1);
    expect(statsDay.completed).toBe(0);      // completed now, not on the booking day
    expect(statsDay.planned_value_cents).toBe(500000); // only b2 (arrived) is still ahead
    expect(statsDay.received_cents).toBe(0); // money is attributed to the payment date
    const statsTodayArrivals = statsToday.arrivals + statsDay.arrivals;
    expect(statsTodayArrivals).toBeGreaterThanOrEqual(2);
    expect(statsToday.completed).toBe(1);
  });
});
