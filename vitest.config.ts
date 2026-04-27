import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['platform/**/*.test.ts', 'e2e/**/*.test.ts'],
    globals: false,
    testTimeout: 30_000,
  },
});
