// pnpm tenant:outreach <export.json> --out <dir> [--profile detailing|wash|beauty] [--site https://….vercel.app] [--name astana-wash]
// Offer messages for the owners of the demo studios built by tenant:from-2gis:
// every organisation in the 2GIS export that already has a studio folder gets
// a personal message (name, rating, demo link) and its contacts. Only studios
// of the chosen profile (kind) are included.
// Writes <name>-messages.txt (all texts), <name>-outreach.html (a «write in
// WhatsApp» button per studio with the text filled in) and <name>-demos.csv.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../lib/args.ts';
import { TENANTS_DIR } from './load.ts';

type Contact = { type: string; value?: string; url?: string };
type Org = {
  id: string;
  name: string;
  name_ex?: { primary?: string };
  address_name?: string;
  contact_groups?: { contacts: Contact[] }[];
  reviews?: { general_rating?: number; general_review_count?: number };
  city_alias?: string;
};

const { positional, flags } = parseArgs();
const file = positional[0];
const outDir = typeof flags.out === 'string' ? flags.out : '';
if (!file || !outDir) {
  console.error('usage: pnpm tenant:outreach <export.json> --out <dir> [--profile detailing|wash] [--site url] [--name prefix]');
  process.exit(2);
}
const profile = flags.profile === 'wash' || flags.profile === 'beauty' ? flags.profile : 'detailing';
const site = (typeof flags.site === 'string' ? flags.site : 'https://booking-pwa-sigma.vercel.app').replace(/\/$/, '');
const prefix = typeof flags.name === 'string' ? flags.name : `astana-${profile}`;

const orgs: Org[] = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const bySlug = new Map<string, string>();
for (const d of readdirSync(TENANTS_DIR)) {
  const f = path.join(TENANTS_DIR, d, 'business.json');
  if (d.startsWith('_') || !existsSync(f)) continue;
  const cfg = JSON.parse(readFileSync(f, 'utf8'));
  // only demos of this profile: a wash that already got a detailing demo is not offered twice
  if ((cfg.kind ?? 'detailing') !== profile) continue;
  const m = /\/firm\/(\d+)/.exec(cfg.contacts?.map_url ?? '');
  if (m) bySlug.set(m[1]!, d);
}

const PITCH = {
  detailing: {
    gives: [
      'клиенты записываются сами 24/7, без звонков и переписки;',
      'видно свободное время по боксам, двойных записей не бывает;',
      'приложение ставится на телефон клиента с вашим логотипом;',
      'клиенту приходит напоминание о записи, меньше неявок;',
      'у вас свой кабинет: записи, оплаты, цены, часы и фото меняете сами.',
    ],
    value: 'Это меньше, чем один потерянный клиент на полировку или керамику. Клиенты пишут в 11 вечера, когда администратор уже не отвечает, и уходят к тем, у кого запись онлайн.',
  },
  wash: {
    gives: [
      'клиенты записываются на время сами, 24/7, без звонков;',
      'видно, какой пост свободен, машины не ждут в очереди;',
      'в выходные и в час пик посты загружены по записи, а не как повезёт;',
      'приложение ставится на телефон клиента с вашим логотипом, напоминание перед мойкой;',
      'у вас свой кабинет: записи, оплаты, цены и часы работы меняете сами.',
    ],
    value: 'Это стоимость нескольких моек. Клиент, который видит очередь из пяти машин, уезжает к соседям, а с записью он приезжает к своему времени и остаётся вашим.',
  },
  beauty: {
    gives: [
      'клиентки записываются сами 24/7, без звонков и переписки в директе;',
      'видно свободное время у каждого мастера, накладок и двойных записей нет;',
      'приложение ставится на телефон клиентки с вашим логотипом;',
      'клиентке приходит напоминание о визите, меньше неявок и пустых окон;',
      'у вас свой кабинет: записи, оплаты, цены, мастера и часы работы меняете сами.',
    ],
    value: 'Это стоимость пары маникюров. Клиентки пишут в директ в 11 вечера, когда администратор уже не отвечает, и записываются туда, где время можно выбрать онлайн.',
  },
}[profile];

const reviewsWord = (n: number) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? 'отзыв' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'отзыва' : 'отзывов';
};

const message = (o: Org, link: string, slug: string) => {
  const r = o.reviews ?? {};
  const name = (o.name_ex?.primary ?? o.name).trim();
  const rating = r.general_rating && (r.general_review_count ?? 0) >= 10
    ? `: рейтинг ${String(r.general_rating).replace('.', ',')} и ${r.general_review_count} ${reviewsWord(r.general_review_count ?? 0)}. ${profile === 'beauty' ? 'Видно, что к вам возвращаются и вам доверяют.' : 'Видно, что к вам едут и вам доверяют.'}`
    : '.';
  const first = slug.split('-')[0]!;
  const domain = first.length >= 3 ? first : slug.replace(/-/g, '').slice(0, 16);
  return `Здравствуйте! Увидел ${name} в 2GIS${rating}

Я сделал для вас приложение онлайн-записи, уже с вашим названием, адресом, часами работы и услугами. Посмотрите с телефона:
${link}

Что оно даёт:
${PITCH.gives.map((g) => `• ${g}`).join('\n')}

Сейчас там фото-заглушки и примерные цены, ваши поставлю за один день.

Стоимость 20 000 ₸ один раз, навсегда, без абонентской платы. ${PITCH.value} Хороший хозяин бизнеса такую выгоду не упускает.

Приложение работает по готовой ссылке. Если захотите свой адрес (домен, например ${domain}.kz), его нужно купить отдельно у регистратора доменов, не у меня.

Ссылка нигде не опубликована, её видите только вы. Я не навязываюсь: если неинтересно, просто ответьте «нет», и я удалю демо. Если интересно, отвечу на вопросы и запущу за день.`;
};

