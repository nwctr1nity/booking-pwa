import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The owner edits the studio from the cabinet and the public page follows:
// a new gallery card, one replaced photo and one new caption, while the
// other cards keep photo, caption and position; a new service price.
// Mutates kolesnyi-dvor, so run once per fresh `pnpm local:setup`.
const PHOTO = path.resolve(import.meta.dirname, '../../tenants/graphite/images/gallery/porsche.jpg');

async function login(page: Page) {
  await page.goto('/s/kolesnyi-dvor/owner/');
  await page.getByLabel('Почта').fill('owner@kolesnyi-dvor.demo');
  await page.getByLabel('Пароль').fill('demo-owner-2026');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Записи' })).toBeVisible();
}

async function publicGallery(page: Page) {
  await page.goto('/s/kolesnyi-dvor/');
  const cards = page.locator('.photo-card img');
  await expect(cards.first()).toBeVisible();
  return cards.evaluateAll((imgs) => imgs.map((i) => ({ src: (i as HTMLImageElement).src.replace(/\?.*$/, ''), alt: (i as HTMLImageElement).alt })));
}

test('gallery edits touch only the chosen card', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'one run is enough: it changes shared data');
  const before = await publicGallery(page);
  expect(before.length).toBeGreaterThanOrEqual(2);

  await login(page);
  await page.goto('/s/kolesnyi-dvor/owner/settings/gallery');
  const cards = page.locator('[data-testid="gallery-card"]');
  await expect(cards).toHaveCount(before.length);

  // 1. replace the photo of the first card
  await cards.nth(0).locator('input[type="file"]').setInputFiles(PHOTO);
  await expect(page.getByRole('status').filter({ hasText: 'Фото заменено' }).first()).toBeVisible();

  // 2. new caption on the second card
  await cards.nth(1).getByLabel('Подпись').fill('Новый склад на 800 комплектов');
  await cards.nth(1).getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Подпись сохранена' }).first()).toBeVisible();

  // 3. add a card
  const add = page.locator('[data-testid="gallery-new"]');
  await add.locator('input[type="file"]').setInputFiles(PHOTO);
  await add.getByLabel('Подпись').fill('Новая карточка');
  await add.getByRole('button', { name: 'Добавить карточку' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Карточка добавлена' }).first()).toBeVisible();

  const after = await publicGallery(page);
  expect(after).toHaveLength(before.length + 1);
  expect(after[0]!.alt).toBe(before[0]!.alt); // caption kept
  expect(after[0]!.src).not.toBe(before[0]!.src); // photo replaced
  expect(after[1]!.src).toBe(before[1]!.src); // photo kept
  expect(after[1]!.alt).toBe('Новый склад на 800 комплектов');
  for (let i = 2; i < before.length; i++) expect(after[i]).toEqual(before[i]);
  expect(after.at(-1)!.alt).toBe('Новая карточка');
});

test('a new price shows on the public page', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'one run is enough: it changes shared data');
  await login(page);
  await page.goto('/s/kolesnyi-dvor/owner/settings/services');
  await page.getByText('Балансировка 4 колёс').click();
  await page.getByRole('spinbutton', { name: 'Цена' }).fill('1500');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('status').filter({ hasText: /сохран/i }).first()).toBeVisible();

  await page.goto('/s/kolesnyi-dvor/services');
  await expect(page.getByText('Балансировка 4 колёс')).toBeVisible();
  await expect(page.getByText(/1\s500\s₽/).first()).toBeVisible();
});

test('cabinet tabs stay inside the cabinet', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Деньги', exact: true }).click();
  await expect(page).toHaveURL(/\/s\/kolesnyi-dvor\/owner\/stats$/);
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page).toHaveURL(/\/s\/kolesnyi-dvor\/owner\/settings$/);
  await page.getByRole('button', { name: 'Записи', exact: true }).click();
  await expect(page).toHaveURL(/\/s\/kolesnyi-dvor\/owner\/$/);
});
