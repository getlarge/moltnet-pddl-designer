import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    root: resolve(import.meta.dirname),
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'tests/api/**/*.test.ts',
      'tests/support/**/*.test.ts',
      'tests/web/**/*.test.ts',
    ],
    testTimeout: 10_000,
  },
});
