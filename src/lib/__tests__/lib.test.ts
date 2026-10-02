import { describe, expect, it } from 'vitest';
import { buildIcs } from '../ics';
import { groupHours } from '../hours';
import { currencySymbol, formatPrice } from '../money';
import { addLocalDays, fmtDuration, localDateOf, studioToday, weekRange, zonedParts, zonedToIso } from '../time';
import { contactsSchema, normalizePhone } from '../validation';
import { tokenFromHash } from '@/features/my-booking/links';

describe('time in studio timezone', () => {
  it('today depends on the studio, not on the device', () => {
    const now = new Date('2026-10-01T20:30:00Z'); // 23:30 Moscow, 01:30 next day in Yekaterinburg
    expect(studioToday('Europe/Moscow', now)).toBe('2026-10-01');
    expect(studioToday('Asia/Yekaterinburg', now)).toBe('2026-10-02');
  });
  it('converts local wall time to an instant and back', () => {
    const iso = zonedToIso('2026-10-05', '10:00', 'Asia/Yekaterinburg');
    expect(iso).toBe('2026-10-05T05:00:00.000Z');
    expect(zonedParts(iso, 'Asia/Yekaterinburg')).toEqual({ date: '2026-10-05', time: '10:00' });
    expect(localDateOf('2026-10-04T21:30:00Z', 'Europe/Moscow')).toBe('2026-10-05');
  });
  it('week range is Monday..Sunday', () => {
    expect(weekRange('2026-10-01')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(weekRange('2026-10-04')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('durations read naturally', () => {
    expect(fmtDuration(150)).toBe('2 ч 30 мин');
    expect(fmtDuration(2880)).toBe('2 дня');
    expect(fmtDuration(45)).toBe('45 мин');
  });
});

describe('hours', () => {
  it('groups equal weekdays and keeps lunch breaks', () => {
    const rows = [1, 2, 3, 4, 5].flatMap((w) => [
      { weekday: w, opens: '09:00:00', closes: '13:00:00' },
      { weekday: w, opens: '14:00', closes: '20:00' },
    ]);
    rows.push({ weekday: 6, opens: '10:00', closes: '18:00' });
    expect(groupHours(rows)).toEqual([
      { days: 'Пн–Пт', text: '09:00–13:00, 14:00–20:00' },
      { days: 'Сб', text: '10:00–18:00' },
      { days: 'Вс', text: 'выходной' },
    ]);
  });
});

describe('contacts validation mirrors SQL limits', () => {
  it('normalizes phone', () => {
    expect(normalizePhone('+7 (900) 123-45-67')).toBe('+79001234567');
    const ok = contactsSchema.safeParse({ name: 'Ан', phone: '8 900 123 45 67', car: 'VW', comment: '' });
    expect(ok.success && ok.data.phone).toBe('89001234567');
  });
  it('rejects bad input', () => {
    const r = contactsSchema.safeParse({ name: 'А', phone: '123', car: '', comment: 'x'.repeat(501) });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual(['car', 'comment', 'name', 'phone']);
  });
});

describe('ICS', () => {
  it('builds a valid event with alarm and escaped text', () => {
    const ics = buildIcs(
      { uid: 'b1@booking', start: '2026-10-05T07:00:00Z', end: '2026-10-05T09:00:00Z', title: 'Мойка, полировка; салон', location: 'Москва', alarmHours: 24 },
      new Date('2026-10-01T00:00:00Z'),
    );
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('DTSTART:20261005T070000Z');
    expect(ics).toContain('DTEND:20261005T090000Z');
    expect(ics).toContain('SUMMARY:Мойка\\, полировка\; салон');
    expect(ics).toContain('TRIGGER:-PT24H');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe('misc', () => {
  it('formats prices', () => {
    expect(formatPrice(350000, false).replace(/\s/g, ' ')).toBe('3 500 ₽');
    expect(formatPrice(1200000, true).replace(/\s/g, ' ')).toBe('от 12 000 ₽');
    expect(formatPrice(1500000, true, 'KZT').replace(/\s/g, ' ')).toBe('от 15 000 ₸');
    expect(currencySymbol('KZT')).toBe('₸');
  });
  it('reads the booking token from the fragment', () => {
    expect(tokenFromHash('#t=abc-_9')).toBe('abc-_9');
    expect(tokenFromHash('#x=1&t=zz')).toBe('zz');
    expect(tokenFromHash('')).toBeNull();
  });
});
