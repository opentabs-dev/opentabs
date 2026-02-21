/**
 * Side panel live-update E2E tests — verify that the side panel correctly
 * displays plugin changes triggered by config.json modifications.
 *
 * These tests exercise the full notification path:
 *   config.json change → config watcher → performConfigReload → sync.full →
 *   extension background processes sync.full → chrome.storage updated →
 *   offscreen broadcasts ws:message with sync.full to all extension contexts →
 *   side panel App.tsx detects sync.full and calls loadPlugins → config.getState →
 *   MCP server responds → side panel re-renders plugin cards
 *
 * The side panel is opened by navigating to its chrome-extension:// URL in a
 * regular tab. The App.tsx listener handles ws:message with sync.full as a
 * fallback notification (in addition to the primary sp:serverMessage path),
 * ensuring reliable updates regardless of how the side panel is opened.
 */

import {
  test,
  expect,
  startMcpServer,
  cleanupTestConfigDir,
  writeTestConfig,
  readPluginToolNames,
  launchExtensionContext,
  E2E_TEST_PLUGIN_DIR,
} from './fixtures.js';
import { waitForExtensionConnected, waitForLog, openSidePanel, setupAdapterSymlink } from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Side panel live-update tests
// ---------------------------------------------------------------------------

test.describe('Side panel live-update — plugins.changed notification', () => {
  test('side panel updates plugin list when config.json adds a plugin', async () => {
    // 1. Start MCP server with empty config (no plugins)
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-add-'));
    writeTestConfig(configDir, { localPlugins: [], tools: {} });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // Wait for extension to connect
      await waitForExtensionConnected(server);
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // 2. Open the side panel
      const sidePanelPage = await openSidePanel(context);

      // 3. Verify side panel initially shows onboarding state (fresh extension,
      //    no hasEverHadPlugins flag in chrome.storage.local)
      await expect(sidePanelPage.locator('text=Welcome to OpenTabs')).toBeVisible({ timeout: 10_000 });

      // 4. Add a plugin by modifying config.json
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      // 5. Verify the side panel DOM updates to show the new plugin.
      //    The App.tsx listener detects ws:message with sync.full (broadcast by
      //    the offscreen document) and triggers a config.getState refetch.
      await expect(sidePanelPage.locator('text=Welcome to OpenTabs')).toBeHidden({ timeout: 30_000 });
      await expect(sidePanelPage.locator('button[aria-expanded]')).toBeVisible({ timeout: 10_000 });
      await expect(sidePanelPage.locator('text=E2E Test')).toBeVisible({ timeout: 5_000 });

      await sidePanelPage.close();
    } finally {
      await context.close();
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('side panel updates when plugin is removed from config.json', async () => {
    // Start with the e2e-test plugin registered
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-remove-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Open side panel and verify plugin is initially visible
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.locator('text=E2E Test')).toBeVisible({ timeout: 30_000 });

      // Remove the plugin from config.json
      writeTestConfig(configDir, { localPlugins: [], tools: {} });

      // Verify the side panel updates to show empty state
      await expect(sidePanelPage.locator('text=No Plugins')).toBeVisible({ timeout: 30_000 });

      await sidePanelPage.close();
    } finally {
      await context.close();
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
