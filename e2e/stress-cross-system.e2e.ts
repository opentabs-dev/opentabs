/**
 * Cross-system chaos stress tests — exercises real-world scenarios where an AI
 * agent (MCP client), a user (side panel), and the CLI (config changes) are all
 * active simultaneously. These are the highest-value stress tests because they
 * verify the platform handles concurrent cross-boundary interactions gracefully.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  cleanupTestConfigDir,
  createMcpClient,
  E2E_TEST_PLUGIN_DIR,
  expect,
  launchExtensionContext,
  startMcpServer,
  startTestServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import {
  openSidePanel,
  openTestAppTab,
  selectPermission,
  setupAdapterSymlink,
  waitForExtensionConnected,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

/** Read the e2e-test plugin version from its package.json. */
const getPluginVersion = (): string => {
  const pkg = JSON.parse(fs.readFileSync(path.join(E2E_TEST_PLUGIN_DIR, 'package.json'), 'utf-8')) as {
    version: string;
  };
  return pkg.version;
};

const tick = (ms = 100) => new Promise(r => setTimeout(r, ms));
const collectPageErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (err: Error) => errors.push(err.message));
  return errors;
};

test.describe('Cross-system stress tests', () => {
  test('MCP client tool call while side panel toggles permission', async () => {
    test.slow();

    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cross-system-'));
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
        browser: { permission: 'auto' },
      },
    });

    // Disable skipPermissions so permission selects are interactive
    const server = await startMcpServer(configDir, false, undefined, {
      OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '',
    });
    const mcpClient = createMcpClient(server.port, server.secret);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      // Open test app tab and wait for adapter injection
      await openTestAppTab(context, testServer.url, server, testServer);

      // Wait until the e2e-test tools are callable
      await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'warmup' }, { isError: false }, 15_000);

      // Open side panel
      const sp = await openSidePanel(context);
      const pageErrors = collectPageErrors(sp);

      // Wait for plugin card to appear
      await expect(sp.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Expand e2e-test plugin card
      const e2eCard = sp.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await e2eCard.click();
      await tick(200);

      // Start a slow tool call (3s) via MCP client — do NOT await
      const slowCallPromise = mcpClient.callTool('e2e-test_slow_with_progress', {
        durationMs: 3000,
      });

      // While the slow call is running, toggle the echo tool's permission Off→Auto
      await tick(300); // let the slow call get started
      await selectPermission(sp, 'Permission for e2e-test plugin', 'Off');
      await tick(200);
      await selectPermission(sp, 'Permission for e2e-test plugin', 'Auto');

      // Wait for the slow call to settle
      const [slowResult] = await Promise.allSettled([slowCallPromise]);

      // The slow call should resolve (either success or clean error — not a crash)
      expect(slowResult.status).toBe('fulfilled');

      // Verify the side panel's permission select shows 'Auto'
      const e2ePluginTrigger = sp.locator('[aria-label="Permission for e2e-test plugin"]');
      await expect(e2ePluginTrigger).toContainText('Auto', { timeout: 10_000 });

      // Verify mcpClient.listTools() shows echo tool enabled
      await expect
        .poll(
          async () => {
            const tools = await mcpClient.listTools();
            const echo = tools.find(t => t.name === 'e2e-test_echo');
            return echo !== undefined && !echo.description.startsWith('[Disabled]');
          },
          { timeout: 15_000, message: 'e2e-test_echo should not be disabled after permission toggle' },
        )
        .toBe(true);

      // Make a fresh echo call to verify the system is healthy
      const echoResult = await mcpClient.callTool('e2e-test_echo', { message: 'post-chaos' });
      expect(echoResult.isError).toBe(false);
      const parsed = JSON.parse(echoResult.content) as { message: string };
      expect(parsed.message).toBe('post-chaos');

      // Assert zero page errors
      expect(pageErrors).toEqual([]);

      await sp.close();
    } finally {
      await mcpClient.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
