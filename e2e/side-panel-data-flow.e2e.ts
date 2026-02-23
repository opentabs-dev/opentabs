/**
 * Side panel data flow E2E tests — verify the three data paths:
 *
 * 1. Connection status: side panel reflects WebSocket connect/disconnect
 * 2. Tab state changes: direct push from background → side panel
 * 3. Tool invocation animation: spinner appears during tool execution
 */

import {
  test,
  expect,
  startMcpServer,
  startTestServer,
  createMcpClient,
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
// US-003: Connection status tests
// ---------------------------------------------------------------------------

test.describe('Side panel data flow — connection status', () => {
  test('shows connected status and transitions on server stop/restart', async () => {
    // 1. Start MCP server with e2e-test plugin
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-conn-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const serverPort = server.port;
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect
      await waitForExtensionConnected(server);
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // 3. Open side panel
      const sidePanelPage = await openSidePanel(context);

      // 4. Verify connected: plugin card visible (the redesigned UI shows plugin
      // cards when connected instead of a "Connected" text badge)
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 5. Kill MCP server
      await server.kill();

      // 6. Verify disconnected state appears with "Cannot Reach MCP Server" text.
      // The offscreen document detects WebSocket close and broadcasts connection state.
      // Pong timeout is 5s + reconnect backoff, so allow up to 30s.
      await expect(sidePanelPage.getByText('Cannot Reach MCP Server')).toBeVisible({ timeout: 30_000 });

      // 7. Restart MCP server on the same port
      const server2 = await startMcpServer(configDir, true, serverPort);

      try {
        // 8. Verify connected state reappears (plugin card visible again).
        // The offscreen document's reconnect logic will find the new server.
        await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 45_000 });
      } finally {
        await server2.kill();
      }

      await sidePanelPage.close();
    } finally {
      await context.close();
      // server.kill() is safe to call multiple times
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// US-004: Tab state change tests
// ---------------------------------------------------------------------------

test.describe('Side panel data flow — tab state changes', () => {
  test('tab state dot updates when matching tab opens and closes', async () => {
    // 1. Start MCP server with e2e-test plugin, start test server
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-tab-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect and content scripts to be registered
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      // 3. Open side panel
      const sidePanelPage = await openSidePanel(context);

      // 4. Verify plugin card is visible with 'E2E Test'
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 5. Verify the PluginIcon shows closed state (no status dot) and inline hint
      await expect(sidePanelPage.locator('.bg-success').first()).toBeHidden({ timeout: 5_000 });
      await expect(sidePanelPage.getByText('Open localhost')).toBeVisible({ timeout: 5_000 });

      // 6. Open a new tab to the test server URL (matches http://localhost/*)
      const appTab = await context.newPage();
      await appTab.goto(testServer.url, { waitUntil: 'load' });

      // 7. Wait for the server to report 'ready' state for the e2e-test plugin.
      // The background injects the adapter, then checks tab state — once the
      // adapter's isReady() returns true, the extension sends tab.stateChanged
      // to the MCP server which updates its tabMapping.
      await expect
        .poll(
          async () => {
            const res = await fetch(`http://localhost:${server.port}/health`, {
              headers: { Authorization: `Bearer ${server.secret ?? ''}` },
            });
            const body = (await res.json()) as {
              pluginDetails?: Array<{ name: string; tabState: string }>;
            };
            return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
          },
          { timeout: 30_000, message: 'Server tab state for e2e-test did not become ready' },
        )
        .toBe('ready');

      // Reload the side panel to pick up the latest tab state from the server.
      // In Playwright, the side panel runs as a regular extension page where
      // chrome.runtime.sendMessage from the background (sp:serverMessage) may
      // not arrive reliably — so we refresh to force a config.getState fetch.
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });

      // Verify the PluginIcon shows ready state (green status dot) and no hint text
      await expect(sidePanelPage.locator('.bg-success').first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(sidePanelPage.getByText('Open localhost')).toBeHidden({ timeout: 5_000 });

      // 8. Close the matching tab
      await appTab.close();

      // 9. Wait for server to report 'closed' state, then refresh side panel
      await expect
        .poll(
          async () => {
            const res = await fetch(`http://localhost:${server.port}/health`, {
              headers: { Authorization: `Bearer ${server.secret ?? ''}` },
            });
            const body = (await res.json()) as {
              pluginDetails?: Array<{ name: string; tabState: string }>;
            };
            return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
          },
          { timeout: 15_000, message: 'Server tab state for e2e-test did not return to closed' },
        )
        .toBe('closed');

      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });

      // Verify the PluginIcon shows closed state again (no status dot) and hint reappears
      await expect(sidePanelPage.locator('.bg-success').first()).toBeHidden({
        timeout: 15_000,
      });
      await expect(sidePanelPage.getByText('Open localhost')).toBeVisible({ timeout: 5_000 });

      await sidePanelPage.close();
    } finally {
      await context.close();
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('tab state dot shows unavailable (amber) when auth is toggled off', async () => {
    // 1. Start MCP server with e2e-test plugin, start test server
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-unavail-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect and content scripts to be registered
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      // 3. Open side panel
      const sidePanelPage = await openSidePanel(context);

      // 4. Verify plugin card is visible
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 5. Open a matching tab (auth is ON by default → ready state)
      const appTab = await context.newPage();
      await appTab.goto(testServer.url, { waitUntil: 'load' });

      // 6. Wait for server to report 'ready' state
      await expect
        .poll(
          async () => {
            const res = await fetch(`http://localhost:${server.port}/health`, {
              headers: { Authorization: `Bearer ${server.secret ?? ''}` },
            });
            const body = (await res.json()) as {
              pluginDetails?: Array<{ name: string; tabState: string }>;
            };
            return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
          },
          { timeout: 30_000, message: 'Server tab state for e2e-test did not become ready' },
        )
        .toBe('ready');

      // Reload side panel and verify PluginIcon shows ready state (green dot)
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });
      await expect(sidePanelPage.locator('.bg-success').first()).toBeVisible({
        timeout: 15_000,
      });

      // 7. Toggle auth OFF on the test server
      await testServer.setAuth(false);

      // 8. Reload the app tab to trigger a tab state recheck.
      // The page reload fires a status=complete event which causes the
      // background to call checkTabStateChanges → computePluginTabState →
      // isReady() → /api/auth.check → returns false → state = unavailable.
      await appTab.reload({ waitUntil: 'load' });

      // 9. Wait for server to report 'unavailable' state
      await expect
        .poll(
          async () => {
            const res = await fetch(`http://localhost:${server.port}/health`, {
              headers: { Authorization: `Bearer ${server.secret ?? ''}` },
            });
            const body = (await res.json()) as {
              pluginDetails?: Array<{ name: string; tabState: string }>;
            };
            return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
          },
          { timeout: 30_000, message: 'Server tab state for e2e-test did not become unavailable' },
        )
        .toBe('unavailable');

      // Reload side panel and verify PluginIcon shows unavailable state (amber dot)
      // with "Waiting…" hint text.
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.locator('.bg-primary.rounded-full').first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(sidePanelPage.getByText('Waiting\u2026')).toBeVisible({ timeout: 5_000 });

      // 10. Toggle auth back ON and verify transition back to ready
      await testServer.setAuth(true);

      // Reload the app tab to trigger another state recheck
      await appTab.reload({ waitUntil: 'load' });

      // 11. Wait for server to report 'ready' state again
      await expect
        .poll(
          async () => {
            const res = await fetch(`http://localhost:${server.port}/health`, {
              headers: { Authorization: `Bearer ${server.secret ?? ''}` },
            });
            const body = (await res.json()) as {
              pluginDetails?: Array<{ name: string; tabState: string }>;
            };
            return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
          },
          { timeout: 30_000, message: 'Server tab state for e2e-test did not return to ready' },
        )
        .toBe('ready');

      // Reload side panel and verify PluginIcon shows ready state (green dot) again
      // with no hint text visible.
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });
      await expect(sidePanelPage.locator('.bg-success').first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(sidePanelPage.getByText('Waiting\u2026')).toBeHidden({ timeout: 5_000 });

      await sidePanelPage.close();
      await appTab.close();
    } finally {
      await context.close();
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// US-006: Tool invocation animation tests
// ---------------------------------------------------------------------------

test.describe('Side panel data flow — tool invocation animation', () => {
  test('shows spinner during tool call and removes it after', async () => {
    // 1. Full setup: MCP server + test server + extension + MCP client
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-anim-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    const mcpClient = createMcpClient(server.port, server.secret);

    try {
      // 2. Wait for extension to connect
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      // 3. Open test app tab and wait for ready state
      const appTab = await context.newPage();
      await appTab.goto(testServer.url, { waitUntil: 'load' });

      await expect
        .poll(
          async () => {
            const res = await fetch(`http://localhost:${server.port}/health`, {
              headers: { Authorization: `Bearer ${server.secret ?? ''}` },
            });
            const body = (await res.json()) as {
              pluginDetails?: Array<{ name: string; tabState: string }>;
            };
            return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
          },
          { timeout: 30_000, message: 'Server tab state for e2e-test did not become ready' },
        )
        .toBe('ready');

      // 4. Initialize MCP client and verify tool is callable
      await mcpClient.initialize();

      // 5. Open side panel and expand plugin card
      const sidePanelPage = await openSidePanel(context);
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });

      // Click the plugin card to expand it and show tool rows
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').first();
      await pluginCard.click();

      // Verify tool rows are visible (displayName is primary text; description is in tooltip)
      await expect(sidePanelPage.getByText('Echo')).toBeVisible({ timeout: 5_000 });

      // 6. Set test server to slow mode (3s delay for tool responses)
      await testServer.setSlow(3_000);

      // 7. Start tool call and check for loader in parallel
      const loaderLocator = sidePanelPage.locator('[role="status"][aria-label="Loading..."]');
      const activeRowLocator = sidePanelPage.locator('.bg-accent\\/20');

      // Verify no loader before tool call
      await expect(loaderLocator).toBeHidden({ timeout: 2_000 });

      // Start the tool call (will take ~3s due to slow mode)
      const toolCallPromise = mcpClient.callTool('e2e-test_echo', { message: 'spinner test' });

      // 8. Verify the loader appears during tool execution
      await expect(loaderLocator).toBeVisible({ timeout: 10_000 });
      await expect(activeRowLocator).toBeVisible({ timeout: 2_000 });

      // 9. Wait for tool to complete
      const result = await toolCallPromise;
      expect(result.isError).toBe(false);

      // 10. Verify loader disappears after completion
      await expect(loaderLocator).toBeHidden({ timeout: 10_000 });
      await expect(activeRowLocator).toBeHidden({ timeout: 2_000 });

      // Reset slow mode
      await testServer.setSlow(0);

      await sidePanelPage.close();
      await appTab.close();
    } finally {
      await mcpClient.close();
      await context.close();
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
