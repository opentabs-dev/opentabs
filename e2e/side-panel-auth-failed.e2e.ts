/**
 * Side panel auth-failed E2E test — verifies the side panel shows the
 * "Authentication Failed" empty state when the extension connects with
 * a wrong secret.
 *
 * Uses manual setup (not the standard extensionContext fixture) because
 * it needs to launch the extension with a deliberately mismatched secret.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { McpServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  createTestConfigDir,
  expect,
  launchExtensionContext,
  startMcpServer,
  test,
} from './fixtures.js';
import { openSidePanel, setupAdapterSymlink, waitForExtensionConnected } from './helpers.js';

test.describe('Side panel auth failed', () => {
  test('shows Authentication Failed when extension has wrong secret', async () => {
    const configDir = createTestConfigDir();
    let server: McpServer | null = null;
    let cleanupDir: string | null = null;

    try {
      server = await startMcpServer(configDir, true);

      // Launch extension with a WRONG secret — does not match the server's secret
      const { context, cleanupDir: extCleanupDir } = await launchExtensionContext(server.port, 'wrong-secret-value');
      cleanupDir = extCleanupDir;

      try {
        // Open the side panel and wait for "Authentication Failed" to appear.
        // This is the polling wait — the side panel only shows this state after
        // the extension has actually attempted /ws-info and received a 401
        // rejection. Waiting here is both faster and more reliable than a
        // fixed sleep.
        const sidePanelPage = await openSidePanel(context);
        await expect(sidePanelPage.getByText('Authentication Failed')).toBeVisible({ timeout: 15_000 });

        // Verify the extension is NOT connected (meaningful now — auth rejection confirmed)
        const health = await server.health();
        expect(health).not.toBeNull();
        if (!health) throw new Error('health returned null');
        expect(health.extensionConnected).toBe(false);

        // It should NOT show the other disconnect states
        await expect(sidePanelPage.getByText('Cannot Reach MCP Server')).not.toBeVisible();

        // Verify /health still shows extension disconnected
        const health2 = await server.health();
        expect(health2).not.toBeNull();
        if (!health2) throw new Error('health returned null');
        expect(health2.extensionConnected).toBe(false);

        await sidePanelPage.close();
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

test.describe('stress', () => {
  test('recovers from auth failure after writing correct secret', async () => {
    const configDir = createTestConfigDir();
    let server: McpServer | null = null;
    let cleanupDir: string | null = null;

    const pageErrors: Error[] = [];

    try {
      server = await startMcpServer(configDir, true);

      // Launch extension with a WRONG secret — triggers auth failure
      const ext = await launchExtensionContext(server.port, 'wrong-secret-value');
      cleanupDir = ext.cleanupDir;

      // Set up adapter symlink so plugins can be discovered after recovery
      setupAdapterSymlink(configDir, ext.extensionDir);

      try {
        const sidePanelPage = await openSidePanel(ext.context);
        sidePanelPage.on('pageerror', err => pageErrors.push(err));

        // Wait for "Authentication Failed" to appear
        await expect(sidePanelPage.getByText('Authentication Failed')).toBeVisible({ timeout: 15_000 });

        // Verify extension is disconnected
        const health = await server.health();
        expect(health).not.toBeNull();
        if (!health) throw new Error('health returned null');
        expect(health.extensionConnected).toBe(false);

        // Write the CORRECT secret into the extension's auth.json.
        // The offscreen document re-reads auth.json on reconnect attempts
        // after receiving a 401 from /ws-info.
        const correctSecret = server.secret;
        const authJsonPath = path.join(ext.extensionDir, 'auth.json');
        fs.writeFileSync(authJsonPath, `${JSON.stringify({ secret: correctSecret })}\n`, 'utf-8');

        // Wait for the extension to reconnect with the correct secret
        await waitForExtensionConnected(server, 30_000);

        // Verify the side panel recovers — "Authentication Failed" should
        // disappear and plugin content should become visible.
        await expect(sidePanelPage.getByText('Authentication Failed')).not.toBeVisible({ timeout: 15_000 });
        await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });

        // Verify zero page errors
        expect(pageErrors).toHaveLength(0);

        await sidePanelPage.close();
      } finally {
        await ext.context.close();
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
