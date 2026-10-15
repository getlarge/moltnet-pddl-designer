import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/durable/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 20000,
    fileParallelism: false,
  },
});
