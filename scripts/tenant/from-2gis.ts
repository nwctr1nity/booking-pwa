// pnpm tenant:from-2gis <export.json> [--list] [--ids id1,id2,…] [--profile detailing|wash] [--city-tz Asia/Almaty] [--currency KZT]
// Builds demo studios from a Parser2GIS JSON export (github.com/Eroloft/parser-2gis-new):
//   --list   prints the organisations without a website (the ones worth a demo)
//   --ids    creates tenants/<slug>/business.json for the given 2GIS ids
//   --profile  detailing (default) or wash: price list, posts, booking rules, texts
// Name, address, phone, hours, rating and the 2GIS link come from the card;
// services are a typical price list for the rubrics (prices «от», the owner
// edits them); hero and work photos are the shared placeholders in
// tenants/_placeholder, the logo is generated. No owner: it is added on sale.
// Never touches an existing studio folder.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../lib/args.ts';
import { renderLogo } from '../lib/placeholder-images.ts';
import { tenantDir, TENANTS_DIR } from './load.ts';

type Contact = { type: string; value?: string; url?: string };
type Org = {
  id: string;
  name: string;
  name_ex?: { primary?: string; extension?: string };
  address_name?: string;
  adm_div?: { type: string; name: string }[];
  contact_groups?: { contacts: Contact[] }[];
  reviews?: { general_rating?: number; general_review_count?: number };
  rubrics?: { name: string }[];
  schedule?: Record<string, { working_hours?: { from: string; to: string }[] } | boolean>;
  attribute_groups?: { attributes: { tag: string }[] }[];
  city_alias?: string;
};

const { positional, flags } = parseArgs();
const file = positional[0];
if (!file) {
  console.error('usage: pnpm tenant:from-2gis <export.json> --list | --ids id1,id2');
  process.exit(2);
}
const orgs: Org[] = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const contacts = (o: Org, type: string) => (o.contact_groups ?? []).flatMap((g) => g.contacts).filter((c) => c.type === type).map((c) => c.value ?? c.url ?? '');
const branchId = (o: Org) => o.id.split('_')[0]!;
const rubrics = (o: Org) => (o.rubrics ?? []).map((r) => r.name);

// 2GIS ids that already have a studio (their map_url points at the firm)
const taken = new Map<string, string>();
for (const d of readdirSync(TENANTS_DIR)) {
  const f = path.join(TENANTS_DIR, d, 'business.json');
  if (d.startsWith('_') || !existsSync(f)) continue;
  const m = /\/firm\/(\d+)/.exec(JSON.parse(readFileSync(f, 'utf8')).contacts?.map_url ?? '');
  if (m) taken.set(m[1]!, d);
}

if (flags.list) {
  const rows = orgs.filter((o) => contacts(o, 'website').length === 0 && !taken.has(branchId(o))).sort((a, b) => (b.reviews?.general_review_count ?? 0) - (a.reviews?.general_review_count ?? 0));
  for (const o of rows) {
    console.log(`${branchId(o)}  ${String(o.reviews?.general_review_count ?? 0).padStart(4)} отз  ${o.reviews?.general_rating ?? '-'}  ${o.name}  |  ${o.address_name ?? ''}  |  ${rubrics(o).join(', ')}`);
  }
  const already = orgs.filter((o) => taken.has(branchId(o))).map((o) => taken.get(branchId(o)));
  console.log(`\n${rows.length} из ${orgs.length} без сайта и без демо${already.length ? `; демо уже есть: ${already.join(', ')}` : ''}`);
  process.exit(0);
}

const ids = String(flags.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!ids.length) {
  console.error('нужен --list или --ids');
  process.exit(2);
}
const timezone = typeof flags['city-tz'] === 'string' ? flags['city-tz'] : 'Asia/Almaty';
const currency = typeof flags.currency === 'string' ? flags.currency : 'KZT';
const profile = flags.profile === 'wash' ? 'wash' : 'detailing';

