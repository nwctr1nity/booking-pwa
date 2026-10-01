import type { ISOTimeString } from '@astryxdesign/core/TimeInput';
// All studio times are shown in the studio's timezone, whatever the device
// timezone is. Period boundaries sent to SQL are local dates of the studio.
import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { ru } from 'date-fns/locale';

export function studioToday(tz: string, now = new Date()): string {
  return formatInTimeZone(now, tz, 'yyyy-MM-dd');
}

export function addLocalDays(date: string, n: number): string {
  return format(addDays(parseISO(date), n), 'yyyy-MM-dd');
}

/** Monday..Sunday of the local week containing `date`. */
export function weekRange(date: string): { from: string; to: string } {
  const d = parseISO(date);
  const iso = ((d.getDay() + 6) % 7) + 1;
  const from = addLocalDays(date, 1 - iso);
  return { from, to: addLocalDays(from, 6) };
}

export function fmtTime(iso: string, tz: string) {
  return formatInTimeZone(iso, tz, 'HH:mm');
}

export function fmtDate(iso: string, tz: string, pattern = 'd MMMM, EEEEEE') {
  return formatInTimeZone(iso, tz, pattern, { locale: ru });
}

export function fmtLocalDate(date: string, pattern = 'd MMMM, EEEEEE') {
  return format(parseISO(date), pattern, { locale: ru });
}

export function fmtDateTime(iso: string, tz: string) {
  return formatInTimeZone(iso, tz, 'd MMMM, EEEEEE, HH:mm', { locale: ru });
}

export function localDateOf(iso: string, tz: string) {
  return formatInTimeZone(iso, tz, 'yyyy-MM-dd');
}

export function fmtDuration(minutes: number) {
  if (minutes >= 24 * 60 && minutes % (24 * 60) === 0) {
    const d = minutes / (24 * 60);
    return `${d} ${plural(d, 'день', 'дня', 'дней')}`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Convert local wall time of the studio to an ISO instant. */
export function zonedToIso(date: string, time: string, tz: string) {
  return fromZonedTime(`${date}T${time}:00`, tz).toISOString();
}

export function zonedParts(iso: string, tz: string) {
  const z = toZonedTime(iso, tz);
  return { date: format(z, 'yyyy-MM-dd'), time: format(z, 'HH:mm') };
}

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

// Branded string types of Astryx DateInput / TimeInput.
export type ISODate = `${number}${number}${number}${number}-${number}${number}-${number}${number}`;
export const isoDate = (s: string) => s as ISODate;
export const isoTime = (s: string) => s as ISOTimeString;
