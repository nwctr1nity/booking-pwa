import { defineConfig, devices } from '@playwright/test';

// E2E runs against the Vite dev server and the LOCAL gateway (pnpm local:setup
// + pnpm local:gateway). It is not a test against a real Supabase project.
const executablePath = process.env.PW_CHROMIUM ?? (process.env.CI ? undefined : '/opt/pw-browsers/chromium');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', defaultBrowserType: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        { command: 'pnpm local:gateway', url: 'http://127.0.0.1:54321/health', reuseExistingServer: true, timeout: 30_000 },
        { command: 'pnpm dev --host 127.0.0.1', url: 'http://127.0.0.1:5173/', reuseExistingServer: true, timeout: 60_000 },
      ],
});