const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i' };
const slugify = (s: string) =>
  [...s.toLowerCase()].map((ch) => TR[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

const ACCENTS = ['#4690FF', '#E5484D', '#30A46C', '#F76B15', '#8E4EC6', '#12A594', '#D6409F', '#FFB224', '#0090FF', '#E54666'];
const DAYS = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' } as const;

function hours(o: Org) {
  const out: Record<string, [string, string][]> = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  if (!o.schedule || !Object.keys(DAYS).some((d) => o.schedule![d])) {
    for (const d of Object.values(DAYS)) out[d] = d === 'sun' ? [] : [['10:00', '20:00']];
    return { hours: out, guessed: true };
  }
  for (const [k, d] of Object.entries(DAYS)) {
    const day = o.schedule[k];
    if (!day || typeof day === 'boolean') continue;
    out[d] = (day.working_hours ?? [])
      .map(({ from, to }): [string, string] => [from, to === '24:00' || to === '00:00' ? '23:59' : to])
      .filter(([a, b]) => a < b)
      .slice(0, 4);
  }
  return { hours: out, guessed: false };
}

type Svc = { key: string; name: string; category: string; price: number; from?: boolean; min: number; buffer?: number; description: string };
const DETAILING: Svc[] = [
  { key: 'detail-wash', name: 'Детейлинг-мойка', category: 'Мойка', price: 10000, min: 90, buffer: 15, description: 'Трёхфазная мойка, чистка дисков и арок, сушка.' },
  { key: 'interior', name: 'Химчистка салона', category: 'Салон', price: 40000, from: true, min: 360, buffer: 30, description: 'Сиденья, потолок, ковры и пластик.' },
  { key: 'polish', name: 'Полировка кузова', category: 'Кузов', price: 70000, from: true, min: 480, buffer: 30, description: 'Восстановительная полировка, удаление царапин и голограмм.' },
  { key: 'ceramic', name: 'Керамическое покрытие', category: 'Защита', price: 120000, from: true, min: 1440, buffer: 60, description: 'Подготовка, полировка и керамика. Машина остаётся у нас на сутки.' },
  { key: 'ppf', name: 'Плёнка на зоны риска', category: 'Защита', price: 250000, from: true, min: 2880, buffer: 60, description: 'Капот, бампер, фары и зеркала полиуретановой плёнкой.' },
];
const TINT: Svc[] = [{ key: 'tint', name: 'Тонировка задней полусферы', category: 'Стёкла', price: 25000, from: true, min: 180, description: 'Плёнка на задние стёкла, без снятия обшивки.' }];
const BODY: Svc[] = [
  { key: 'estimate', name: 'Осмотр и расчёт стоимости', category: 'Кузов', price: 0, min: 30, description: 'Мастер осмотрит повреждения и назовёт цену и сроки.' },
  { key: 'pdr', name: 'Удаление вмятин без покраски', category: 'Кузов', price: 15000, from: true, min: 120, description: 'PDR: выправляем вмятины без шпаклёвки и покраски.' },
  { key: 'paint', name: 'Ремонт и покраска элемента', category: 'Кузов', price: 60000, from: true, min: 1440, buffer: 60, description: 'Рихтовка, подготовка и покраска одного элемента.' },
];
const WASH: Svc[] = [{ key: 'complex-wash', name: 'Комплексная мойка', category: 'Мойка', price: 6000, min: 60, description: 'Кузов, коврики, пылесос салона и протирка пластика.' }];
// car wash profile: short services on wash posts
const CARWASH: Svc[] = [
  { key: 'express', name: 'Экспресс-мойка кузова', category: 'Мойка', price: 3000, min: 30, description: 'Бесконтактная мойка кузова и сушка.' },
  { key: 'complex', name: 'Комплексная мойка', category: 'Мойка', price: 6000, min: 60, description: 'Кузов, коврики, пылесос салона, протирка пластика и стёкол.' },
  { key: 'body-wax', name: 'Мойка кузова с воском', category: 'Мойка', price: 4500, min: 45, description: 'Двухфазная мойка, горячий воск, сушка.' },
  { key: 'engine', name: 'Мойка двигателя', category: 'Дополнительно', price: 5000, min: 45, description: 'Бережная мойка подкапотного пространства с консервантом.' },
  { key: 'wheels', name: 'Мойка дисков и чернение шин', category: 'Дополнительно', price: 2000, min: 30, description: 'Очиститель для дисков, чернение резины.' },
  { key: 'interior-wash', name: 'Химчистка салона', category: 'Салон', price: 25000, from: true, min: 240, buffer: 15, description: 'Сиденья, потолок, ковры и пластик.' },
];
const WASH_POLISH: Svc[] = [{ key: 'polish', name: 'Полировка кузова', category: 'Кузов', price: 50000, from: true, min: 360, buffer: 30, description: 'Полировка в один шаг, удаление мелких царапин.' }];

function services(o: Org) {
  const r = rubrics(o).join(' ').toLowerCase();
  if (profile === 'wash') {
    return [...CARWASH, ...(r.includes('детейлинг') ? WASH_POLISH : [])].map((s) => ({
      key: s.key, name: s.name, category: s.category, description: s.description,
      price: s.price, price_is_from: Boolean(s.from), duration_minutes: s.min, buffer_minutes: s.buffer ?? 0,
      resources: ['post-1', 'post-2', 'post-3'],
    }));
  }
  const body = r.includes('кузов');
  const list = [...(body ? BODY : []), ...DETAILING, ...(/тонир|плён/.test(r) ? TINT : []), ...(r.includes('мойк') ? WASH : [])];
  return list.map((s) => ({
    key: s.key, name: s.name, category: s.category, description: s.description,
    price: s.price, price_is_from: Boolean(s.from), duration_minutes: s.min, buffer_minutes: s.buffer ?? 0,
    resources: ['bay-1', 'bay-2'],
  }));
}

function infoCards(o: Org, open7: boolean) {
  const cards: { icon: string; title: string; text: string }[] = [];
  const rating = o.reviews?.general_rating;
  const count = o.reviews?.general_review_count ?? 0;
  if (rating && count >= 10) cards.push({ icon: 'star', title: `Рейтинг ${String(rating).replace('.', ',')} в 2GIS`, text: `${count} отзывов клиентов.` });
  const tags = new Set((o.attribute_groups ?? []).flatMap((g) => g.attributes.map((a) => a.tag)));
  if (tags.has('general_payment_type_qrcode') || tags.has('general_payment_type_card')) {
    cards.push({ icon: 'thumbs-up', title: 'Удобная оплата', text: tags.has('general_payment_type_qrcode') ? 'Картой, по QR-коду или наличными.' : 'Картой или наличными.' });
  }
  const allDay = open7 && Object.values(hours(o).hours).every((d) => d.length === 1 && d[0]![0] === '00:00' && d[0]![1] === '23:59');
  if (allDay) cards.push({ icon: 'clock', title: 'Круглосуточно', text: 'Работаем 24/7, без выходных.' });
  else if (open7) cards.push({ icon: 'clock', title: 'Без выходных', text: 'Работаем каждый день.' });
  if (profile === 'wash') cards.splice(cards.length && cards[0]!.icon === 'star' ? 1 : 0, 0, { icon: 'timer', title: 'Без очереди', text: 'Выберите время онлайн и приезжайте к своему посту.' });
  else cards.push({ icon: 'timer', title: 'Запись за минуту', text: 'Выберите услугу и время, студия подтвердит запись.' });
  return cards.slice(0, 3);
}

const placeholder = path.join(TENANTS_DIR, '_placeholder');
const galleryFiles = readdirSync(path.join(placeholder, 'gallery')).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
const CAPTIONS = profile === 'wash'
  ? ['Комплексная мойка', 'Мойка кузова с воском', 'Химчистка салона', 'Мойка дисков', 'Мойка двигателя', 'Экспресс-мойка']
  : ['Полировка и керамика', 'Защитная плёнка', 'Химчистка салона', 'Керамика на диски', 'Детейлинг-мойка', 'Тонировка'];

let n = 0;
for (const id of ids) {
  const o = orgs.find((x) => branchId(x) === id);
  if (!o) {
    console.error(`${id}: нет в файле`);
    continue;
  }
  const name = (o.name_ex?.primary ?? o.name).trim();
  const slug = typeof flags[`slug-${id}`] === 'string' ? (flags[`slug-${id}`] as string) : slugify(name);
  const dir = tenantDir(slug);
  if (taken.has(id)) {
    console.error(`${id}: демо уже есть (${taken.get(id)}), пропускаю`);
    continue;
  }
  if (existsSync(dir)) {
    console.error(`${slug}: папка уже есть, пропускаю`);
    continue;
  }
  const phone = contacts(o, 'phone')[0];
  if (!phone) {
    console.error(`${slug}: нет телефона, пропускаю`);
    continue;
  }
  const city = o.adm_div?.find((d) => d.type === 'city')?.name ?? '';
  const h = hours(o);
  const open7 = Object.values(h.hours).every((d) => d.length > 0);
  const accent = ACCENTS[n % ACCENTS.length]!;
  const rub = rubrics(o).filter((x) => x.length < 40).slice(0, 3);
  const config = {
    $schema: '../business.schema.json',
    slug,
    name,
    short_name: name.slice(0, 24),
    kind: profile,
    timezone,
    currency,
    locale: 'ru-RU',
    accent_color: accent,
    tagline: o.name_ex?.extension ? `${o.name_ex.extension[0]!.toUpperCase()}${o.name_ex.extension.slice(1)} в ${city === 'Астана' ? 'Астане' : city}` : `${profile === 'wash' ? 'Автомойка' : (rub[0] ?? 'Детейлинг')} в ${city === 'Астана' ? 'Астане' : city}`,
    description: `${rub.join(', ')}. Выберите услугу и удобное время онлайн, без звонков и ожидания ответа.`,
    contacts: {
      address: `${city}, ${o.address_name ?? ''}`.replace(/,\s*$/, ''),
      address_note: '',
      phone,
      map_url: `https://2gis.kz/${o.city_alias ?? 'astana'}/firm/${branchId(o)}`,
    },
    booking: profile === 'wash'
      ? { cancellation_hours: 1, slot_step_minutes: 15, min_notice_minutes: 30, horizon_days: 14, reminder_hours: 2 }
      : { cancellation_hours: 12, slot_step_minutes: 30, min_notice_minutes: 60, horizon_days: 30, reminder_hours: 24 },
    images: { logo: 'logo.png', hero: 'hero.jpg' },
    info_cards: infoCards(o, open7),
    resources: profile === 'wash'
      ? [1, 2, 3].map((i) => ({ key: `post-${i}`, name: `Пост ${i}` }))
      : [
          { key: 'bay-1', name: 'Бокс 1' },
          { key: 'bay-2', name: 'Бокс 2' },
        ],
    services: services(o),
    hours: h.hours,
    closed_dates: [],
    gallery: galleryFiles.map((f, i) => ({ key: `w${i + 1}`, image: `gallery/${f}`, caption: CAPTIONS[i] ?? '' })),
  };
  mkdirSync(path.join(dir, 'images', 'gallery'), { recursive: true });
  writeFileSync(path.join(dir, 'business.json'), JSON.stringify(config, null, 2) + '\n');
  copyFileSync(path.join(placeholder, 'hero.jpg'), path.join(dir, 'images', 'hero.jpg'));
  for (const f of galleryFiles) copyFileSync(path.join(placeholder, 'gallery', f), path.join(dir, 'images', 'gallery', f));
  writeFileSync(path.join(dir, 'images', 'logo.png'), await renderLogo(name, accent));
  n += 1;
  console.log(`${slug}: ${name}, ${config.services.length} услуг${h.guessed ? ', часы НЕ указаны в 2GIS (поставлены 10–20, пн–сб)' : ''}`);
}
console.log(`\nСоздано студий: ${n}. Дальше: pnpm tenant:validate <slug> и pnpm tenant:publish <slug> --no-owner`);
