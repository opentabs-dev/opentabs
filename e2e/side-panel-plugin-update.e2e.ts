/**
 * Side panel plugin update UI E2E tests.
 *
 * Verifies:
 *   1. When a plugin has an available update, the three-dot menu button shows
 *      a yellow dot indicator
 *   2. Opening the menu shows an "Update to vX.Y.Z" menu item
 *   3. When no update is available, no dot is shown and no Update menu item appears
 *
 * These tests use the dev-only `POST /__test/set-outdated` endpoint to inject
 * fake outdated plugin data into the MCP server state and trigger a
 * `plugins.changed` notification.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupTestConfigDir,
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
  setupAdapterSymlink,
  waitForExtensionConnected,
  waitForLog,
} from './helpers.js';

/** Read the e2e-test plugin's package name and version from its package.json. */
const getPluginPackageInfo = (): { name: string; version: string } => {
  const pkg = JSON.parse(fs.readFileSync(path.join(E2E_TEST_PLUGIN_DIR, 'package.json'), 'utf-8')) as {
    name: string;
    version: string;
  };
  return { name: pkg.name, version: pkg.version };
};

/**
 * Inject fake outdated plugin entries into the MCP server via the dev-only
 * test endpoint. Triggers a `plugins.changed` notification to the extension.
 */
const setOutdatedPlugins = async (
  port: number,
  secret: string,
  outdatedPlugins: Array<{ name: string; currentVersion: string; latestVersion: string; updateCommand: string }>,
): Promise<void> => {
  const res = await fetch(`http://localhost:${port}/__test/set-outdated`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ outdatedPlugins }),
  });
  if (!res.ok) {
    throw new Error(`setOutdatedPlugins failed: ${res.status} ${await res.text()}`);
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Side panel — plugin update indicator', () => {
  test('update dot and menu item appear when update is available, disappear when cleared', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const { name: pkgName, version: currentVersion } = getPluginPackageInfo();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-update-'));
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: { 'e2e-test': { permission: 'auto' } },
    });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      // Open a matching tab so the plugin is in 'ready' state
      await openTestAppTab(context, testServer.url, server, testServer);

      const sidePanelPage = await openSidePanel(context);

      // Wait for the plugin card to appear
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // --- Verify: no update dot when no update is available ---
      const menuButton = sidePanelPage.locator('[aria-label="Plugin options"]');
      await expect(menuButton).toBeVisible();

      // The update dot is a child div with bg-primary class
      const updateDot = menuButton.locator('div.rounded-full');
      await expect(updateDot).not.toBeVisible();

      // Open menu and verify no Update menu item exists
      await menuButton.click();
      const updateMenuItem = sidePanelPage.locator('[role="menuitem"]', { hasText: /^Update to v/ });
      await expect(updateMenuItem).not.toBeVisible();

      // Close menu by pressing Escape
      await sidePanelPage.keyboard.press('Escape');

      // --- Inject fake update data ---
      const fakeLatestVersion = '99.0.0';
      const secret = server.secret;
      expect(secret).toBeTruthy();
      if (!secret) throw new Error('Server secret is required');
      await setOutdatedPlugins(server.port, secret, [
        {
          name: pkgName,
          currentVersion,
          latestVersion: fakeLatestVersion,
          updateCommand: `npm update -g ${pkgName}`,
        },
      ]);

      // --- Verify: update dot now visible ---
      await expect(updateDot).toBeVisible({ timeout: 10_000 });

      // Open menu and verify Update menu item appears with correct version
      await menuButton.click();
      await expect(updateMenuItem).toBeVisible({ timeout: 5_000 });
      await expect(updateMenuItem).toContainText(`Update to v${fakeLatestVersion}`);

      // Close menu
      await sidePanelPage.keyboard.press('Escape');

      // --- Clear outdated plugins and verify dot disappears ---
      await setOutdatedPlugins(server.port, secret, []);

      await expect(updateDot).not.toBeVisible({ timeout: 10_000 });

      // Open menu and verify Update menu item is gone
      await menuButton.click();
      await expect(updateMenuItem).not.toBeVisible();
    } finally {
      await context.close();
      await server.kill();
      await testServer.kill();
      cleanupTestConfigDir(configDir);
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
  });
});