const contacts = (o: Org, type: string) => (o.contact_groups ?? []).flatMap((g) => g.contacts).filter((c) => c.type === type).map((c) => (c.value ?? c.url ?? '').split('?')[0]!);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const csvCell = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;

const rows = orgs
  .filter((o) => bySlug.has(o.id.split('_')[0]!))
  .map((o) => {
    const id = o.id.split('_')[0]!;
    const slug = bySlug.get(id)!;
    const link = `${site}/s/${slug}/`;
    const text = message(o, link, slug);
    const wa = contacts(o, 'whatsapp');
    const waNum = wa[0]?.replace(/\/$/, '').split('/').pop() ?? '';
    return {
      name: o.name, slug, link, text,
      phones: contacts(o, 'phone'), wa, telegram: contacts(o, 'telegram'), instagram: contacts(o, 'instagram'),
      waLink: waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(text)}` : '',
      address: o.address_name ?? '', gis: `https://2gis.kz/${o.city_alias ?? 'astana'}/firm/${id}`,
      rating: o.reviews?.general_rating ?? '', reviews: o.reviews?.general_review_count ?? 0,
    };
  })
  .sort((a, b) => b.reviews - a.reviews);

if (!rows.length) {
  console.error('В файле нет организаций с готовыми демо: сначала pnpm tenant:from-2gis … --ids');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

writeFileSync(path.join(outDir, `${prefix}-messages.txt`), rows.map((r, i) =>
  `===== ${i + 1}. ${r.name} =====\nКому: WhatsApp ${r.wa.join(', ') || '—'} · Instagram ${r.instagram.join(', ') || '—'}${r.telegram.length ? ` · Telegram ${r.telegram.join(', ')}` : ''} · тел. ${r.phones.join(', ')}\n\n${r.text}\n`).join('\n'));

const head = ['Студия', 'Демо-ссылка', 'Телефоны', 'WhatsApp', 'Написать в WhatsApp (с готовым текстом)', 'Telegram', 'Instagram', 'Адрес', '2GIS', 'Рейтинг', 'Отзывов', 'Сообщение', 'Статус'];
writeFileSync(path.join(outDir, `${prefix}-demos.csv`), '﻿' + [head.map(csvCell).join(';'), ...rows.map((r) =>
  [r.name, r.link, r.phones.join(', '), r.wa.join(', '), r.waLink, r.telegram.join(', '), r.instagram.join(', '), r.address, r.gis, r.rating, r.reviews, r.text, ''].map(csvCell).join(';'))].join('\r\n'));

const title = profile === 'wash' ? 'Автомойки' : profile === 'beauty' ? 'Салоны красоты' : 'Детейлинг';
writeFileSync(path.join(outDir, `${prefix}-outreach.html`), [
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Рассылка: ${title}</title>`,
  '<style>body{font:15px system-ui;margin:16px;max-width:760px}div{border:1px solid #ccc;border-radius:10px;padding:12px;margin:12px 0}a.b{display:inline-block;background:#25D366;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none;margin:4px 6px 4px 0}a.g{background:#444}pre{white-space:pre-wrap;font:14px system-ui;background:#f4f4f4;padding:8px;border-radius:8px}</style>',
  `<h1>${title}: ${rows.length} демо</h1>`,
  ...rows.map((r, i) => `<div><b>${i + 1}. ${esc(r.name)}</b> · ${r.rating} ★ · ${r.reviews} отз.<br>${esc(r.address)}<br>Тел: ${esc(r.phones.join(', '))}<br>`
    + (r.waLink ? `<a class=b href="${esc(r.waLink)}">Написать в WhatsApp</a>` : '')
    + r.instagram.map((u) => `<a class="b g" href="${esc(u)}">Instagram</a>`).join('')
    + r.telegram.map((u) => `<a class="b g" href="${esc(u)}">Telegram</a>`).join('')
    + `<a class="b g" href="${esc(r.link)}">Демо</a><a class="b g" href="${esc(r.gis)}">2GIS</a><details><summary>Текст сообщения</summary><pre>${esc(r.text)}</pre></details></div>`),
].join('\n'));

console.log(`${rows.length} сообщений → ${path.join(outDir, prefix)}-{messages.txt,outreach.html,demos.csv}`);
