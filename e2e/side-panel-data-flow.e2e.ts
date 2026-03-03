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
      await context.close().catch(() => {});
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

      const e2ePluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });

      // 5. Verify the PluginIcon shows closed state (no status dot)
      await expect(e2ePluginCard.locator('.bg-success')).toBeHidden({ timeout: 5_000 });

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
            try {
              const res = await fetch(`http://localhost:${server.port}/health`, {
                headers: { Authorization: `Bearer ${server.secret ?? ''}` },
                signal: AbortSignal.timeout(3_000),
              });
              const body = (await res.json()) as {
                pluginDetails?: Array<{ name: string; tabState: string }>;
              };
              return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
            } catch {
              return undefined;
            }
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

      // Verify the PluginIcon shows ready state (green status dot)
      await expect(e2ePluginCard.locator('.bg-success')).toBeVisible({
        timeout: 15_000,
      });

      // 8. Close the matching tab
      await appTab.close();

      // 9. Wait for server to report 'closed' state, then refresh side panel
      await expect
        .poll(
          async () => {
            try {
              const res = await fetch(`http://localhost:${server.port}/health`, {
                headers: { Authorization: `Bearer ${server.secret ?? ''}` },
                signal: AbortSignal.timeout(3_000),
              });
              const body = (await res.json()) as {
                pluginDetails?: Array<{ name: string; tabState: string }>;
              };
              return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
            } catch {
              return undefined;
            }
          },
          { timeout: 15_000, message: 'Server tab state for e2e-test did not return to closed' },
        )
        .toBe('closed');

      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });

      // Verify the PluginIcon shows closed state again (no status dot)
      await expect(e2ePluginCard.locator('.bg-success')).toBeHidden({
        timeout: 15_000,
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
            try {
              const res = await fetch(`http://localhost:${server.port}/health`, {
                headers: { Authorization: `Bearer ${server.secret ?? ''}` },
                signal: AbortSignal.timeout(3_000),
              });
              const body = (await res.json()) as {
                pluginDetails?: Array<{ name: string; tabState: string }>;
              };
              return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
            } catch {
              return undefined;
            }
          },
          { timeout: 30_000, message: 'Server tab state for e2e-test did not become ready' },
        )
        .toBe('ready');

      // Reload side panel and verify PluginIcon shows ready state (green dot)
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });
      const e2ePluginCard2 = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await expect(e2ePluginCard2.locator('.bg-success')).toBeVisible({
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
            try {
              const res = await fetch(`http://localhost:${server.port}/health`, {
                headers: { Authorization: `Bearer ${server.secret ?? ''}` },
                signal: AbortSignal.timeout(3_000),
              });
              const body = (await res.json()) as {
                pluginDetails?: Array<{ name: string; tabState: string }>;
              };
              return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
            } catch {
              return undefined;
            }
          },
          { timeout: 30_000, message: 'Server tab state for e2e-test did not become unavailable' },
        )
        .toBe('unavailable');

      // Reload side panel and verify PluginIcon shows unavailable state (amber dot)
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.locator('.bg-primary.rounded-full').first()).toBeVisible({
        timeout: 15_000,
      });

      // 10. Toggle auth back ON and verify transition back to ready
      await testServer.setAuth(true);

      // Reload the app tab to trigger another state recheck
      await appTab.reload({ waitUntil: 'load' });

      // 11. Wait for server to report 'ready' state again
      await expect
        .poll(
          async () => {
            try {
              const res = await fetch(`http://localhost:${server.port}/health`, {
                headers: { Authorization: `Bearer ${server.secret ?? ''}` },
                signal: AbortSignal.timeout(3_000),
              });
              const body = (await res.json()) as {
                pluginDetails?: Array<{ name: string; tabState: string }>;
              };
              return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
            } catch {
              return undefined;
            }
          },
          { timeout: 30_000, message: 'Server tab state for e2e-test did not return to ready' },
        )
        .toBe('ready');

      // Reload side panel and verify PluginIcon shows ready state (green dot) again
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });
      await expect(e2ePluginCard2.locator('.bg-success')).toBeVisible({
        timeout: 15_000,
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
});

// ---------------------------------------------------------------------------
// US-006: Tool invocation animation tests
// ---------------------------------------------------------------------------

