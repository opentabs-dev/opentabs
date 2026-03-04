/**
 * Side panel plugin list and tool permission E2E tests.
 *
 * Verifies:
 *   1. Plugin cards display correct name and icon state
 *   2. Changing a tool permission select sends config.setToolPermission to the MCP server
 *   3. MCP server receives the permission change and updates its state
 *   4. Side panel reflects the updated tool permission state
 *   5. Plugin-level permission select sets all tools' default permission
 *
 * These tests open the side panel as a regular chrome-extension:// page
 * (Playwright cannot open the real Chrome side panel API) and exercise
 * the full background → MCP server communication path for permission changes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupTestConfigDir,
  createMcpClient,
  E2E_TEST_PLUGIN_DIR,
  expect,
  launchExtensionContext,
  readPluginToolNames,
  startMcpServer,
  startTestServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import {
  BROWSER_TOOL_NAMES,
  openSidePanel,
  openTestAppTab,
  setupAdapterSymlink,
  waitForExtensionConnected,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Plugin list rendering — name and icon state
// ---------------------------------------------------------------------------

test.describe('Side panel — plugin list rendering', () => {
  test('plugin card displays correct name and icon state after connecting', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-render-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], plugins: {} });

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
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({
        timeout: 30_000,
      });

      const e2ePluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });

      // With no matching tab open, the PluginIcon shows a closed state (faded ghost border)
      await expect(e2ePluginCard.locator('[class*="border-border/30"]')).toBeVisible({
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
          {
            timeout: 30_000,
            message: 'Server tab state for e2e-test did not become ready',
          },
        )
        .toBe('ready');

      // Reload side panel to pick up latest state
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({
        timeout: 15_000,
      });

      // The PluginIcon now shows a ready state (solid border, no faded indicator)
      await expect(e2ePluginCard.locator('[class*="border-border/30"]')).toBeHidden({
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
// Tool permission — config.setToolPermission flow
// ---------------------------------------------------------------------------

test.describe('Side panel — tool permission change', () => {
  test('changing a tool permission select sends config.setToolPermission and MCP server updates state', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-toggle-'));
    // Start with e2e-test plugin at 'auto' so all tools default to auto
    writeTestConfig(configDir, { localPlugins: [absPluginPath], plugins: { 'e2e-test': { permission: 'auto' } } });

    // Disable skipPermissions so permission selects are interactive
    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_SKIP_PERMISSIONS: '' });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      // Open side panel
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({
        timeout: 30_000,
      });

      // Expand the plugin card to reveal tool rows
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();

      // Verify tool rows are visible
      await expect(sidePanelPage.getByText('Echo', { exact: true })).toBeVisible({ timeout: 5_000 });

      // Find the permission select for the 'echo' tool
      const echoSelect = sidePanelPage.locator('select[aria-label="Permission for echo tool"]');
      await expect(echoSelect).toBeVisible({ timeout: 5_000 });

      // Verify initial state: auto (plugin permission is 'auto')
      await expect(echoSelect).toHaveValue('auto', { timeout: 5_000 });

      // Change the echo tool permission to 'off'
      await echoSelect.selectOption('off');

      // Verify the select UI immediately reflects the new value
      await expect(echoSelect).toHaveValue('off', { timeout: 5_000 });

      // Verify the MCP server received the permission change by polling
      // tools/list — once the server processes the change, the tool gets
      // a [Disabled] prefix in its description.
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const echo = toolList.find(t => t.name === 'e2e-test_echo');
            return echo?.description?.startsWith('[Disabled]') ?? false;
          },
          {
            timeout: 15_000,
            message: 'MCP server did not reflect echo tool as disabled',
          },
        )
        .toBe(true);

      // Re-enable the echo tool by setting permission to 'auto'
      await echoSelect.selectOption('auto');

      // Verify the select UI reflects the change
      await expect(echoSelect).toHaveValue('auto', { timeout: 5_000 });

      // Verify the MCP server persisted the re-enabled state.
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const echo = toolList.find(t => t.name === 'e2e-test_echo');
            return echo !== undefined && !echo.description.startsWith('[Disabled]');
          },
          {
            timeout: 30_000,
            message: 'MCP server did not reflect echo tool as re-enabled',
          },
        )
        .toBe(true);

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

// ---------------------------------------------------------------------------
// Disabled tool dispatch rejection
// ---------------------------------------------------------------------------

test.describe('Side panel — disabled tool dispatch rejection', () => {
  test('calling a disabled tool via MCP client returns isError with "disabled"', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-dispatch-'));
    // Start with e2e-test plugin at 'auto' so tools are callable initially
    writeTestConfig(configDir, { localPlugins: [absPluginPath], plugins: { 'e2e-test': { permission: 'auto' } } });

    // Disable skipPermissions so permission selects are interactive
    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_SKIP_PERMISSIONS: '' });
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

      // Open side panel and change echo tool permission to 'off'
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({
        timeout: 30_000,
      });

      // Expand the plugin card
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();

      // Find the echo tool permission select and set to 'off'
      const echoSelect = sidePanelPage.locator('select[aria-label="Permission for echo tool"]');
      await expect(echoSelect).toBeVisible({ timeout: 5_000 });
      await expect(echoSelect).toHaveValue('auto', { timeout: 5_000 });
      await echoSelect.selectOption('off');
      await expect(echoSelect).toHaveValue('off', { timeout: 5_000 });

      // Wait for tools/list to reflect echo as disabled
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const echo = toolList.find(t => t.name === 'e2e-test_echo');
            return echo?.description?.startsWith('[Disabled]') ?? false;
          },
          {
            timeout: 15_000,
            message: 'e2e-test_echo should have [Disabled] prefix after being set to off',
          },
        )
        .toBe(true);

      // Call the disabled tool — should return isError: true with "disabled"
      const disabledResult = await mcpClient.callTool('e2e-test_echo', { message: 'hello' });
      expect(disabledResult.isError).toBe(true);
      expect(disabledResult.content).toContain('disabled');

      // Re-enable the echo tool
      await echoSelect.selectOption('auto');
      await expect(echoSelect).toHaveValue('auto', { timeout: 5_000 });

      // Wait for tool to no longer have [Disabled] prefix
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const echo = toolList.find(t => t.name === 'e2e-test_echo');
            return echo !== undefined && !echo.description.startsWith('[Disabled]');
          },
          {
            timeout: 30_000,
            message: 'e2e-test_echo should not have [Disabled] prefix after re-enabling',
          },
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
      await mcpClient.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      await testServer.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Plugin-level permission select
// ---------------------------------------------------------------------------

test.describe('Side panel — plugin-level permission select', () => {
  test('plugin permission select changes the default for all tools', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-toggle-all-'));
    // Start with e2e-test plugin at 'auto' so tools default to auto
    writeTestConfig(configDir, { localPlugins: [absPluginPath], plugins: { 'e2e-test': { permission: 'auto' } } });

    // Disable skipPermissions so permission selects are interactive
    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_SKIP_PERMISSIONS: '' });
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
          {
            timeout: 15_000,
            message: 'All e2e-test plugin tools should initially appear in tools/list',
          },
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
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({
        timeout: 30_000,
      });

      // Find the plugin-level permission select
      const pluginSelect = sidePanelPage.locator('select[aria-label="Permission for e2e-test plugin"]');
      await expect(pluginSelect).toBeVisible({ timeout: 5_000 });

      // Set plugin permission to 'off'
      await pluginSelect.selectOption('off');

      // Wait for all e2e-test plugin tools to get [Disabled] prefix
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            return prefixedToolNames.every(name => {
              const tool = toolList.find(t => t.name === name);
              return tool?.description?.startsWith('[Disabled]') ?? false;
            });
          },
          {
            timeout: 15_000,
            message: 'All e2e-test plugin tools should have [Disabled] prefix',
          },
        )
        .toBe(true);

      // Verify browser tools are NOT affected
      const toolListAfterDisable = await mcpClient.listTools();
      for (const bt of someBrowserTools) {
        expect(toolListAfterDisable.map(t => t.name)).toContain(bt);
      }

      // Set plugin permission back to 'auto'
      await pluginSelect.selectOption('auto');

      // Wait for all e2e-test plugin tools to lose the [Disabled] prefix
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            return prefixedToolNames.every(name => {
              const tool = toolList.find(t => t.name === name);
              return tool !== undefined && !tool.description.startsWith('[Disabled]');
            });
          },
          {
            timeout: 30_000,
            message: 'All e2e-test plugin tools should not have [Disabled] prefix',
          },
        )
        .toBe(true);

      // Verify browser tools still present after re-enable
      const toolListAfterReenable = await mcpClient.listTools();
      for (const bt of someBrowserTools) {
        expect(toolListAfterReenable.map(t => t.name)).toContain(bt);
      }

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
