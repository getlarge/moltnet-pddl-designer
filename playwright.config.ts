import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4418',
    headless: true,
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'pnpm exec tsx scripts/ui-test-server.ts',
    url: 'http://127.0.0.1:4418',
    reuseExistingServer: false,
  },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
});
