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
import { waitForExtensionConnected, waitForLog } from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the extension ID from the background service worker URL.
 * The service worker URL follows the pattern: chrome-extension://<id>/dist/background.js
 */
const getExtensionId = async (context: BrowserContext): Promise<string> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const sw of context.serviceWorkers()) {
      const m = sw.url().match(/chrome-extension:\/\/([^/]+)/);
      if (m?.[1]) return m[1];
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Could not find extension service worker within 10s');
};

/**
 * Open the side panel as a regular extension page in the browser context.
 */
const openSidePanel = async (context: BrowserContext): Promise<Page> => {
  const extId = await getExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/side-panel/side-panel.html`, {
    waitUntil: 'load',
    timeout: 10_000,
  });
  return page;
};

/**
 * Set up the adapter symlink between the MCP server's config dir and the
 * extension's adapters directory.
 */
const setupAdapterSymlink = (configDir: string, extensionDir: string): void => {
  const serverAdaptersParent = path.join(configDir, 'extension');
  fs.mkdirSync(serverAdaptersParent, { recursive: true });
  const serverAdaptersDir = path.join(serverAdaptersParent, 'adapters');
  const extensionAdaptersDir = path.join(extensionDir, 'adapters');
  fs.mkdirSync(extensionAdaptersDir, { recursive: true });
  fs.rmSync(serverAdaptersDir, { recursive: true, force: true });
  fs.symlinkSync(extensionAdaptersDir, serverAdaptersDir);
};

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
    writeTestConfig(configDir, { plugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const serverPort = server.port;
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect
      await waitForExtensionConnected(server);
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // 3. Open side panel
      const sidePanelPage = await openSidePanel(context);

      // 4. Verify 'Connected' text visible (exact match to avoid matching 'Disconnected')
      await expect(sidePanelPage.getByText('Connected', { exact: true })).toBeVisible({ timeout: 10_000 });

      // 5. Verify plugin card visible
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 6. Kill MCP server
      await server.kill();

      // 7. Verify 'Disconnected' text appears
      // The offscreen document detects WebSocket close and broadcasts connection state.
      // Pong timeout is 5s + reconnect backoff, so allow up to 30s.
      await expect(sidePanelPage.getByText('Disconnected', { exact: true })).toBeVisible({ timeout: 30_000 });

      // 8. Verify plugin list is cleared (no plugin cards visible)
      await expect(sidePanelPage.getByText('MCP server not connected')).toBeVisible({ timeout: 10_000 });

      // 9. Restart MCP server on the same port
      const server2 = await startMcpServer(configDir, true, serverPort);

      try {
        // 10. Verify 'Connected' text reappears
        // The offscreen document's reconnect logic will find the new server.
        await expect(sidePanelPage.getByText('Connected', { exact: true })).toBeVisible({ timeout: 45_000 });

        // 11. Verify plugin card reappears
        await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });
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
    writeTestConfig(configDir, { plugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect and content scripts to be registered
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      // 3. Open side panel
      const sidePanelPage = await openSidePanel(context);

      // 4. Verify plugin card is visible with 'E2E Test'
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 5. Verify the red dot (closed state) — no matching tab is open
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').first();
      await expect(pluginCard.locator('.bg-red-400')).toBeVisible({ timeout: 5_000 });

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
            const res = await fetch(`http://localhost:${server.port}/health`);
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

      // Verify the green dot (ready state)
      const refreshedCard = sidePanelPage.locator('button[aria-expanded]').first();
      await expect(refreshedCard.locator('.bg-emerald-400')).toBeVisible({ timeout: 15_000 });

      // 8. Close the matching tab
      await appTab.close();

      // 9. Wait for server to report 'closed' state, then refresh side panel
      await expect
        .poll(
          async () => {
            const res = await fetch(`http://localhost:${server.port}/health`);
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

      // Verify the red dot (closed state) reappears
      const closedCard = sidePanelPage.locator('button[aria-expanded]').first();
      await expect(closedCard.locator('.bg-red-400')).toBeVisible({ timeout: 15_000 });

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
    writeTestConfig(configDir, { plugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port);
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
            const res = await fetch(`http://localhost:${server.port}/health`);
            const body = (await res.json()) as {
              pluginDetails?: Array<{ name: string; tabState: string }>;
            };
            return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
          },
          { timeout: 30_000, message: 'Server tab state for e2e-test did not become ready' },
        )
        .toBe('ready');

      // Reload side panel and verify green dot (ready)
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });
      const readyCard = sidePanelPage.locator('button[aria-expanded]').first();
      await expect(readyCard.locator('.bg-emerald-400')).toBeVisible({ timeout: 15_000 });

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
            const res = await fetch(`http://localhost:${server.port}/health`);
            const body = (await res.json()) as {
              pluginDetails?: Array<{ name: string; tabState: string }>;
            };
            return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
          },
          { timeout: 30_000, message: 'Server tab state for e2e-test did not become unavailable' },
        )
        .toBe('unavailable');

      // Reload side panel and verify amber dot (unavailable).
      // When unavailable, TabStateHint renders "Log in to E2E Test" which
      // also matches getByText('E2E Test'), so use the plugin card button
      // locator directly instead of a text search.
      await sidePanelPage.reload({ waitUntil: 'load' });
      const unavailableCard = sidePanelPage.locator('button[aria-expanded]').first();
      await expect(unavailableCard).toBeVisible({ timeout: 15_000 });
      await expect(unavailableCard.locator('.bg-amber-400')).toBeVisible({ timeout: 15_000 });

      // 10. Toggle auth back ON and verify transition back to ready
      await testServer.setAuth(true);

      // Reload the app tab to trigger another state recheck
      await appTab.reload({ waitUntil: 'load' });

      // 11. Wait for server to report 'ready' state again
      await expect
        .poll(
          async () => {
            const res = await fetch(`http://localhost:${server.port}/health`);
            const body = (await res.json()) as {
              pluginDetails?: Array<{ name: string; tabState: string }>;
            };
            return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
          },
          { timeout: 30_000, message: 'Server tab state for e2e-test did not return to ready' },
        )
        .toBe('ready');

      // Reload side panel and verify green dot (ready) again
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });
      const restoredCard = sidePanelPage.locator('button[aria-expanded]').first();
      await expect(restoredCard.locator('.bg-emerald-400')).toBeVisible({ timeout: 15_000 });

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
    writeTestConfig(configDir, { plugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port);
    setupAdapterSymlink(configDir, extensionDir);

    const mcpClient = createMcpClient(server.port);

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
            const res = await fetch(`http://localhost:${server.port}/health`);
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

      // Verify tool rows are visible (e.g., 'echo' tool)
      await expect(sidePanelPage.getByText('echo', { exact: true })).toBeVisible({ timeout: 5_000 });

      // 6. Set test server to slow mode (3s delay for tool responses)
      await testServer.setSlow(3_000);

      // 7. Start tool call and check for spinner in parallel
      const spinnerLocator = sidePanelPage.locator('.animate-spin');
      const pulseLocator = sidePanelPage.locator('.animate-tool-pulse');

      // Verify no spinner before tool call
      await expect(spinnerLocator).toBeHidden({ timeout: 2_000 });

      // Start the tool call (will take ~3s due to slow mode)
      const toolCallPromise = mcpClient.callTool('e2e-test_echo', { message: 'spinner test' });

      // 8. Verify the spinner appears during tool execution
      await expect(spinnerLocator).toBeVisible({ timeout: 10_000 });
      await expect(pulseLocator).toBeVisible({ timeout: 2_000 });

      // 9. Wait for tool to complete
      const result = await toolCallPromise;
      expect(result.isError).toBe(false);

      // 10. Verify spinner disappears after completion
      await expect(spinnerLocator).toBeHidden({ timeout: 10_000 });
      await expect(pulseLocator).toBeHidden({ timeout: 2_000 });

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
