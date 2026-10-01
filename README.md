# Онлайн-запись для студий

PWA для записи в автосервисы, детейлинг- и шиномонтажные студии. Одна сборка обслуживает много студий; новая студия — это папка `tenants/<slug>/` с `business.json` и фото.

- Клиент: главная с фото и стеклянной кнопкой «Записаться», услуги, пошаговая запись в нижней панели (услуга → время → контакты → проверка), «Моя запись» с отменой и ссылкой, напоминание push или файлом календаря.
- Владелец (`/s/<slug>/owner/`): записи по дням и неделям, ручная запись, перенос, отмена, статусы, оплаты и возвраты, закрытие поста, деньги за период, настройки студии, услуг, постов, часов, выходных, карточек и галереи.
- Стек: React 19, TypeScript, Vite, React Router, TanStack Query, Zod, Astryx + shadcn Drawer (Base UI), Supabase (Postgres, Auth, Storage, Edge Functions), vite-plugin-pwa (injectManifest), Cloudflare Pages.

Документы:
- [SETUP.md](SETUP.md) — локальный запуск, Supabase, секреты и cron, публикация.
- [CLONE-IN-6-MINUTES.md](CLONE-IN-6-MINUTES.md) — новая студия.
- [ACCEPTANCE.md](ACCEPTANCE.md) — что проверено и что осталось проверить на реальной инфраструктуре.
- [docs/DECISIONS.md](docs/DECISIONS.md) — принятые решения.

Структура:
```
src/                 приложение (features/*: studio, home, booking, my-booking, services, owner)
src/sw.ts            service worker
supabase/migrations  схема, функции, RLS, хранилище, cron
supabase/functions   notify-dispatch (Web Push)
scripts/tenant       new / validate / publish / verify
scripts/build        оболочки студий для Cloudflare Pages
scripts/local        локальная база, шлюз, сервер dist
tenants/             конфигурации студий
tests/               db, functions, e2e
```
