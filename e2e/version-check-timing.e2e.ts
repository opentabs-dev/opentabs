/**
 * E2E tests for version check timing — verify that checkForUpdates is NOT
 * called during POST /reload (moved to startup-only + periodic timer).
 *
 * The test starts a server, issues a POST /reload, and verifies that no
 * `npm view` activity appears in the server logs after the reload.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer } from './fixtures.js';
import { cleanupTestConfigDir, expect, startMcpServer, test } from './fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an isolated config directory with auth.json pre-populated. */
function createConfigDir(prefix: string): string {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), `opentabs-e2e-vcheck-${prefix}-`));
  const extensionDir = path.join(configDir, 'extension');
  fs.mkdirSync(extensionDir, { recursive: true });
  const secret = crypto.randomUUID();
  fs.writeFileSync(path.join(extensionDir, 'auth.json'), `${JSON.stringify({ secret })}\n`, 'utf-8');
  return configDir;
}

/** POST /reload with auth headers */
const postReload = (port: number, secret: string, timeoutMs = 30_000): Promise<Response> =>
  fetch(`http://localhost:${port}/reload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(timeoutMs),
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Version check timing', () => {
  test('POST /reload does NOT trigger npm view calls', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      configDir = createConfigDir('reload-timing');

      // Write a minimal config (no plugins to keep things fast)
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify(
          {
            version: 3,
            localPlugins: [],
            permissions: { browser: { permission: 'auto' } },
            settings: {},
          },
          null,
          2,
        ),
        'utf-8',
      );

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.status === 'ok');

      // Record the log length before the reload to isolate post-reload logs
      const logLengthBeforeReload = server.logs.length;

      // Issue a POST /reload
      const res = await postReload(server.port, server.secret ?? '');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      // Wait briefly for any async work to complete
      await new Promise(r => setTimeout(r, 1_000));

      // Check logs after the reload for any npm view or version check activity.
      // The `npm view` command is spawned by checkForUpdates (version-check.ts)
      // and its output/errors would appear in server logs. After US-005, this
      // should no longer happen during POST /reload.
      const postReloadLogs = server.logs.slice(logLengthBeforeReload);
      const versionCheckLines = postReloadLogs.filter(
        line => line.includes('npm view ') || line.includes('fetchLatestVersion'),
      );

      // No version check activity should appear after POST /reload
      expect(versionCheckLines).toHaveLength(0);
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});