test.describe('Side panel data flow — tool invocation animation', () => {
  test('shows activity indicator during tool call and removes it after', async () => {
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
            try {
              const res = await fetch(`http://localhost:${server.port}/health`, {
                headers: { Authorization: `Bearer ${server.secret ?? ''}` },
                signal: AbortSignal.timeout(3_000),
              });
              const body = (await res.json()) as {
                pluginDetails?: Array<{ name: string; tabState: string }>;
              };
              return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
            } catch {
              return undefined;
            }
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
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();

      // Verify tool rows are visible (displayName is primary text; description is in tooltip)
      await expect(sidePanelPage.getByText('Echo')).toBeVisible({ timeout: 5_000 });

      // 6. Set test server to slow mode (3s delay for tool responses)
      await testServer.setSlow(3_000);

      // 7. Verify activity indicator appears during tool execution.
      // The activity flash dot appears on both the PluginIcon and the ToolIcon,
      // so scope the locator to the Echo tool row to avoid strict mode violations.
      // ToolRow renders as: <div class="border-border flex ..."> containing <ToolIcon> + <Tooltip> + <Switch>.
      // Find the row that contains 'Echo' text, then look for the activity dot within it.
      const echoRow = sidePanelPage.locator('div.border-b').filter({ hasText: 'Echo' });
      const activityDotLocator = echoRow.locator('.animate-activity-flash');

      // Verify no activity dot before tool call
      await expect(activityDotLocator).toBeHidden({ timeout: 2_000 });

      // Run tool call and UI assertion concurrently. The tool call takes ~3s
      // due to slow mode, giving enough time to observe the activity dot.
      const [result] = await Promise.all([
        mcpClient.callTool('e2e-test_echo', { message: 'spinner test' }),
        expect(activityDotLocator).toBeVisible({ timeout: 10_000 }),
      ]);
      expect(result.isError).toBe(false);

      // 8. Verify activity dot disappears after completion
      await expect(activityDotLocator).toBeHidden({ timeout: 10_000 });

      // Reset slow mode
      await testServer.setSlow(0);

      await sidePanelPage.close();
      await appTab.close();
    } finally {
      await mcpClient.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('shows activity indicator on browser tool invocation', async () => {
    // 1. Setup: MCP server + extension + MCP client (no test server needed
    // for browser tools — they execute server-side, not via adapters)
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-bt-anim-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    const mcpClient = createMcpClient(server.port, server.secret);

    try {
      // 2. Wait for extension to connect
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      // 3. Initialize MCP client
      await mcpClient.initialize();

      // 4. Open side panel and verify Browser card is visible
      const sidePanelPage = await openSidePanel(context);
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('Browser')).toBeVisible({ timeout: 15_000 });

      // Expand the Browser accordion to show tool rows
      const browserCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await browserCard.click();

      // Verify a browser tool row is visible (e.g., "List Tabs")
      await expect(sidePanelPage.getByText('List Tabs', { exact: true })).toBeVisible({ timeout: 5_000 });

      // 5. Install a MutationObserver to detect the activity flash class.
      // Browser tools execute in milliseconds, so the activity indicator may
      // appear and disappear too quickly for Playwright's polling assertions.
      // A MutationObserver captures every class mutation, reliably detecting
      // even sub-frame flashes.
      await sidePanelPage.evaluate(() => {
        (window as unknown as Record<string, unknown>).__activityFlashSeen = false;
        const observer = new MutationObserver(mutations => {
          for (const m of mutations) {
            if (m.type === 'childList' || (m.type === 'attributes' && m.attributeName === 'class')) {
              const target = m.target as HTMLElement;
              if (target.classList.contains('animate-activity-flash')) {
                (window as unknown as Record<string, unknown>).__activityFlashSeen = true;
              }
              // Check added nodes (the dot is conditionally rendered)
              for (const node of m.addedNodes) {
                if (node instanceof HTMLElement && node.classList.contains('animate-activity-flash')) {
                  (window as unknown as Record<string, unknown>).__activityFlashSeen = true;
                }
              }
            }
          }
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class'],
        });
        (window as unknown as Record<string, unknown>).__activityObserver = observer;
      });

      // 6. Call a browser tool
      const result = await mcpClient.callTool('browser_list_tabs');
      expect(result.isError).toBe(false);

      // 7. Verify the MutationObserver detected the activity flash class.
      // Poll briefly in case the end notification arrives slightly after
      // the MCP response (the WebSocket notification and HTTP response
      // travel independent paths).
      await expect
        .poll(() => sidePanelPage.evaluate(() => (window as unknown as Record<string, boolean>).__activityFlashSeen), {
          timeout: 5_000,
          message: 'Activity flash class was never observed on any element',
        })
        .toBe(true);

      // 8. Verify activity indicator disappears after the tool call.
      // The animate-activity-flash element should no longer be in the DOM
      // (or should have transitioned to animate-activity-fade-out).
      await expect(sidePanelPage.locator('.animate-activity-flash')).toBeHidden({ timeout: 10_000 });

      // Clean up the observer
      await sidePanelPage.evaluate(() => {
        const obs = (window as unknown as Record<string, MutationObserver>).__activityObserver;
        obs?.disconnect();
      });

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
