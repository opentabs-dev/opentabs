/**
 * Auth bootstrap E2E tests — verifies the extension can connect when auth.json
 * is written AFTER the extension loads, and recovers after secret rotation.
 *
 * These tests exercise the US-002 fix (re-read auth.json before every WebSocket
 * connection attempt) and the US-003 logging (console.warn on bootstrap failure).
 *
 * Both tests use custom setup (not the standard extensionContext fixture) because
 * they need fine-grained control over when auth.json exists in the extension
 * directory.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { McpServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createTestConfigDir,
  expect,
  launchExtensionContext,
  startMcpServer,
  symlinkCrossPlatform,
  test,
} from './fixtures.js';
import { setupAdapterSymlink, waitForExtensionConnected, waitForLog } from './helpers.js';

test.describe('Auth bootstrap', () => {
  test('extension connects after auth.json is written post-load', async () => {
    test.slow();

    // 1. Create config dir (includes auth.json for the server) and start server
    const configDir = createTestConfigDir();
    let server: McpServer | null = null;
    let cleanupDir: string | null = null;

    try {
      server = await startMcpServer(configDir, true);

      // 2. Create extension copy WITHOUT a secret — no auth.json in extension dir
      const { context, cleanupDir: extCleanupDir, extensionDir } = await launchExtensionContext(server.port);

      cleanupDir = extCleanupDir;

      // Set up adapter symlink so the server and extension share adapter IIFEs
      setupAdapterSymlink(configDir, extensionDir);

      // DO NOT symlink auth.json — the whole point of this test is that
      // auth.json does not exist when the extension first loads.

      try {
        // 3. Wait for the extension to attempt connection and fail.
        //    Without auth.json, wsSecret is null → /ws-info returns 401 → auth_failed.
        //    The extension retries with exponential backoff (1s initial, 2x multiplier,
        //    3s cap). After 3 seconds it has made at least 2 connection attempts that
        //    both returned auth_failed — enough to confirm it is in its retry loop.
        await new Promise(r => setTimeout(r, 3_000));
        const h = await server?.health();
        expect(h?.extensionConnected).toBe(false);

        // 5. Write auth.json to the extension directory with the server's secret.
        //    The extension's next connect() call will run bootstrapFromAuthFile(),
        //    pick up the secret, and authenticate successfully.
        const authJson = `${JSON.stringify({ secret: server.secret })}\n`;
        fs.writeFileSync(path.join(extensionDir, 'auth.json'), authJson, 'utf-8');

        // 6. Wait for the extension to reconnect. The backoff timer will fire
        //    connect() → bootstrapFromAuthFile() reads auth.json → /ws-info
        //    succeeds → WebSocket connects. The backoff may be at 2-4s by now.
        await waitForExtensionConnected(server, 45_000);
        await waitForLog(server, 'plugin(s) mapped', 15_000);

        // 7. Verify connection via /health
        const h2 = await server.health();
        expect(h2).not.toBeNull();
        if (!h2) throw new Error('health returned null');
        expect(h2.status).toBe('ok');
        expect(h2.extensionConnected).toBe(true);

        // 8. Verify tool dispatch works
        const client = createMcpClient(server.port, server.secret);
        await client.initialize();
        try {
          const result = await client.callTool('browser_list_tabs');
          expect(result.isError).toBe(false);
        } finally {
          await client.close();
        }
      } finally {
        await context.close();
      }
    } finally {
      if (server) await server.kill();
      cleanupTestConfigDir(configDir);
      if (cleanupDir) {
        try {
          fs.rmSync(cleanupDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }
  });

  test('extension recovers from stale secret after server restart with new secret', async () => {
    test.slow();

    // 1. Create config dir (includes auth.json with the initial secret) and start server
    const configDir = createTestConfigDir();
    let server: McpServer | null = null;
    let cleanupDir: string | null = null;

    try {
      server = await startMcpServer(configDir, true);

      // 2. Create extension copy WITH the server's secret — extension starts connected
      const {
        context,
        cleanupDir: extCleanupDir,
        extensionDir,
      } = await launchExtensionContext(server.port, server.secret);

      cleanupDir = extCleanupDir;

      // Set up adapter symlink so the server and extension share adapter IIFEs
      setupAdapterSymlink(configDir, extensionDir);

      // Symlink auth.json from server config dir to extension dir so writing
      // to the server's auth.json automatically updates the extension's copy.
      const serverAuthJson = path.join(configDir, 'extension', 'auth.json');
      const extensionAuthJson = path.join(extensionDir, 'auth.json');
      fs.rmSync(extensionAuthJson, { force: true });
      symlinkCrossPlatform(serverAuthJson, extensionAuthJson, 'file');

      try {
        // 3. Wait for initial connection and verify tools work
        await waitForExtensionConnected(server, 45_000);
        await waitForLog(server, 'plugin(s) mapped', 15_000);

        const h1 = await server.health();
        expect(h1).not.toBeNull();
        if (!h1) throw new Error('health returned null');
        expect(h1.extensionConnected).toBe(true);

        const client1 = createMcpClient(server.port, server.secret);
        await client1.initialize();
        try {
          const preResult = await client1.callTool('browser_list_tabs');
          expect(preResult.isError).toBe(false);
        } finally {
          await client1.close();
        }

        // 4. Rotate the secret: write a new secret to auth.json.
        //    Because of the symlink, writing to the server's auth.json
        //    also updates the extension's copy.
        const newSecret = `rotated-${crypto.randomUUID()}`;
        const authPath = path.join(configDir, 'extension', 'auth.json');
        fs.writeFileSync(authPath, `${JSON.stringify({ secret: newSecret })}\n`, 'utf-8');

        // 5. Trigger hot reload so the server picks up the new secret
        server.logs.length = 0;
        server.triggerHotReload();

        // Wait for hot reload to complete
        await waitForLog(server, 'Hot reload complete', 15_000);
        server.secret = newSecret;

        // 6. Wait for the extension to reconnect. The hot reload restarts the
        //    worker, which breaks the existing WebSocket. The extension detects
        //    the disconnect and reconnects. On reconnect, bootstrapFromAuthFile()
        //    re-reads auth.json (via the symlink), picks up the new secret, and
        //    authenticates with /ws-info using the rotated credentials.
        await waitForExtensionConnected(server, 45_000);
        await waitForLog(server, 'plugin(s) mapped', 15_000);

        // 7. Verify connection via /health
        const h2 = await server.health();
        expect(h2).not.toBeNull();
        if (!h2) throw new Error('health returned null');
        expect(h2.status).toBe('ok');
        expect(h2.extensionConnected).toBe(true);

        // 8. Verify tool dispatch works with the new secret
        const client2 = createMcpClient(server.port, newSecret);
        await client2.initialize();
        try {
          const postResult = await client2.callTool('browser_list_tabs');
          expect(postResult.isError).toBe(false);
        } finally {
          await client2.close();
        }
      } finally {
        await context.close();
      }
    } finally {
      if (server) await server.kill();
      cleanupTestConfigDir(configDir);
      if (cleanupDir) {
        try {
          fs.rmSync(cleanupDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }
  });
});
