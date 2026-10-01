// Schema of tenants/<slug>/business.json — the single input of the pipeline.
import { z } from 'zod';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'время в формате ЧЧ:ММ');
const interval = z
  .tuple([time, time])
  .refine(([a, b]) => a < b, 'начало интервала должно быть раньше конца');
const dayHours = z
  .array(interval)
  .max(4)
  .refine((list) => {
    const sorted = [...list].sort((x, y) => x[0].localeCompare(y[0]));
    return sorted.every((it, i) => i === 0 || sorted[i - 1][1] <= it[0]);
  }, 'интервалы одного дня пересекаются');
const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'латиница, цифры и дефис');
const imageFile = z
  .string()
  .regex(/^[A-Za-z0-9._/-]+\.(jpe?g|png|webp|avif)$/i, 'файл изображения jpg/png/webp/avif');

function isTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const businessSchema = z
  .object({
    $schema: z.string().optional(),
    slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'slug: латиница, цифры, дефис'),
    name: z.string().min(2).max(80),
    short_name: z.string().min(1).max(24),
    kind: z.enum(['detailing', 'service', 'tire', 'wash', 'other']).default('detailing'),
    timezone: z.string().refine(isTimezone, 'неизвестный часовой пояс IANA'),
    currency: z.string().regex(/^[A-Z]{3}$/).default('RUB'),
    locale: z.string().default('ru-RU'),
    accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'цвет в формате #RRGGBB'),
    tagline: z.string().max(120).default(''),
    description: z.string().max(1000).default(''),
    contacts: z.object({
      address: z.string().min(5).max(200),
      address_note: z.string().max(200).default(''),
      phone: z.string().regex(/^\+?[0-9 ()-]{10,20}$/, 'телефон, например +74951234567'),
      map_url: z.url().startsWith('https://').optional(),
    }),
    booking: z
      .object({
        cancellation_hours: z.number().int().min(0).max(168).default(12),
        slot_step_minutes: z.union([z.literal(15), z.literal(20), z.literal(30), z.literal(60)]).default(30),
        min_notice_minutes: z.number().int().min(0).max(2880).default(60),
        horizon_days: z.number().int().min(1).max(120).default(30),
        reminder_hours: z.number().int().min(1).max(72).default(24),
      })
      .prefault({}),
    images: z.object({ logo: imageFile, hero: imageFile }),
    info_cards: z
      .array(
        z.object({
          icon: z.string().max(30).optional(),
          title: z.string().min(1).max(40),
          text: z.string().max(160).default(''),
        }),
      )
      .max(3)
      .default([]),
    resources: z.array(z.object({ key, name: z.string().min(1).max(60) })).min(1).max(20),
    services: z
      .array(
        z.object({
          key,
          name: z.string().min(2).max(80),
          category: z.string().max(40).default(''),
          description: z.string().max(400).default(''),
          price: z.number().min(0).max(10_000_000),
          price_is_from: z.boolean().default(false),
          duration_minutes: z.number().int().min(15).max(14 * 24 * 60),
          buffer_minutes: z.number().int().min(0).max(24 * 60).default(0),
          resources: z.array(key).min(1),
        }),
      )
      .min(1)
      .max(60),
    hours: z.object({
      mon: dayHours, tue: dayHours, wed: dayHours, thu: dayHours, fri: dayHours, sat: dayHours, sun: dayHours,
    }),
    closed_dates: z
      .array(
        z.object({
          date: z.iso.date(),
          note: z.string().max(120).default(''),
          opens: time.optional(),
          closes: time.optional(),
        }),
      )
      .default([]),
    gallery: z.array(z.object({ key, image: imageFile, caption: z.string().max(140).default('') })).max(40).default([]),
    owner: z.object({ email: z.email() }).optional(),
  })
  .superRefine((cfg, ctx) => {
    const resourceKeys = new Set(cfg.resources.map((r) => r.key));
    if (resourceKeys.size !== cfg.resources.length) {
      ctx.addIssue({ code: 'custom', path: ['resources'], message: 'ключи боксов повторяются' });
    }
    const serviceKeys = new Set<string>();
    cfg.services.forEach((s, i) => {
      if (serviceKeys.has(s.key)) ctx.addIssue({ code: 'custom', path: ['services', i, 'key'], message: 'ключ услуги повторяется' });
      serviceKeys.add(s.key);
      s.resources.forEach((r, j) => {
        if (!resourceKeys.has(r)) {
          ctx.addIssue({ code: 'custom', path: ['services', i, 'resources', j], message: `нет бокса «${r}»` });
        }
      });
    });
    const galleryKeys = new Set<string>();
    cfg.gallery.forEach((g, i) => {
      if (galleryKeys.has(g.key)) ctx.addIssue({ code: 'custom', path: ['gallery', i, 'key'], message: 'ключ фото повторяется' });
      galleryKeys.add(g.key);
    });
    const openDays = Object.values(cfg.hours).filter((d) => d.length > 0).length;
    if (openDays === 0) ctx.addIssue({ code: 'custom', path: ['hours'], message: 'нет ни одного рабочего дня' });
    cfg.closed_dates.forEach((d, i) => {
      if ((d.opens === undefined) !== (d.closes === undefined) || (d.opens && d.closes && d.opens >= d.closes)) {
        ctx.addIssue({ code: 'custom', path: ['closed_dates', i], message: 'укажите opens и closes вместе (opens < closes) или ни одного' });
      }
    });
  });

export type BusinessConfig = z.output<typeof businessSchema>;
