/**
 * Onboarding E2E tests — verify side panel state transitions for new users,
 * plugin discovery, and disconnection.
 *
 * These tests exercise the side panel's onboarding state machine:
 *   - Fresh extension with 0 plugins → onboarding view (Welcome to OpenTabs)
 *   - Adding a plugin → transition to plugin list
 *   - Server disconnect → disconnected state (not onboarding)
 *
 * All tests use dynamic ports and isolated config directories.
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
// Onboarding state tests
// ---------------------------------------------------------------------------

test.describe('Onboarding states', () => {
  test('fresh extension with 0 plugins shows onboarding view with welcome heading and checklist', async () => {
    // Start MCP server with empty config (no plugins)
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-onboard-fresh-'));
    writeTestConfig(configDir, { localPlugins: [], tools: {} });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);

      // Open the side panel
      const sidePanelPage = await openSidePanel(context);

      // Verify the onboarding heading is visible
      await expect(sidePanelPage.locator('text=Welcome to OpenTabs')).toBeVisible({ timeout: 10_000 });

      // Verify the setup checklist items are visible
      await expect(sidePanelPage.locator('text=MCP server running')).toBeVisible({ timeout: 5_000 });
      await expect(sidePanelPage.locator('text=Plugins installed')).toBeVisible({ timeout: 5_000 });

      // "MCP server running" should be checked (server is connected)
      // "Plugins installed" should be unchecked (0 plugins)
      // The description text should be visible
      await expect(sidePanelPage.locator('text=OpenTabs gives AI agents access to your web apps')).toBeVisible({
        timeout: 5_000,
      });

      // Install instruction should be present
      await expect(sidePanelPage.locator('text=npm install -g opentabs-plugin-slack')).toBeVisible({
        timeout: 5_000,
      });

      // Search suggestion should be present
      await expect(sidePanelPage.locator('text=opentabs plugin search')).toBeVisible({ timeout: 5_000 });

      await sidePanelPage.close();
    } finally {
      await context.close();
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('adding a plugin transitions the side panel from onboarding to plugin list', async () => {
    // Start MCP server with empty config (no plugins)
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-onboard-transition-'));
    writeTestConfig(configDir, { localPlugins: [], tools: {} });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Open the side panel and verify onboarding state
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.locator('text=Welcome to OpenTabs')).toBeVisible({ timeout: 10_000 });

      // Add a plugin via config.json modification
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      // Verify the onboarding view disappears and the plugin list appears
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

  test('disconnected state shows when server stops, not onboarding', async () => {
    // Start MCP server with empty config (no plugins)
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-onboard-disconnect-'));
    writeTestConfig(configDir, { localPlugins: [], tools: {} });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);

      // Open the side panel and verify onboarding state
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.locator('text=Welcome to OpenTabs')).toBeVisible({ timeout: 10_000 });

      // Kill the MCP server
      await server.kill();

      // Verify the disconnected state appears (not onboarding)
      await expect(sidePanelPage.locator('text=Cannot Reach MCP Server')).toBeVisible({ timeout: 30_000 });
      await expect(sidePanelPage.locator('text=Welcome to OpenTabs')).toBeHidden({ timeout: 5_000 });

      await sidePanelPage.close();
    } finally {
      await context.close();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
