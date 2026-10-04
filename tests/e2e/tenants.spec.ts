import { expect, test } from '@playwright/test';

// Two studios on one deployment: each renders its own data, and an owner of
// one studio cannot open the cabinet of another (RLS + membership check).
test('studios are isolated', async ({ page }) => {
  await page.goto('/s/kolesnyi-dvor/');
  await expect(page.getByRole('heading', { name: 'Запись на шиномонтаж' })).toBeVisible();
  await expect(page.getByText('Колёсный двор').first()).toBeVisible();
  await expect(page.getByText('GRAPHITE')).toHaveCount(0);

  await page.goto('/s/graphite/owner/');
  await page.getByLabel('Почта').fill('owner@graphite.demo');
  await page.getByLabel('Пароль').fill('demo-owner-2026');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Записи' })).toBeVisible();

  await page.goto('/s/kolesnyi-dvor/owner/');
  await expect(page.getByText('Нет доступа к этой студии')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Записи' })).toHaveCount(0);
});

test('unknown studio shows not found', async ({ page }) => {
  await page.goto('/s/no-such-studio/');
  await expect(page.getByText(/не найдена/i)).toBeVisible();
});
