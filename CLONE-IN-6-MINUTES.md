# Новая студия за 6 минут

Предполагается, что сайт и Supabase уже настроены по [SETUP.md](SETUP.md), а в `.env` есть `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`.

**0:00 — заготовка**
```bash
pnpm tenant:new avtoblesk --name "Автоблеск" --owner owner@avtoblesk.ru --accent "#2BC48A" --timezone Europe/Moscow
```
Появится `tenants/avtoblesk/` с `business.json` и картинками-заглушками.

**0:30 — тексты и цены** — правьте `tenants/avtoblesk/business.json` (редактор подсказывает поля по `tenants/business.schema.json`):
- `name`, `short_name` (подпись под иконкой: до 24 символов, лучше до 12, чтобы не обрезалась), `tagline`, `description`;
- `contacts`: адрес, пояснение к заезду, телефон, ссылка на карту;
- `resources`: посты или боксы, `key` латиницей;
- `services`: название, цена, `price_is_from` для «от», длительность в минутах, буфер на уборку, на каких постах выполняется. Многодневные работы: длительность больше суток (например, `2880` = 2 дня);
- `hours` по дням недели (`[]` = выходной; несколько интервалов = перерыв), `closed_dates`;
- `info_cards`: 3 карточки, `icon` из списка в схеме;
- `booking`: за сколько часов можно отменить, шаг слотов, минимальный запас до записи, горизонт, за сколько часов напоминать.

**3:00 — фото** — положите в `tenants/avtoblesk/images/`:
- `logo.png` — квадратный, от 512×512, из него делаются иконки приложения;
- `hero.jpg` — горизонтальный, от 1600 px по ширине, главное в центре;
- `gallery/*.jpg` — по одному на каждую запись `gallery` в `business.json`.

**4:00 — проверка и публикация**
```bash
pnpm tenant:validate avtoblesk          # ошибки с указанием поля; ничего не пишет
pnpm tenant:publish avtoblesk --demo    # база + фото + владелец; студия в статусе preview
```
Временный пароль владельца печатается один раз — передайте его владельцу, он сменит его позже.

**5:00 — сайт**
```bash
git add tenants/avtoblesk && git commit -m "Studio: Автоблеск" && git push
```
Cloudflare Pages пересоберёт сайт; у студии появится свой адрес `/s/avtoblesk/` и своё устанавливаемое приложение.

**6:00 — запуск**
```bash
pnpm tenant:verify avtoblesk --site https://<project>.pages.dev --activate
```
Скрипт проверяет оболочку, манифест, иконки, service worker, данные, картинки и слоты. Если всё зелёное, студия переходит в `live`, демо-записи удаляются. Если нет — ничего не активируется, в выводе видно, что исправить.

Дальше владелец сам меняет цены, часы, фото и карточки в кабинете `/s/avtoblesk/owner/`. Повторный `tenant:publish` его правки не перезапишет.

Локально весь цикл можно прогнать без облака: `pnpm local:setup && pnpm local:gateway`, затем те же команды, а вместо Pages — `pnpm build && pnpm local:serve` и `--site http://127.0.0.1:4173`.
