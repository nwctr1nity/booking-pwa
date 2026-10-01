# SETUP

Онлайн-запись для автосервисов и детейлинг-студий. Одна сборка обслуживает много студий: каждая живёт по адресу `/s/<slug>/` и ставится на телефон как отдельное приложение. Данные студии, записи и оплаты хранятся в Supabase, сайт статический и разворачивается на Cloudflare Pages.

- [1. Локальный запуск](#1-локальный-запуск)
- [2. Проект Supabase](#2-проект-supabase)
- [3. Напоминания: Web Push, Edge Function, cron](#3-напоминания-web-push-edge-function-cron)
- [4. Публикация сайта на Vercel](#4-публикация-сайта-на-vercel)
- [5. Новая студия](#5-новая-студия)
- [6. Тесты](#6-тесты)
- [Где какие ключи](#где-какие-ключи)

## 1. Локальный запуск

Нужно: Node 22, pnpm 10, PostgreSQL 16 на `127.0.0.1:54322` (пользователь `postgres`, пароль `postgres`).

```bash
pnpm install
pnpm local:setup        # пересоздаёт базу app_local: миграции + seed, демо-картинки, .env.local
pnpm local:gateway      # :54321 — локальный шлюз, повторяющий REST/Auth/Storage/Functions Supabase
pnpm dev                # :5173
```

Откройте <http://127.0.0.1:5173/s/graphite/> (детейлинг) или <http://127.0.0.1:5173/s/kolesnyi-dvor/> (шиномонтаж).
Кабинет владельца: `/s/graphite/owner/`, вход `owner@graphite.demo` / `demo-owner-2026` (только локально и в demo-seed).

Локальный шлюз (`scripts/local/gateway.ts`) — эмулятор, а не Supabase: он выполняет те же SQL-функции и RLS той же базы, выдаёт JWT, хранит файлы в `.local/storage`. Поведение Supabase Auth (письма, лимиты, refresh) он повторяет только в объёме, нужном приложению. Если у вас есть Docker, вместо него можно поднять настоящий стек: `npx supabase start` (конфиг в `supabase/config.toml`), затем прописать выданные URL и anon key в `.env.local`.

Рассылка напоминаний локально: `pnpm local:functions` запускает Edge Function под Deno на :54330, шлюз проксирует `/functions/v1/*`.

Собранный сайт локально, с теми же правилами маршрутизации, что у Vercel (`HOST=cloudflare` — как у Cloudflare Pages):

```bash
pnpm build && pnpm local:serve   # http://127.0.0.1:4173/s/graphite/
```

## 2. Проект Supabase

**Быстрый путь — одна команда.** Положите личный токен Supabase (supabase.com → Account → Access Tokens) в `.env` как `SUPABASE_ACCESS_TOKEN=sbp_…` и выполните:

```bash
pnpm supabase:deploy --site https://<project>.vercel.app
```

Скрипт через Management API (без пароля базы и Docker) применяет новые миграции, выключает публичную регистрацию, создаёт ключи push (публичный записывает в `.env.production` — закоммитьте его), кладёт секреты функции и Vault и деплоит `notify-dispatch`. Повторный запуск безопасен: применённые миграции пропускаются. `--dry-run` показывает, что будет сделано. Если в конце нет cron-задач, включите `pg_cron` и `pg_net` (Database → Extensions) и запустите ещё раз.

Ниже — те же шаги вручную через Supabase CLI.

1. Создайте проект на <https://supabase.com/dashboard>. Регион ближе к клиентам (например, Frankfurt).
2. Установите CLI и привяжите проект:
   ```bash
   npx supabase login
   npx supabase link --project-ref turyhotwzlaqcknmhofq
   ```
3. Примените миграции (seed с демо-владельцами на боевой проект **не** попадает):
   ```bash
   npx supabase db push
   ```
   Миграции создают схему, функции записи, RLS, бакет `tenant-media`, а если в проекте есть `pg_cron` и `pg_net` — расписание рассылки.
4. **Отключите публичную регистрацию.** Dashboard → Authentication → Sign In / Providers → Email: выключите *Allow new users to sign up*. Владельцев создаёт только `pnpm tenant:publish` через admin API. Это обязательный шаг: без него любой может создать аккаунт (доступа к студиям он всё равно не получит — права даёт только `tenant_members`, — но аккаунтов быть не должно).
5. Authentication → URL Configuration: *Site URL* = адрес сайта на Vercel.
6. Ключи (Project Settings → API Keys):
   - адрес проекта и **publishable key** (`sb_publishable_…`) уже записаны в `.env.production` в репозитории: они публичные и попадают в сайт при сборке;
   - **secret key** (`sb_secret_…`) — в `.env` на вашей машине (по образцу `.env.example`) как `SUPABASE_SECRET_KEY`, вместе с `SUPABASE_URL`. Он нужен только скриптам `tenant:*`, никогда не коммитится и не попадает в сборку сайта или в Vercel. Если ключ где-то засветился, создайте новый и удалите старый в том же разделе.

## 3. Напоминания: Web Push, Edge Function, cron

Клиент после записи может включить напоминание за N часов (по умолчанию 24). Запись о напоминании ставится в очередь `notification_jobs`; Edge Function `notify-dispatch` раз в 5 минут забирает созревшие задания, шифрует их по RFC 8291 и подписывает VAPID (RFC 8292). Если push недоступен (iOS без установки на экран «Домой», запрет уведомлений), клиенту предлагается файл календаря `.ics`.

1. Ключи:
   ```bash
   pnpm vapid:keys
   ```
   Публичный → `VITE_VAPID_PUBLIC_KEY` (сборка сайта) и `VAPID_PUBLIC_KEY`; приватный → только `VAPID_PRIVATE_KEY` в секретах функции.
2. Секреты функции:
   ```bash
   npx supabase secrets set \
     VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com \
     NOTIFY_CRON_SECRET=$(openssl rand -hex 24)
   ```
   `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` Supabase передаёт функциям сам. Если в проекте отключены старые JWT-ключи, добавьте секретом `SUPABASE_SECRET_KEY=sb_secret_…` — функция возьмёт его.
3. Деплой функции (JWT не проверяется: функцию вызывает cron с заголовком `x-cron-secret`, см. `supabase/config.toml`):
   ```bash
   npx supabase functions deploy notify-dispatch --no-verify-jwt
   ```
4. Расписание. Dashboard → Database → Extensions: включите `pg_cron` и `pg_net`, затем перезапустите миграцию расписания:
   ```bash
   npx supabase db push --include-all   # или выполните supabase/migrations/20261001000900_cron.sql в SQL Editor
   ```
   В SQL Editor положите адрес функции и секрет в Vault:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/notify-dispatch', 'notify_dispatch_url');
   select vault.create_secret('<тот же NOTIFY_CRON_SECRET>', 'notify_dispatch_secret');
   ```
5. Проверка: `select * from cron.job;` показывает `notify-dispatch` и `rate-limit-cleanup`; после первой записи с напоминанием `select status, attempts, last_error from notification_jobs order by created_at desc limit 5;`.
   Ручной вызов: `curl -X POST -H "x-cron-secret: $NOTIFY_CRON_SECRET" https://<project-ref>.supabase.co/functions/v1/notify-dispatch` возвращает `{claimed, sent, failed, gone}`.

## 4. Публикация сайта на Vercel

Сайт статический: `pnpm build` собирает общий бандл, а затем `scripts/build/tenant-shells.ts` создаёт для каждой студии из `tenants/` свою оболочку в `dist/s/<slug>/`: HTML с названием, метаданными и CSP, `manifest.webmanifest` (id, start_url и scope = `/s/<slug>/`), иконки, maskable-иконку, apple-touch-icon, заставки iOS и копию service worker (у каждой студии своя область и свои кэши). Правила хостинга лежат в `vercel.json`: глубокие ссылки `/s/<slug>/…` ведут в оболочку своей студии, `sw.js` и манифест не кэшируются, `/assets/*` кэшируются навсегда.

1. https://vercel.com/new → Import Git Repository → `nwctr1nity/booking-pwa`.
2. Framework Preset: *Other*. Команды сборки и папка берутся из `vercel.json` (`pnpm build`, `dist`), Node — из `engines` в `package.json` (22).
3. Переменные окружения не нужны: публичные адрес и ключ Supabase лежат в `.env.production`. Когда появятся ключи push, добавьте `VITE_VAPID_PUBLIC_KEY` (или впишите его в `.env.production`).
   **Никогда** не добавляйте в Vercel `SUPABASE_SECRET_KEY` / service-role key.
4. Deploy. Каждый push в `main` обновляет сайт, остальные ветки получают preview-адреса.
5. Свой домен: Project → Settings → Domains.

Новая студия появляется на сайте после следующей сборки (нужна её оболочка). Данные (услуги, цены, часы, фото) берутся из базы во время работы и обновляются без пересборки.

Запасной вариант — Cloudflare Pages: та же сборка дополнительно пишет `dist/_redirects` и `dist/_headers`. Build command `pnpm build`, output `dist`, без переменных окружения.

## 5. Новая студия

Коротко — в [CLONE-IN-6-MINUTES.md](CLONE-IN-6-MINUTES.md).

```bash
pnpm tenant:new <slug> --name "Название" --owner owner@example.com [--kind detailing|service|tire|wash|other] [--accent "#4690FF"] [--timezone Europe/Moscow]
# отредактируйте tenants/<slug>/business.json, замените картинки в tenants/<slug>/images/
pnpm tenant:validate <slug>
pnpm tenant:publish <slug> [--demo]
git add tenants/<slug> && git commit && git push      # Vercel пересобирает сайт
pnpm tenant:verify <slug> --site https://<project>.vercel.app --activate
```

- `tenant:publish` пишет конфигурацию в базу по стабильным ключам. Повторная публикация не трогает записи, оплаты, другие студии и то, что владелец поменял в кабинете (такие поля перечисляются в отчёте). Новая студия создаётся в статусе `preview`: на сайте видна плашка «демо», `--demo` добавляет помеченные демо-записи.
- Владелец создаётся через admin API, временный пароль печатается один раз. Если такой пользователь уже есть, ему просто выдаётся доступ.
- `tenant:verify` проверяет развернутый сайт и базу: оболочку и глубокую ссылку, манифест и иконки, sw.js, публичные данные (и что в них нет персональных данных), картинки, расчёт слотов, совпадение версии конфигурации. Только если всё прошло и указан `--activate`, студия переводится в `live`, демо-записи удаляются.
- Отключить студию: `select pipeline_set_status('<slug>', 'disabled');` от имени service_role.

## 6. Тесты

```bash
pnpm typecheck && pnpm lint
pnpm test:unit             # время/часовые пояса, ICS, валидация, цены
pnpm test:db               # SQL: гонки записи, EXCLUDE, RLS, идемпотентность, оплаты, outbox, публикация
pnpm test:functions        # notify-dispatch под Deno + тестовый push-сервер
pnpm test:e2e              # Playwright: телефон и десктоп, dev-сервер
pnpm build && pnpm local:serve &
E2E_BASE_URL=http://127.0.0.1:4173 pnpm test:e2e     # то же на собранном сайте + PWA и офлайн
```

DB- и functions-тесты создают свою временную базу на том же PostgreSQL :54322.

## Где какие ключи

| Значение | Где живёт | Попадает в браузер |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.production` в репозитории | да (публичные) |
| `VITE_VAPID_PUBLIC_KEY` | `.env.production` или env Vercel | да (публичный) |
| `SUPABASE_SECRET_KEY` (`sb_secret_…`) | `.env` на машине оператора / секрет CI | нет |
| `VAPID_PRIVATE_KEY`, `NOTIFY_CRON_SECRET` | `supabase secrets` (+ секрет в Vault) | нет |
