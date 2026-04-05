/**
 * Cross-domain side panel stress test — interleaves permission toggles,
 * search, accordion expand/collapse, and theme toggling in a single test.
 * Verifies no crashes and server state consistency after the barrage.
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
  test,
  writeTestConfig,
} from './fixtures.js';
import {
  openSidePanel,
  selectPermission,
  setupAdapterSymlink,
  waitForExtensionConnected,
  waitForLog,
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

test.describe('Side panel stress test', () => {
  test('interleaved permission, theme, search, and accordion actions do not crash', async () => {
    test.slow();

    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-stress-cross-'));
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
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);
      await mcpClient.initialize();

      const sp = await openSidePanel(context);
      const pageErrors = collectPageErrors(sp);

      // Wait for both plugin cards to appear
      await expect(sp.getByText('E2E Test').first()).toBeVisible({ timeout: 30_000 });
      await expect(sp.getByText('Browser', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

      // Locate UI elements
      const e2eCard = sp.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      const browserCard = sp.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      const themeToggle = sp.locator('[aria-label="Switch to dark mode"], [aria-label="Switch to light mode"]');
      const searchInput = sp.getByPlaceholder('Search plugins and tools...');

      // Expand both cards
      await e2eCard.click();
      await tick(100);
      await browserCard.click();
      await tick(100);

      // ---------------------------------------------------------------
      // Round 1 — permission toggles + theme
      // ---------------------------------------------------------------
      await selectPermission(sp, 'Permission for e2e-test plugin', 'Off');
      await themeToggle.click();
      await selectPermission(sp, 'Permission for browser tools', 'Off');
      await themeToggle.click();
      await selectPermission(sp, 'Permission for e2e-test plugin', 'Auto');
      await selectPermission(sp, 'Permission for browser tools', 'Auto');

      // ---------------------------------------------------------------
      // Round 2 — accordion + search + theme
      // ---------------------------------------------------------------
      await e2eCard.click(); // collapse
      await tick(50);
      await browserCard.click(); // collapse
      await tick(50);

      await searchInput.fill('echo');
      await tick(200);
      await searchInput.fill('');
      await tick(100);

      await themeToggle.click();
      await tick(50);
      await themeToggle.click();

      // Re-expand cards
      // Check aria-expanded state and expand if collapsed
      const e2eExpanded = await e2eCard.getAttribute('aria-expanded');
      if (e2eExpanded !== 'true') await e2eCard.click();
      await tick(50);

      const browserExpanded = await browserCard.getAttribute('aria-expanded');
      if (browserExpanded !== 'true') await browserCard.click();
      await tick(50);

      // ---------------------------------------------------------------
      // Round 3 — rapid permission + accordion
      // ---------------------------------------------------------------
      await selectPermission(sp, 'Permission for e2e-test plugin', 'Ask');
      await e2eCard.click(); // toggle
      await tick(30);
      await browserCard.click(); // toggle
      await tick(30);
      await selectPermission(sp, 'Permission for browser tools', 'Ask');
      await e2eCard.click(); // toggle back
      await tick(30);
      await browserCard.click(); // toggle back
      await tick(30);
      await selectPermission(sp, 'Permission for e2e-test plugin', 'Auto');
      await selectPermission(sp, 'Permission for browser tools', 'Auto');

      // ---------------------------------------------------------------
      // Post-barrage verification
      // ---------------------------------------------------------------

      // Clear search to ensure default view
      await searchInput.fill('');
      await tick(200);

      // Verify both permission selects show 'Auto'
      const e2ePluginTrigger = sp.locator('[aria-label="Permission for e2e-test plugin"]');
      const browserTrigger = sp.locator('[aria-label="Permission for browser tools"]');
      await expect(e2ePluginTrigger).toContainText('Auto', { timeout: 10_000 });
      await expect(browserTrigger).toContainText('Auto', { timeout: 10_000 });

      // Verify plugin cards still visible
      await expect(sp.getByText('E2E Test').first()).toBeVisible();
      await expect(sp.getByText('Browser', { exact: true }).first()).toBeVisible();

      // Poll mcpClient.listTools() to verify tools are not disabled
      await expect
        .poll(
          async () => {
            const tools = await mcpClient.listTools();
            const echo = tools.find(t => t.name === 'e2e-test_echo');
            const listTabs = tools.find(t => t.name === 'browser_list_tabs');
            return (
              echo !== undefined &&
              !echo.description.startsWith('[Disabled]') &&
              listTabs !== undefined &&
              !listTabs.description.startsWith('[Disabled]')
            );
          },
          {
            timeout: 15_000,
            message: 'e2e-test_echo and browser_list_tabs should not be disabled after barrage',
          },
        )
        .toBe(true);

      // Assert zero page errors
      expect(pageErrors).toEqual([]);

      await sp.close();
    } finally {
      await mcpClient.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
