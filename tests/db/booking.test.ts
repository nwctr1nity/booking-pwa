import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createOwner, createTestDb, idem, service, user, type TestDb } from './harness.ts';
import { book, monday, msk, setupStudio, slotsOn, soonWorkday } from './fixtures.ts';

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

describe('public booking', () => {
  it('derives price, duration and resource on the server and stores only the token hash', async () => {
    const s = await setupStudio(db, 'bk-basic');
    const day = monday();
    const b = await book(db, anon(), s.slug, s.service.wash, msk(day, '10:00'));
    expect(b.status).toBe('confirmed');
    expect(b.price_cents).toBe(300000);
    expect(b.duration_minutes).toBe(60);
    expect(b.customer_phone).toBe('+79001234567');
    expect(b.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await db.admin(`select access_token_hash, encode(access_token_hash,'hex') h,
        (select count(*) from public.resource_occupancies o where o.booking_id = b.id) occ
      from public.bookings b where id = $1`, [b.id]);
    expect(row.h).toHaveLength(64);
    expect(row.h).not.toContain(b.access_token);
    expect(Number(row.occ)).toBe(1);
    const read = await db.rpc(anon(), 'public_get_booking', { p_slug: s.slug, p_token: b.access_token });
    expect(read.id).toBe(b.id);
    expect(read.access_token).toBeUndefined();
  });

  it('ignores any attempt to pass tenant, price or duration (no such parameters exist)', async () => {
    const s = await setupStudio(db, 'bk-params');
    await expect(
      db.rpc(anon(), 'public_create_booking', {
        p_slug: s.slug, p_service_id: s.service.wash, p_starts_at: msk(monday(), '10:00'), p_name: 'A B',
        p_phone: '+79000000000', p_car: 'Car', p_comment: '', p_idempotency_key: idem(), p_price_cents: 1,
      }),
    ).rejects.toMatchObject({ code: '42883' }); // function does not exist with that signature
  });

  it('a token of one studio does not open a booking of another', async () => {
    const a = await setupStudio(db, 'bk-tok-a');
    const b = await setupStudio(db, 'bk-tok-b');
    const x = await book(db, anon(), a.slug, a.service.wash, msk(monday(), '10:00'));
    await expect(db.rpc(anon(), 'public_get_booking', { p_slug: b.slug, p_token: x.access_token }))
      .rejects.toMatchObject({ message: 'booking_not_found' });
  });

  it('is idempotent: a retry returns the same booking and the same access token', async () => {
    const s = await setupStudio(db, 'bk-idem');
    const key = idem();
    const at = msk(monday(), '12:00');
    const first = await book(db, anon(), s.slug, s.service.wash, at, { p_idempotency_key: key });
    const again = await book(db, anon(), s.slug, s.service.wash, at, { p_idempotency_key: key });
    expect(again.id).toBe(first.id);
    expect(again.access_token).toBe(first.access_token);
    expect(again.replayed).toBe(true);
    const [{ n }] = await db.admin(`select count(*)::int n from public.bookings where tenant_id = $1`, [s.id]);
    expect(n).toBe(1);
    await expect(book(db, anon(), s.slug, s.service.wash, at, { p_idempotency_key: key, p_car: 'Other car' }))
      .rejects.toMatchObject({ message: 'idempotency_conflict' });
  });

  it('parallel double-click with one key creates exactly one booking', async () => {
    const s = await setupStudio(db, 'bk-idem-par');
    const key = idem();
    const at = msk(monday(), '13:00');
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => book(db, anon(), s.slug, s.service.wash, at, { p_idempotency_key: key })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<any>).value);
    expect(ok).toHaveLength(6);
    expect(new Set(ok.map((b) => b.id)).size).toBe(1);
    expect(new Set(ok.map((b) => b.access_token)).size).toBe(1);
  });

  it('concurrent clients on a one-bay service: exactly one wins', async () => {
    const s = await setupStudio(db, 'bk-race-1');
    const at = msk(monday(), '10:00');
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => book(db, anon(`198.18.0.${i + 1}`), s.slug, s.service.single, at)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed.every((f) => f.reason.message === 'slot_taken')).toBe(true);
    const [{ n }] = await db.admin(`select count(*)::int n from public.resource_occupancies where tenant_id = $1`, [s.id]);
    expect(n).toBe(1);
  });

  it('concurrent clients on a two-bay service: exactly two win, on different bays', async () => {
    const s = await setupStudio(db, 'bk-race-2');
    const at = msk(monday(), '10:00');
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => book(db, anon(`198.18.1.${i + 1}`), s.slug, s.service.wash, at)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<any>).value);
    expect(ok).toHaveLength(2);
    expect(new Set(ok.map((b) => b.resource_name)).size).toBe(2);
    const slots = await slotsOn(db, anon(), s.slug, s.service.wash, monday());
    const m = new Map(slots.map((x) => [new Date(x.starts_at).toISOString(), x.available]));
    expect(m.get(at)).toBe(false);
  });

  it('client cancels by token within the policy and the time becomes free again', async () => {
    const s = await setupStudio(db, 'bk-cancel');
    const at = msk(monday(), '15:00');
    const b = await book(db, anon(), s.slug, s.service.single, at);
    expect(b.can_cancel).toBe(true);
    const c = await db.rpc(anon(), 'public_cancel_booking', { p_slug: s.slug, p_token: b.access_token });
    expect(c.status).toBe('cancelled');
    const again = await db.rpc(anon(), 'public_cancel_booking', { p_slug: s.slug, p_token: b.access_token });
    expect(again.status).toBe('cancelled'); // idempotent
    const next = await book(db, anon(), s.slug, s.service.single, at);
    expect(next.status).toBe('confirmed');
  });

  it('client cannot cancel after the deadline', async () => {
    const s = await setupStudio(db, 'bk-deadline', {
      booking: { cancellation_hours: 168, slot_step_minutes: 30, min_notice_minutes: 60, horizon_days: 30, reminder_hours: 24 },
    });
    const b = await book(db, anon(), s.slug, s.service.single, msk(soonWorkday(), '15:00'));
    expect(b.can_cancel).toBe(false);
    await expect(db.rpc(anon(), 'public_cancel_booking', { p_slug: s.slug, p_token: b.access_token }))
      .rejects.toMatchObject({ message: 'cancel_deadline_passed' });
  });

  it('validates contact fields', async () => {
    const s = await setupStudio(db, 'bk-validate');
    const at = msk(monday(), '10:00');
    await expect(book(db, anon(), s.slug, s.service.wash, at, { p_phone: '123' })).rejects.toMatchObject({ message: 'invalid_input', hint: 'phone' });
    await expect(book(db, anon(), s.slug, s.service.wash, at, { p_name: 'A' })).rejects.toMatchObject({ hint: 'name' });
    await expect(book(db, anon(), s.slug, s.service.wash, at, { p_idempotency_key: 'short' })).rejects.toMatchObject({ hint: 'idempotency_key' });
  });

  it('needs a car everywhere except beauty salons', async () => {
    const car = await setupStudio(db, 'bk-car');
    await expect(book(db, anon(), car.slug, car.service.wash, msk(monday(), '10:00'), { p_car: '' })).rejects.toMatchObject({ hint: 'car' });
    const salon = await setupStudio(db, 'bk-beauty', { kind: 'beauty' });
    const b = await book(db, anon(), salon.slug, salon.service.wash, msk(monday(), '10:00'), { p_car: '' });
    expect(b.car).toBe('');
    await expect(book(db, anon(), salon.slug, salon.service.wash, msk(monday(), '12:00'), { p_car: 'x'.repeat(81) })).rejects.toMatchObject({ hint: 'car' });
  });

  it('rate-limits booking attempts per IP with a shared atomic counter', async () => {
    const s = await setupStudio(db, 'bk-rate');
    const day = monday();
    const ip = '192.0.2.99';
    const times = ['10:00', '10:00', '11:30', '11:30', '13:00', '13:00', '14:30', '14:30', '16:00'];
    const results = await Promise.allSettled(times.map((t) => book(db, anon(ip), s.slug, s.service.wash, msk(day, t))));
    const limited = results.filter((r) => r.status === 'rejected' && (r as PromiseRejectedResult).reason.message === 'rate_limited');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(8);
    expect(limited).toHaveLength(1);
  });

  it('failed attempts count towards the limit too', async () => {
    const s = await setupStudio(db, 'bk-rate-fail');
    const ip = '192.0.2.100';
    for (let i = 0; i < 8; i++) {
      await expect(book(db, anon(ip), s.slug, s.service.wash, msk(monday(), '10:00'), { p_phone: 'bad' }))
        .rejects.toMatchObject({ message: 'invalid_input' });
    }
    await expect(book(db, anon(ip), s.slug, s.service.wash, msk(monday(), '10:00'))).rejects.toMatchObject({ message: 'rate_limited' });
    // another IP is unaffected
    await expect(book(db, anon('192.0.2.101'), s.slug, s.service.wash, msk(monday(), '10:00'))).resolves.toMatchObject({ status: 'confirmed' });
  });

  it('keeps the historical price when the owner changes the service', async () => {
    const s = await setupStudio(db, 'bk-price');
    const owner = await createOwner(db, 'price@x.test', s.slug);
    const b = await book(db, anon(), s.slug, s.service.single, msk(monday(), '10:00'));
    await db.rpc(user(owner), 'owner_save_service', {
      p_tenant: s.id,
      p_service: { id: s.service.single, name: 'Single bay job', price_cents: 990000, duration_minutes: 180, resource_ids: [s.resource['bay-1']] },
    });
    const read = await db.rpc(anon(), 'public_get_booking', { p_slug: s.slug, p_token: b.access_token });
    expect(read.price_cents).toBe(500000);
    expect(read.duration_minutes).toBe(120);
    const studio = await db.rpc(anon(), 'public_get_studio', { p_slug: s.slug });
    expect(studio.services.find((x: any) => x.id === s.service.single).price_cents).toBe(990000);
    void service;
  });
});
