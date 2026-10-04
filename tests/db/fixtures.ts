import { idem, nextWeekday, publish, service, type Caller, type TestDb } from './harness.ts';

export function makeConfig(slug: string, patch: Record<string, unknown> = {}) {
  return {
    slug,
    name: `Studio ${slug}`,
    short_name: slug.slice(0, 20),
    kind: 'detailing',
    timezone: 'Europe/Moscow',
    currency: 'RUB',
    accent_color: '#4690FF',
    tagline: 't',
    description: 'd',
    contacts: { address: 'Address 1', phone: '+70000000000' },
    booking: { cancellation_hours: 12, slot_step_minutes: 30, min_notice_minutes: 60, horizon_days: 30, reminder_hours: 24 },
    images: { logo: 'logo.png', hero: 'hero.jpg' },
    info_cards: [],
    resources: [
      { key: 'bay-1', name: 'Bay 1' },
      { key: 'bay-2', name: 'Bay 2' },
    ],
    services: [
      { key: 'wash', name: 'Wash', price: 3000, duration_minutes: 60, buffer_minutes: 30, resources: ['bay-1', 'bay-2'] },
      { key: 'single', name: 'Single bay job', price: 5000, duration_minutes: 120, buffer_minutes: 0, resources: ['bay-1'] },
      { key: 'ceramic', name: 'Ceramic two days', price: 45000, duration_minutes: 2880, buffer_minutes: 60, resources: ['bay-1'] },
    ],
    hours: {
      mon: [['10:00', '20:00']], tue: [['10:00', '20:00']], wed: [['10:00', '20:00']], thu: [['10:00', '20:00']],
      fri: [['10:00', '20:00']], sat: [['10:00', '14:00'], ['15:00', '18:00']], sun: [],
    },
    closed_dates: [],
    gallery: [{ key: 'w1', image: 'gallery/a.jpg', caption: 'A' }],
    ...patch,
  };
}

export async function setupStudio(db: TestDb, slug: string, patch: Record<string, unknown> = {}, live = true) {
  const report = await publish(db, makeConfig(slug, patch));
  if (live) await db.rpc(service, 'pipeline_set_status', { p_slug: slug, p_status: 'live' });
  const services = await db.admin(`select key, id from public.services where tenant_id = $1`, [report.tenant_id]);
  const resources = await db.admin(`select key, id from public.resources where tenant_id = $1`, [report.tenant_id]);
  return {
    id: report.tenant_id as string,
    slug,
    service: Object.fromEntries(services.map((s) => [s.key, s.id])) as Record<string, string>,
    resource: Object.fromEntries(resources.map((r) => [r.key, r.id])) as Record<string, string>,
  };
}

/** Moscow (UTC+3, no DST) local time on a date -> ISO instant. */
export function msk(date: string, hhmm: string) {
  return new Date(`${date}T${hhmm}:00+03:00`).toISOString();
}

export const monday = () => nextWeekday(1, 3);

/** A Mon–Fri day 2–4 days ahead: always well inside a week (unlike monday(), which can be 9 days out). */
export function soonWorkday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function book(db: TestDb, caller: Caller, slug: string, serviceId: string, startsAt: string, extra: Record<string, unknown> = {}) {
  return db.rpc(caller, 'public_create_booking', {
    p_slug: slug,
    p_service_id: serviceId,
    p_starts_at: startsAt,
    p_name: 'Иван',
    p_phone: '+7 (900) 123-45-67',
    p_car: 'Kia Rio',
    p_comment: '',
    p_idempotency_key: idem(),
    ...extra,
  });
}

export async function slotsOn(db: TestDb, caller: Caller, slug: string, serviceId: string, date: string) {
  const r = await db.rpc(caller, 'public_get_slots', { p_slug: slug, p_service_id: serviceId, p_from: date, p_days: 1 });
  return r.days[0].slots as { starts_at: string; available: boolean }[];
}
