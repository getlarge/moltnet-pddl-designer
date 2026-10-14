import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4418',
    headless: true,
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'pnpm exec tsx scripts/ui-test-server.ts',
    url: 'http://127.0.0.1:4418',
    reuseExistingServer: false,
  },
  reporter: 'list',
});
