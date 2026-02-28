/**
 * Side panel plugin list and tool toggle E2E tests.
 *
 * Verifies:
 *   1. Plugin cards display correct name and icon state
 *   2. Clicking a tool toggle sends config.setToolEnabled to the MCP server
 *   3. MCP server receives the tool config change and updates its state
 *   4. Side panel reflects the updated tool enabled/disabled state
 *
 * These tests open the side panel as a regular chrome-extension:// page
 * (Playwright cannot open the real Chrome side panel API) and exercise
 * the full background → MCP server communication path for tool toggles.
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
import {
  waitForExtensionConnected,
  waitForLog,
  openSidePanel,
  setupAdapterSymlink,
  waitForToolResult,
  openTestAppTab,
  BROWSER_TOOL_NAMES,
} from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Plugin list rendering — name and icon state
// ---------------------------------------------------------------------------

test.describe('Side panel — plugin list rendering', () => {
  test('plugin card displays correct name and icon state after connecting', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-render-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      // Open side panel
      const sidePanelPage = await openSidePanel(context);

      // Verify plugin card shows display name
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // With no matching tab open, the PluginIcon shows a closed state (no status dot)
      await expect(sidePanelPage.locator('.bg-success').first()).toBeHidden({
        timeout: 5_000,
      });

      // Open a matching tab → tab state transitions to 'ready'
      const appTab = await context.newPage();
      await appTab.goto(testServer.url, { waitUntil: 'load' });

      // Wait for server to report ready state for the plugin
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

      // Reload side panel to pick up latest state
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });

      // The PluginIcon now shows a ready state (green status dot visible)
      await expect(sidePanelPage.locator('.bg-success').first()).toBeVisible({
        timeout: 15_000,
      });

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
// Tool toggle — config.setToolEnabled flow
// ---------------------------------------------------------------------------

test.describe('Side panel — tool toggle', () => {
  test('toggling a tool sends config.setToolEnabled and MCP server updates state', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-toggle-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      // Open side panel
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Expand the plugin card to reveal tool rows
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').first();
      await pluginCard.click();

      // Verify tool rows are visible (displayName is primary text; description is in tooltip)
      await expect(sidePanelPage.getByText('Echo')).toBeVisible({ timeout: 5_000 });

      // Find the toggle for the 'echo' tool.
      // Each ToolRow has an aria-label "Toggle <name> tool" on its switch button.
      const echoToggle = sidePanelPage.locator('button[role="switch"][aria-label="Toggle echo tool"]');
      await expect(echoToggle).toBeVisible({ timeout: 5_000 });

      // Verify initial state: all tools are enabled (aria-checked="true")
      await expect(echoToggle).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });

      // Click the toggle to disable the echo tool
      await echoToggle.click();

      // Verify the toggle UI immediately reflects disabled state
      await expect(echoToggle).toHaveAttribute('aria-checked', 'false', { timeout: 5_000 });

      // Verify the MCP server received the tool config change by polling
      // tools/list — once the server processes the toggle, the tool is removed.
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            return toolList.some(t => t.name === 'e2e-test_echo');
          },
          { timeout: 15_000, message: 'MCP server did not persist echo tool as disabled' },
        )
        .toBe(false);

      // Re-enable the echo tool by clicking the toggle again
      await echoToggle.click();

      // Verify the toggle UI reflects enabled state
      await expect(echoToggle).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });

      // Verify the MCP server persisted the re-enabled state by polling tools/list.
      // Use a longer timeout (30s) because under parallel test load the WebSocket round-trip can be slow.
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            return toolList.some(t => t.name === 'e2e-test_echo');
          },
          { timeout: 30_000, message: 'MCP server did not persist echo tool as re-enabled' },
        )
        .toBe(true);

      await sidePanelPage.close();
    } finally {
      await mcpClient.close();
      await context.close();
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Disabled tool dispatch rejection
// ---------------------------------------------------------------------------

test.describe('Side panel — disabled tool dispatch rejection', () => {
  test('calling a disabled tool via MCP client returns isError with "disabled"', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-dispatch-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      // Open a matching tab so the plugin reaches 'ready' state
      const appTab = await openTestAppTab(context, testServer.url, server, testServer);

      // Wait until the echo tool is callable (tab state = ready)
      await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'hello' }, { isError: false }, 15_000);

      // Verify tool call succeeds initially
      const successResult = await mcpClient.callTool('e2e-test_echo', { message: 'hello' });
      expect(successResult.isError).toBe(false);

      // Open side panel and disable the echo tool
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Expand the plugin card
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').first();
      await pluginCard.click();

      // Find and click the echo tool toggle to disable it
      const echoToggle = sidePanelPage.locator('button[role="switch"][aria-label="Toggle echo tool"]');
      await expect(echoToggle).toBeVisible({ timeout: 5_000 });
      await expect(echoToggle).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
      await echoToggle.click();
      await expect(echoToggle).toHaveAttribute('aria-checked', 'false', { timeout: 5_000 });

      // Wait for tools/list to no longer include e2e-test_echo
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            return toolList.some(t => t.name === 'e2e-test_echo');
          },
          { timeout: 15_000, message: 'e2e-test_echo should not appear in tools/list after being disabled' },
        )
        .toBe(false);

      // Call the disabled tool — should return isError: true with "disabled"
      const disabledResult = await mcpClient.callTool('e2e-test_echo', { message: 'hello' });
      expect(disabledResult.isError).toBe(true);
      expect(disabledResult.content).toContain('disabled');

      // Re-enable the echo tool
      await echoToggle.click();
      await expect(echoToggle).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });

      // Wait for tool to reappear in tools/list. Use 30s timeout for parallel load headroom.
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            return toolList.some(t => t.name === 'e2e-test_echo');
          },
          { timeout: 30_000, message: 'e2e-test_echo should reappear in tools/list after being re-enabled' },
        )
        .toBe(true);

      // Verify tool call succeeds again after re-enabling
      const reenabledResult = await waitForToolResult(
        mcpClient,
        'e2e-test_echo',
        { message: 'world' },
        { isError: false },
        15_000,
      );
      expect(reenabledResult.isError).toBe(false);

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

// ---------------------------------------------------------------------------
// Toggle all tools
// ---------------------------------------------------------------------------

test.describe('Side panel — toggle all tools', () => {
  test('master toggle disables and re-enables all plugin tools', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-toggle-all-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      // Verify all e2e-test plugin tools initially appear in tools/list
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const toolNames = toolList.map(t => t.name);
            return prefixedToolNames.every(name => toolNames.includes(name));
          },
          { timeout: 15_000, message: 'All e2e-test plugin tools should initially appear in tools/list' },
        )
        .toBe(true);

      // Verify browser tools are present initially
      const initialToolList = await mcpClient.listTools();
      const initialToolNames = initialToolList.map(t => t.name);
      const someBrowserTools = BROWSER_TOOL_NAMES.slice(0, 3);
      for (const bt of someBrowserTools) {
        expect(initialToolNames).toContain(bt);
      }

      // Open side panel
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Find the master toggle for e2e-test plugin
      const masterToggle = sidePanelPage.locator('button[role="switch"][aria-label="Toggle all tools for e2e-test"]');
      await expect(masterToggle).toBeVisible({ timeout: 5_000 });

      // Click the master toggle to disable all tools
      await masterToggle.click();

      // Wait for all e2e-test plugin tools to disappear from tools/list
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const toolNames = toolList.map(t => t.name);
            return prefixedToolNames.some(name => toolNames.includes(name));
          },
          { timeout: 15_000, message: 'All e2e-test plugin tools should disappear from tools/list' },
        )
        .toBe(false);

      // Verify all e2e-test tools are absent from tools/list (confirming the server
      // processed the config change — equivalent to verifying config persistence).
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const toolNames = toolList.map(t => t.name);
            return prefixedToolNames.every(name => !toolNames.includes(name));
          },
          { timeout: 15_000, message: 'All e2e-test tools should be set to false in config.json' },
        )
        .toBe(true);

      // Verify browser tools are NOT affected by the toggle
      const toolListAfterDisable = await mcpClient.listTools();
      const toolNamesAfterDisable = toolListAfterDisable.map(t => t.name);
      for (const bt of someBrowserTools) {
        expect(toolNamesAfterDisable).toContain(bt);
      }

      // Click the master toggle again to re-enable all tools
      await masterToggle.click();

      // Wait for all e2e-test plugin tools to reappear in tools/list. Use a longer timeout
      // (30s) because under parallel test load the WebSocket round-trip can be slow.
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const toolNames = toolList.map(t => t.name);
            return prefixedToolNames.every(name => toolNames.includes(name));
          },
          { timeout: 30_000, message: 'All e2e-test plugin tools should reappear in tools/list' },
        )
        .toBe(true);

      // Verify browser tools still present after re-enable
      const toolListAfterReenable = await mcpClient.listTools();
      const toolNamesAfterReenable = toolListAfterReenable.map(t => t.name);
      for (const bt of someBrowserTools) {
        expect(toolNamesAfterReenable).toContain(bt);
      }

      await sidePanelPage.close();
    } finally {
      await mcpClient.close();
      await context.close();
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
