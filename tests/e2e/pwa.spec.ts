import { expect, test } from '@playwright/test';

// Runs only against the production build (pnpm build && pnpm local:serve,
// E2E_BASE_URL=http://127.0.0.1:4173): the dev server has no per-studio
// shells and does not register the service worker.
test.skip(!process.env.E2E_BASE_URL, 'needs the built site');

test('each studio is its own installable app', async ({ page, request }) => {
  for (const slug of ['graphite', 'kolesnyi-dvor']) {
    const scope = `/s/${slug}/`;
    await page.goto(`${scope}my`);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', `${scope}manifest.webmanifest`);
    const manifest = await (await request.get(`${scope}manifest.webmanifest`)).json();
    expect(manifest).toMatchObject({ id: scope, start_url: scope, scope, display: 'standalone' });
    const reg = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.ready;
      return { scope: new URL(r.scope).pathname, script: new URL(r.active!.scriptURL).pathname };
    });
    expect(reg).toEqual({ scope, script: `${scope}sw.js` });
  }
  // every cache belongs to exactly one studio
  await expect
    .poll(async () => (await page.evaluate(() => caches.keys())).sort())
    .toEqual(expect.arrayContaining([expect.stringMatching(/^studio-graphite-/), expect.stringMatching(/^studio-kolesnyi-dvor-/)]));
  const keys = await page.evaluate(() => caches.keys());
  expect(keys.every((k) => /^studio-(graphite|kolesnyi-dvor)-/.test(k))).toBe(true);
});

test('the shell opens offline after the first visit', async ({ page, context }) => {
  await page.goto('/s/graphite/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the SW, which caches the shell
  await expect(page.getByRole('heading', { name: 'Запись в студию' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Запись в студию' })).toBeVisible();
  await context.setOffline(false);
});
