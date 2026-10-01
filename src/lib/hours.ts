import type { HoursRow } from './types';
import { WEEKDAYS } from './time';

const hhmm = (t: string) => t.slice(0, 5);

/** Groups weekdays with identical intervals: [{days:'Пн–Пт', text:'10:00–21:00'}, {days:'Вс', text:'выходной'}]. */
export function groupHours(rows: HoursRow[]): { days: string; text: string }[] {
  const perDay = WEEKDAYS.map((_, i) =>
    rows
      .filter((r) => r.weekday === i + 1)
      .sort((a, b) => a.opens.localeCompare(b.opens))
      .map((r) => `${hhmm(r.opens)}–${hhmm(r.closes)}`)
      .join(', ') || 'выходной',
  );
  const out: { days: string; text: string }[] = [];
  let start = 0;
  for (let i = 1; i <= 7; i++) {
    if (i === 7 || perDay[i] !== perDay[start]) {
      const label = i - 1 === start ? WEEKDAYS[start]! : `${WEEKDAYS[start]}–${WEEKDAYS[i - 1]}`;
      out.push({ days: label, text: perDay[start]! });
      start = i;
    }
  }
  return out;
}
