import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, createTestDb, nextWeekday, service, type TestDb } from './harness.ts';
import { book, monday, msk, setupStudio, slotsOn } from './fixtures.ts';

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

describe('availability', () => {
  it('offers starts on the slot grid inside working hours; short jobs finish by close', async () => {
    const s = await setupStudio(db, 'avail-grid');
    const day = monday();
    const slots = await slotsOn(db, anon(), s.slug, s.service.wash, day);
    // 10:00..19:00 every 30 min (60-minute job must end by 20:00)
    expect(slots[0].starts_at).toBe(msk(day, '10:00').replace('.000Z', '+00:00'));
    expect(slots.length).toBe(19);
    expect(slots.at(-1)!.starts_at).toBe(msk(day, '19:00').replace('.000Z', '+00:00'));
    expect(slots.every((x) => x.available)).toBe(true);
  });

  it('respects lunch breaks, days off and closed dates', async () => {
    const sat = nextWeekday(6, 3);
    const sun = nextWeekday(7, 3);
    const tue = nextWeekday(2, 3);
    const s = await setupStudio(db, 'avail-breaks', { closed_dates: [{ date: tue, note: 'holiday' }] });
    const satSlots = await slotsOn(db, anon(), s.slug, s.service.wash, sat);
    const times = satSlots.map((x) => new Date(x.starts_at).toISOString());
    expect(times).toContain(msk(sat, '13:00'));
    expect(times).not.toContain(msk(sat, '13:30')); // would run into the 14:00 break
    expect(times).not.toContain(msk(sat, '14:00'));
    expect(times).toContain(msk(sat, '15:00'));
    expect(await slotsOn(db, anon(), s.slug, s.service.wash, sun)).toEqual([]);
    const r = await db.rpc(anon(), 'public_get_slots', { p_slug: s.slug, p_service_id: s.service.wash, p_from: tue, p_days: 1 });
    expect(r.days[0].is_open).toBe(false);
    expect(r.days[0].slots).toEqual([]);
  });

  it('uses the studio timezone (Asia/Yekaterinburg, UTC+5)', async () => {
    const s = await setupStudio(db, 'avail-tz', { timezone: 'Asia/Yekaterinburg' });
    const day = monday();
    const slots = await slotsOn(db, anon(), s.slug, s.service.wash, day);
    expect(new Date(slots[0].starts_at).toISOString()).toBe(new Date(`${day}T10:00:00+05:00`).toISOString());
  });

  it('a two-day job occupies its bay continuously for both days plus buffer', async () => {
    const s = await setupStudio(db, 'avail-multiday');
    const day = monday();
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const day2 = next.toISOString().slice(0, 10);
    const third = new Date(next); third.setUTCDate(third.getUTCDate() + 1);
    const day3 = third.toISOString().slice(0, 10);

    const longJobSlots = await slotsOn(db, anon(), s.slug, s.service.ceramic, day);
    // longer than the working day: any acceptance moment is allowed
    expect(longJobSlots.length).toBe(20);

    await book(db, anon(), s.slug, s.service.ceramic, msk(day, '10:00'));
    // bay-1 is busy until day3 11:00 (48h + 60 min buffer)
    const singleDay2 = await slotsOn(db, anon(), s.slug, s.service.single, day2);
    expect(singleDay2.every((x) => !x.available)).toBe(true);
    const singleDay3 = await slotsOn(db, anon(), s.slug, s.service.single, day3);
    const byTime = new Map(singleDay3.map((x) => [new Date(x.starts_at).toISOString(), x.available]));
    expect(byTime.get(msk(day3, '10:30'))).toBe(false);
    expect(byTime.get(msk(day3, '11:00'))).toBe(true);
    // the wash can still use bay-2 on day2
    const washDay2 = await slotsOn(db, anon(), s.slug, s.service.wash, day2);
    expect(washDay2.every((x) => x.available)).toBe(true);
  });

  it('buffer between cars blocks the next start on the same bay', async () => {
    const s = await setupStudio(db, 'avail-buffer');
    const day = monday();
    await book(db, anon(), s.slug, s.service.single, msk(day, '10:00')); // 10-12, no buffer
    const slots = await slotsOn(db, anon(), s.slug, s.service.single, day);
    const m = new Map(slots.map((x) => [new Date(x.starts_at).toISOString(), x.available]));
    expect(m.get(msk(day, '11:30'))).toBe(false);
    expect(m.get(msk(day, '12:00'))).toBe(true);
    // wash has 60 + 30 buffer: two washes fill both bays at 10:00, third is busy until 11:30
    await book(db, anon('203.0.113.50'), s.slug, s.service.wash, msk(day, '14:00'));
    await book(db, anon('203.0.113.51'), s.slug, s.service.wash, msk(day, '14:00')).catch(() => null);
    const wash = new Map((await slotsOn(db, anon(), s.slug, s.service.wash, day)).map((x) => [new Date(x.starts_at).toISOString(), x.available]));
    expect(wash.get(msk(day, '15:00'))).toBe(false);
    expect(wash.get(msk(day, '15:30'))).toBe(true);
  });

  it('owner blocks are honoured by the slot engine and by booking', async () => {
    const s = await setupStudio(db, 'avail-block');
    const day = monday();
    const { createOwner, user } = await import('./harness.ts');
    const owner = await createOwner(db, 'block@x.test', s.slug);
    await db.rpc(user(owner), 'owner_block_resource', {
      p_tenant: s.id, p_resource_id: s.resource['bay-1'], p_from: msk(day, '10:00'), p_to: msk(day, '13:00'), p_note: 'lift repair',
    });
    const slots = await slotsOn(db, anon(), s.slug, s.service.single, day);
    const m = new Map(slots.map((x) => [new Date(x.starts_at).toISOString(), x.available]));
    expect(m.get(msk(day, '10:00'))).toBe(false);
    expect(m.get(msk(day, '13:00'))).toBe(true);
    await expect(book(db, anon(), s.slug, s.service.single, msk(day, '11:00'))).rejects.toMatchObject({ message: 'slot_taken' });
  });

  it('rejects times outside the schedule and past min notice', async () => {
    const s = await setupStudio(db, 'avail-invalid');
    const day = monday();
    await expect(book(db, anon(), s.slug, s.service.wash, msk(day, '10:10'))).rejects.toMatchObject({ message: 'slot_unavailable' });
    await expect(book(db, anon(), s.slug, s.service.wash, msk(day, '21:00'))).rejects.toMatchObject({ message: 'slot_unavailable' });
    const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await expect(book(db, anon(), s.slug, s.service.wash, soon)).rejects.toMatchObject({ message: 'slot_unavailable' });
    void service;
  });
});
