import { expect, test, type Page } from '@playwright/test';

// Demo owner created by supabase/seed.sql (local/preview only).
const OWNER = { email: 'owner@graphite.demo', password: 'demo-owner-2026' };

async function pickFirstFreeSlot(page: Page) {
  const slot = page.locator('.slot-chip:not([disabled])').first();
  await expect(slot).toBeVisible();
  const label = (await slot.textContent())!.trim();
  await slot.click();
  return label;
}

test('client books a service and the owner sees it', async ({ page }, info) => {
  const name = `Тест ${info.project.name} ${Date.now() % 100000}`;
  await page.goto('/s/graphite/');
  await expect(page.getByRole('heading', { level: 1, name: 'GRAPHITE Detailing' })).toBeVisible();

  // 1. service
  await page.locator('.glass-cta').click();
  await expect(page.getByRole('heading', { name: 'Выберите услугу' })).toBeVisible();
  await page.getByRole('button', { name: /Детейлинг-мойка/ }).click();

  // 2. time: booked times are disabled and marked
  await expect(page.getByRole('heading', { name: 'Выберите время' })).toBeVisible();
  const time = await pickFirstFreeSlot(page);
  const day = new URL(page.url()).searchParams.get('day');
  expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // 3. contacts with validation
  await expect(page.getByRole('heading', { name: 'Ваши контакты' })).toBeVisible();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await expect(page.getByText('Укажите имя')).toBeVisible();
  await page.getByLabel('Имя').fill(name);
  await page.getByLabel('Телефон').fill('+7 900 123-45-67');
  await page.getByLabel('Автомобиль').fill('BMW X5 чёрный');
  await page.getByRole('button', { name: 'Дальше' }).click();

  // 4. confirm
  await expect(page.getByRole('heading', { name: 'Проверьте запись' })).toBeVisible();
  await expect(page.getByText(time).first()).toBeVisible();
  await page.getByRole('button', { name: 'Записаться', exact: true }).last().click();

  // 5. success with honest reminder offer
  await expect(page.getByRole('heading', { name: 'Вы записаны' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить в календарь' })).toBeVisible();
  await page.getByRole('button', { name: 'Моя запись' }).click();
  await expect(page.getByText('Детейлинг-мойка').first()).toBeVisible();
  await expect(page.getByText('Подтверждена')).toBeVisible();

  // 6. owner cabinet shows the booking on that day
  await page.goto('/s/graphite/owner/');
  await page.getByLabel('Почта').fill(OWNER.email);
  await page.getByLabel('Пароль').fill(OWNER.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Записи' })).toBeVisible();
  for (let i = 0; i < 31; i++) {
    if (await page.getByText(name).count()) break;
    await page.getByRole('button', { name: 'Вперёд' }).click();
    await page.waitForTimeout(250);
  }
  const row = page.getByText(name);
  await expect(row).toBeVisible();

  // owner marks the car accepted, records a payment, and stats update
  await page.getByRole('button', { name: new RegExp(`${time}.*${name}`) }).click();
  await page.getByRole('button', { name: 'Автомобиль принят' }).click();
  await expect(page.getByText('Принят').first()).toBeVisible();
  await page.getByRole('button', { name: 'Оплата / возврат' }).click();
  await page.getByLabel('Сумма').fill('3500');
  await page.getByLabel('Сумма').press('Enter');
  await page.getByRole('button', { name: 'Записать оплату' }).click();
  await expect(page.getByText(/\+3\s?500\s?₽/)).toBeVisible();

  // logout clears the cabinet
  await page.getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
});
