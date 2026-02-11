import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000, // 2 min per test — hot reload + backoff needs headroom
  expect: {
    timeout: 30_000,
  },
  fullyParallel: true, // Each test gets its own dynamic ports — safe to parallelize
  retries: 1, // 1 retry for resilience under parallel load (Chrome/extension startup can be flaky)
  workers: 4, // 4 parallel Chrome instances + MCP servers is the sweet spot; 6+ causes resource contention
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    browserName: "chromium",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "e2e",
      testMatch: "**/*.e2e.ts",
    },
  ],
});
