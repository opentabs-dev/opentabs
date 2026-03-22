import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  forbidOnly: !!process.env.CI,
  globalTimeout: 1_500_000,
  timeout: 120_000, // 2 min per test — hot reload + backoff needs headroom
  expect: {
    timeout: 30_000,
  },
  fullyParallel: true, // Each test gets its own dynamic ports — safe to parallelize
  retries: 2,
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    browserName: 'chromium',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'e2e',
      testMatch: '**/*.e2e.ts',
    },
  ],
});
