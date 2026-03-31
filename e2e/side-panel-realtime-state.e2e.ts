/**
 * Side panel real-time state propagation E2E tests — verify state changes
 * propagate to the side panel in real-time via push notifications, without
 * requiring a side panel reload.
 *
 * These tests exercise the background-only communication architecture where:
 *   1. Plugin permission change via config reload → plugins.changed → side panel updates
 *   2. Tab state changes (auth, close) → tab.stateChanged → side panel updates
 *   3. Browser tool permission change via config reload → plugins.changed → side panel updates
 *   4. Server disconnect/reconnect → side panel recovers all states
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
  BROWSER_TOOL_NAMES,
  openSidePanel,
  selectPermission,
  setupAdapterSymlink,
  waitForExtensionConnected,
  waitForLog,
} from './helpers.js';

/** Read the e2e-test plugin version from its package.json for reviewedVersion matching. */
const e2eTestPluginVersion = (
  JSON.parse(fs.readFileSync(path.join(E2E_TEST_PLUGIN_DIR, 'package.json'), 'utf-8')) as { version: string }
).version;

// ---------------------------------------------------------------------------
// Real-time state propagation tests
// ---------------------------------------------------------------------------

test.describe('Side panel real-time state propagation', () => {
  test('plugin permission change reflects in side panel without reload', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-realtime-tool-'));
    // Start with all e2e-test tools at 'auto' permission
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: { 'e2e-test': { permission: 'auto' } },
    });

    // Disable skipPermissions so permission changes are visible in the UI
    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);
      await waitForLog(server, 'Config watcher: Watching', 10_000);
      await mcpClient.initialize();

      // Open side panel and expand the plugin card
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();

      // Verify echo tool's Radix Select trigger shows 'Auto' initially
      const echoTrigger = sidePanelPage.locator('[aria-label="Permission for echo tool"]');
      await expect(echoTrigger).toBeVisible({ timeout: 5_000 });
      await expect(echoTrigger).toContainText('Auto', { timeout: 5_000 });

      // Change the echo tool to 'off' by modifying config.json and triggering reload.
      // This sends plugins.changed to the extension → background updates cache →
      // side panel receives the push and updates without reload.
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        permissions: { 'e2e-test': { permission: 'auto', tools: { echo: 'off' } } },
      });
      await waitForLog(server, 'Config reload complete', 10_000);

      // Verify the side panel Radix Select reflects 'Off' state WITHOUT reloading
      await expect(echoTrigger).toContainText('Off', { timeout: 10_000 });

      // Verify the MCP server sees the tool with [Disabled] prefix via tools/list
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const echoTool = toolList.find(t => t.name === 'e2e-test_echo');
            return echoTool?.description?.startsWith('[Disabled]') ?? false;
          },
          { timeout: 15_000, message: 'MCP server did not reflect echo tool as disabled' },
        )
        .toBe(true);

      // Re-enable the tool via config change (remove per-tool override)
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        permissions: { 'e2e-test': { permission: 'auto' } },
      });
      server.logs.length = 0;
      await waitForLog(server, 'Config reload complete', 10_000);

      // Verify the side panel Radix Select reflects 'Auto' state WITHOUT reloading
      await expect(echoTrigger).toContainText('Auto', { timeout: 10_000 });

      await sidePanelPage.close();
    } finally {
      await mcpClient.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('auth off then tab reload shows amber dot without side panel reload', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-realtime-auth-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], permissions: {} });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      // Open side panel
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      const e2ePluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });

      // Open a matching tab (auth is ON by default → ready state)
      const appTab = await context.newPage();
      await appTab.goto(testServer.url, { waitUntil: 'load' });

      // Wait for the ready state (solid border) to appear via real-time push
      await expect(e2ePluginCard.locator('xpath=..').locator('[class*="border-border/30"]')).toBeHidden({
        timeout: 30_000,
      });

      // Toggle auth OFF on the test server
      await testServer.setAuth(false);

      // Reload the app tab to trigger a tab state recheck
      await appTab.reload({ waitUntil: 'load' });

      // Verify the unavailable state (faded ghost border) appears WITHOUT reloading the side panel.
      // The background pushes tab.stateChanged → side panel updates instantly.
      await expect(e2ePluginCard.locator('xpath=..').locator('[class*="border-border/30"]')).toBeVisible({
        timeout: 10_000,
      });

      // Toggle auth back ON and verify recovery to ready state
      await testServer.setAuth(true);
      await appTab.reload({ waitUntil: 'load' });

      await expect(e2ePluginCard.locator('xpath=..').locator('[class*="border-border/30"]')).toBeHidden({
        timeout: 10_000,
      });

      await sidePanelPage.close();
      await appTab.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('closing matching tab removes dot without side panel reload', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-realtime-close-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], permissions: {} });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      // Open side panel
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      const e2ePluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });

      // Verify closed state initially (faded ghost border, no matching tab)
      await expect(e2ePluginCard.locator('xpath=..').locator('[class*="border-border/30"]')).toBeVisible({
        timeout: 5_000,
      });

      // Open a matching tab → ready state (solid border) appears via real-time push
      const appTab = await context.newPage();
      await appTab.goto(testServer.url, { waitUntil: 'load' });

      await expect(e2ePluginCard.locator('xpath=..').locator('[class*="border-border/30"]')).toBeHidden({
        timeout: 30_000,
      });

      // Close the matching tab → closed state (faded border) returns WITHOUT reloading side panel
      await appTab.close();

      await expect(e2ePluginCard.locator('xpath=..').locator('[class*="border-border/30"]')).toBeVisible({
        timeout: 10_000,
      });

      await sidePanelPage.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('browser tool permission change reflects in side panel without reload', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-realtime-btool-'));
    // Start with browser tools at 'auto' permission
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: { browser: { permission: 'auto' } },
    });

    // Disable skipPermissions so permission changes are visible in the UI
    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);
      await waitForLog(server, 'Config watcher: Watching', 10_000);
      await mcpClient.initialize();

      // Open side panel and expand the Browser tools card
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('Browser')).toBeVisible({ timeout: 30_000 });

      const browserCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await browserCard.click();

      // Pick a browser tool to toggle — the ToolRow aria-label uses the full prefixed name
      const targetBrowserTool = BROWSER_TOOL_NAMES[0] ?? 'browser_list_tabs';
      const toolTrigger = sidePanelPage.locator(`[aria-label="Permission for ${targetBrowserTool} tool"]`);
      await expect(toolTrigger).toBeVisible({ timeout: 5_000 });
      await expect(toolTrigger).toContainText('Auto', { timeout: 5_000 });

      // Disable the browser tool by writing plugins config to config.json
      // Browser tool permission keys use the full prefixed name
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        permissions: { browser: { permission: 'auto', tools: { [targetBrowserTool]: 'off' } } },
      });
      await waitForLog(server, 'Config reload complete', 10_000);

      // Verify the side panel Radix Select reflects 'Off' state WITHOUT reloading
      await expect(toolTrigger).toContainText('Off', { timeout: 10_000 });

      // Verify the tool has [Disabled] prefix in MCP tools/list
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const tool = toolList.find(t => t.name === targetBrowserTool);
            return tool?.description?.startsWith('[Disabled]') ?? false;
          },
          { timeout: 15_000, message: `MCP server did not reflect ${targetBrowserTool} as disabled` },
        )
        .toBe(true);

      // Re-enable the browser tool by removing the per-tool override
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        permissions: { browser: { permission: 'auto' } },
      });
      server.logs.length = 0;
      await waitForLog(server, 'Config reload complete', 10_000);

      // Verify the side panel Radix Select reflects 'Auto' state WITHOUT reloading
      await expect(toolTrigger).toContainText('Auto', { timeout: 10_000 });

      await sidePanelPage.close();
    } finally {
      await mcpClient.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('server disconnect and reconnect recovers all states', async () => {
    test.slow();

    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-realtime-reconn-'));
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
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      // Open a matching tab and wait for ready state
      const appTab = await context.newPage();
      await appTab.goto(testServer.url, { waitUntil: 'load' });

      // Open side panel and verify plugin card with ready state (solid border)
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      const e2ePluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await expect(e2ePluginCard.locator('xpath=..').locator('[class*="border-border/30"]')).toBeHidden({
        timeout: 30_000,
      });

      // Trigger hot reload (simulates server disconnect/reconnect)
      server.logs.length = 0;
      server.triggerHotReload();

      // Verify disconnect state appears during the reload window.
      // The side panel should show "Cannot Reach MCP Server" when the WebSocket drops.
      await expect(sidePanelPage.getByText('Cannot Reach MCP Server')).toBeVisible({
        timeout: 30_000,
      });

      await waitForLog(server, 'Hot reload complete', 20_000);
      await waitForExtensionConnected(server, 30_000);

      // After reconnect, verify plugin card reappears (from sync.full → plugins.changed)
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Verify ready state recovers (from sendTabSyncAll → tab.stateChanged push)
      await expect(e2ePluginCard.locator('xpath=..').locator('[class*="border-border/30"]')).toBeHidden({
        timeout: 30_000,
      });

      // Expand plugin card and verify tool permission Radix Select triggers are correct
      await e2ePluginCard.click();
      const echoTrigger = sidePanelPage.locator('[aria-label="Permission for echo tool"]');
      await expect(echoTrigger).toBeVisible({ timeout: 5_000 });
      await expect(echoTrigger).toContainText('Auto', { timeout: 5_000 });

      await sidePanelPage.close();
      await appTab.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Stress tests — inline helpers
// ---------------------------------------------------------------------------

const tick = (ms = 100) => new Promise(r => setTimeout(r, ms));
const collectPageErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (err: Error) => errors.push(err.message));
  return errors;
};

// ---------------------------------------------------------------------------
// Stress tests
// ---------------------------------------------------------------------------

test.describe('stress', () => {
  test('rapid permission changes propagate correctly without UI lag', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-realtime-stress-'));
    // reviewedVersion set to prevent the unreviewed plugin confirmation dialog
    // from blocking rapid permission toggling.
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: { 'e2e-test': { permission: 'auto', reviewedVersion: e2eTestPluginVersion } },
    });

    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);
      await mcpClient.initialize();

      const sidePanelPage = await openSidePanel(context);
      const pageErrors = collectPageErrors(sidePanelPage);

      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Expand plugin card to reveal permission select
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();
      await expect(sidePanelPage.locator('[aria-label="Permission for e2e-test plugin"]')).toBeVisible({
        timeout: 5_000,
      });

      // Rapidly toggle permission 5x: Off → Auto → Off → Auto → Off
      const sequence: Array<'Off' | 'Auto'> = ['Off', 'Auto', 'Off', 'Auto', 'Off'];
      for (const value of sequence) {
        await selectPermission(sidePanelPage, 'Permission for e2e-test plugin', value);
        await tick(100);
      }

      // Verify the final value ('Off') is shown in the UI
      const pluginSelect = sidePanelPage.locator('[aria-label="Permission for e2e-test plugin"]');
      await expect(pluginSelect).toContainText('Off', { timeout: 10_000 });

      // Change back to 'Auto' and verify all tools are enabled via MCP server
      await selectPermission(sidePanelPage, 'Permission for e2e-test plugin', 'Auto');
      await expect(pluginSelect).toContainText('Auto', { timeout: 10_000 });

      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const echo = toolList.find(t => t.name === 'e2e-test_echo');
            return echo !== undefined && !echo.description.startsWith('[Disabled]');
          },
          { timeout: 15_000, message: 'e2e-test_echo should be enabled after switching back to Auto' },
        )
        .toBe(true);

      expect(pageErrors).toEqual([]);

      await sidePanelPage.close();
    } finally {
      await mcpClient.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
