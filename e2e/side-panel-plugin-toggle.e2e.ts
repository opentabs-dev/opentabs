/**
 * Side panel plugin list and tool permission E2E tests.
 *
 * Verifies:
 *   1. Plugin cards display correct name and icon state
 *   2. Changing a tool permission via Radix Select sends config.setToolPermission to the MCP server
 *   3. MCP server receives the permission change and updates its state
 *   4. Side panel reflects the updated tool permission state
 *   5. Plugin-level permission select sets all tools' default permission
 *   6. Smart cleanup: setting tool permission back to plugin default removes the per-tool override
 *   7. No Switch components exist in the side panel (group headers are plain text dividers)
 *   8. skipPermissions mode disables all Select components
 *
 * PermissionSelect is a Radix Select component. Playwright interactions:
 *   - Locate trigger: page.locator('[aria-label="..."]')
 *   - Open dropdown: trigger.click()
 *   - Select option: page.locator('[role="option"]', { hasText: 'Auto' }).click()
 *   - Verify value: expect(trigger).toContainText('Auto')
 *   - Verify disabled: expect(trigger).toBeDisabled()
 *
 * These tests open the side panel as a regular chrome-extension:// page
 * (Playwright cannot open the real Chrome side panel API) and exercise
 * the full background → MCP server communication path for permission changes.
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
  readPluginToolNames,
  readTestConfig,
  startMcpServer,
  startTestServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import {
  BROWSER_TOOL_NAMES,
  openSidePanel,
  openTestAppTab,
  selectPermission,
  setupAdapterSymlink,
  waitForExtensionConnected,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

/** Read the e2e-test plugin version from its package.json. */
const getPluginVersion = (): string => {
  const pkg = JSON.parse(fs.readFileSync(path.join(E2E_TEST_PLUGIN_DIR, 'package.json'), 'utf-8')) as {
    version: string;
  };
  return pkg.version;
};

// ---------------------------------------------------------------------------
// Plugin list rendering — name and icon state
// ---------------------------------------------------------------------------

test.describe('Side panel — plugin list rendering', () => {
  test('plugin card displays correct name and icon state after connecting', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-render-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], permissions: {} });

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
      await expect(e2ePluginCard.locator('xpath=..').locator('[class*="border-border/30"]')).toBeVisible({
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
      await expect(e2ePluginCard.locator('xpath=..').locator('[class*="border-border/30"]')).toBeHidden({
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
// Tool permission — config.setToolPermission flow + smart cleanup
// ---------------------------------------------------------------------------

test.describe('Side panel — tool permission change', () => {
  test('changing a tool permission via Select sends config.setToolPermission, MCP server updates, and smart cleanup removes override', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-toggle-'));
    // Start with e2e-test plugin at 'auto' and mark as reviewed so the unreviewed dialog doesn't interfere
    const pluginVersion = getPluginVersion();
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: { 'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion } },
    });

    // Disable skipPermissions so permission selects are interactive
    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
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

      // Verify the tool-level Radix Select trigger is visible
      const echoTrigger = sidePanelPage.locator('[aria-label="Permission for echo tool"]');
      await expect(echoTrigger).toBeVisible({ timeout: 5_000 });

      // Verify initial state: Auto (plugin permission is 'auto')
      await expect(echoTrigger).toContainText('Auto', { timeout: 5_000 });

      // Change the echo tool permission to 'off' via Radix Select
      await selectPermission(sidePanelPage, 'Permission for echo tool', 'Off');

      // Verify the select UI immediately reflects the new value
      await expect(echoTrigger).toContainText('Off', { timeout: 5_000 });

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

      // Verify the per-tool override exists in config.json
      await expect
        .poll(
          () => {
            const config = readTestConfig(configDir);
            return config.permissions?.['e2e-test']?.tools?.echo;
          },
          {
            timeout: 15_000,
            message: 'Config should have per-tool override for echo after setting to off',
          },
        )
        .toBe('off');

      // Re-enable the echo tool by setting permission back to 'auto' (the plugin default)
      await selectPermission(sidePanelPage, 'Permission for echo tool', 'Auto');

      // Verify the select UI reflects the change
      await expect(echoTrigger).toContainText('Auto', { timeout: 5_000 });

      // Verify the MCP server persisted the re-enabled state
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

      // Smart cleanup: verify the per-tool override was REMOVED from config
      // because the tool permission now matches the plugin default ('auto').
      await expect
        .poll(
          () => {
            const config = readTestConfig(configDir);
            return config.permissions?.['e2e-test']?.tools;
          },
          {
            timeout: 15_000,
            message: 'Config tools map should be removed after setting echo back to plugin default',
          },
        )
        .toBeUndefined();

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
    // Start with e2e-test plugin at 'auto' and mark as reviewed so the unreviewed dialog doesn't interfere
    const pluginVersion = getPluginVersion();
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: { 'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion } },
    });

    // Disable skipPermissions so permission selects are interactive
    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
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

      // Find the echo tool permission select trigger and verify initial value
      const echoTrigger = sidePanelPage.locator('[aria-label="Permission for echo tool"]');
      await expect(echoTrigger).toBeVisible({ timeout: 5_000 });
      await expect(echoTrigger).toContainText('Auto', { timeout: 5_000 });

      // Set echo to 'off'
      await selectPermission(sidePanelPage, 'Permission for echo tool', 'Off');
      await expect(echoTrigger).toContainText('Off', { timeout: 5_000 });

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

      // Call the disabled tool — should return isError: true with review flow message
      const disabledResult = await mcpClient.callTool('e2e-test_echo', { message: 'hello' });
      expect(disabledResult.isError).toBe(true);
      expect(disabledResult.content).toContain('has not been reviewed yet');

      // Re-enable the echo tool
      await selectPermission(sidePanelPage, 'Permission for echo tool', 'Auto');
      await expect(echoTrigger).toContainText('Auto', { timeout: 5_000 });

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
    const pluginVersion = (
      JSON.parse(fs.readFileSync(path.join(E2E_TEST_PLUGIN_DIR, 'package.json'), 'utf-8')) as { version: string }
    ).version;

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-toggle-all-'));
    // Start with e2e-test plugin at 'auto' and mark as reviewed so the unreviewed dialog doesn't interfere
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: { 'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion } },
    });

    // Disable skipPermissions so permission selects are interactive
    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
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

      // Find the plugin-level permission select trigger
      const pluginTrigger = sidePanelPage.locator('[aria-label="Permission for e2e-test plugin"]');
      await expect(pluginTrigger).toBeVisible({ timeout: 5_000 });

      // Verify initial state: Auto
      await expect(pluginTrigger).toContainText('Auto', { timeout: 5_000 });

      // Set plugin permission to 'off'
      await selectPermission(sidePanelPage, 'Permission for e2e-test plugin', 'Off');

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
      await selectPermission(sidePanelPage, 'Permission for e2e-test plugin', 'Auto');

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

// ---------------------------------------------------------------------------
// Browser tool plugin-level permission
// ---------------------------------------------------------------------------

test.describe('Side panel — browser tool plugin-level permission', () => {
  test('browser plugin-level permission change disables/enables all browser tools', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-browser-plugin-'));
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        browser: { permission: 'auto' },
        'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
      },
    });

    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      // Open side panel and verify browser card is visible
      const sidePanelPage = await openSidePanel(context);
      const browserTrigger = sidePanelPage.locator('[aria-label="Permission for browser tools"]');
      await expect(browserTrigger).toBeVisible({ timeout: 30_000 });

      // Verify initial state: Auto
      await expect(browserTrigger).toContainText('Auto', { timeout: 5_000 });

      // Verify browser tools are initially enabled (no [Disabled] prefix)
      const someBrowserTools = BROWSER_TOOL_NAMES.slice(0, 3);
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            return someBrowserTools.every(name => {
              const tool = toolList.find(t => t.name === name);
              return tool !== undefined && !tool.description.startsWith('[Disabled]');
            });
          },
          {
            timeout: 15_000,
            message: 'Browser tools should initially not have [Disabled] prefix',
          },
        )
        .toBe(true);

      // Change browser plugin-level permission to 'off'
      await selectPermission(sidePanelPage, 'Permission for browser tools', 'Off');

      // Verify all browser tools get [Disabled] prefix
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            return someBrowserTools.every(name => {
              const tool = toolList.find(t => t.name === name);
              return tool?.description?.startsWith('[Disabled]') ?? false;
            });
          },
          {
            timeout: 15_000,
            message: 'All browser tools should have [Disabled] prefix after setting to off',
          },
        )
        .toBe(true);

      // Verify config.json reflects the permission change
      await expect
        .poll(
          () => {
            const config = readTestConfig(configDir);
            return config.permissions?.browser?.permission;
          },
          {
            timeout: 15_000,
            message: 'Config should have browser permission set to off',
          },
        )
        .toBe('off');

      // Change browser plugin-level permission back to 'auto'
      await selectPermission(sidePanelPage, 'Permission for browser tools', 'Auto');

      // Verify browser tools lose the [Disabled] prefix
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            return someBrowserTools.every(name => {
              const tool = toolList.find(t => t.name === name);
              return tool !== undefined && !tool.description.startsWith('[Disabled]');
            });
          },
          {
            timeout: 30_000,
            message: 'Browser tools should not have [Disabled] prefix after re-enabling',
          },
        )
        .toBe(true);

      // Verify config.json reflects the restored permission
      await expect
        .poll(
          () => {
            const config = readTestConfig(configDir);
            return config.permissions?.browser?.permission;
          },
          {
            timeout: 15_000,
            message: 'Config should have browser permission set to auto',
          },
        )
        .toBe('auto');

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
// Individual browser tool permission change
// ---------------------------------------------------------------------------

test.describe('Side panel — individual browser tool permission change', () => {
  test('changing an individual browser tool permission is reflected in MCP tools/list and config.json with smart cleanup', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-browser-tool-'));
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        browser: { permission: 'auto' },
        'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
      },
    });

    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      // Open side panel and verify browser card is visible
      const sidePanelPage = await openSidePanel(context);
      const browserTrigger = sidePanelPage.locator('[aria-label="Permission for browser tools"]');
      await expect(browserTrigger).toBeVisible({ timeout: 30_000 });

      // Expand the browser card to reveal individual tool rows
      const browserCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await browserCard.click();

      // Verify browser_list_tabs tool row is visible
      const toolTrigger = sidePanelPage.locator('[aria-label="Permission for browser_list_tabs tool"]');
      await expect(toolTrigger).toBeVisible({ timeout: 5_000 });

      // Verify initial state: Auto (inherits from browser plugin permission)
      await expect(toolTrigger).toContainText('Auto', { timeout: 5_000 });

      // Change browser_list_tabs to 'off'
      await selectPermission(sidePanelPage, 'Permission for browser_list_tabs tool', 'Off');

      // Verify the select UI reflects the change
      await expect(toolTrigger).toContainText('Off', { timeout: 5_000 });

      // Verify browser_list_tabs gets [Disabled] prefix in MCP tools/list
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const tool = toolList.find(t => t.name === 'browser_list_tabs');
            return tool?.description?.startsWith('[Disabled]') ?? false;
          },
          {
            timeout: 15_000,
            message: 'browser_list_tabs should have [Disabled] prefix after setting to off',
          },
        )
        .toBe(true);

      // Verify other browser tools are NOT affected
      const toolListAfterDisable = await mcpClient.listTools();
      const otherBrowserTools = BROWSER_TOOL_NAMES.filter(n => n !== 'browser_list_tabs').slice(0, 3);
      for (const bt of otherBrowserTools) {
        const tool = toolListAfterDisable.find(t => t.name === bt);
        expect(tool?.description?.startsWith('[Disabled]') ?? true).toBe(false);
      }

      // Verify config.json has per-tool override
      await expect
        .poll(
          () => {
            const config = readTestConfig(configDir);
            return config.permissions?.browser?.tools?.browser_list_tabs;
          },
          {
            timeout: 15_000,
            message: 'Config should have per-tool override for browser_list_tabs',
          },
        )
        .toBe('off');

      // Change browser_list_tabs back to 'auto' (matching plugin default)
      await selectPermission(sidePanelPage, 'Permission for browser_list_tabs tool', 'Auto');

      // Verify the select UI reflects the change
      await expect(toolTrigger).toContainText('Auto', { timeout: 5_000 });

      // Verify browser_list_tabs loses the [Disabled] prefix
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const tool = toolList.find(t => t.name === 'browser_list_tabs');
            return tool !== undefined && !tool.description.startsWith('[Disabled]');
          },
          {
            timeout: 30_000,
            message: 'browser_list_tabs should not have [Disabled] prefix after re-enabling',
          },
        )
        .toBe(true);

      // Smart cleanup: verify per-tool override was removed from config.json
      await expect
        .poll(
          () => {
            const config = readTestConfig(configDir);
            return config.permissions?.browser?.tools;
          },
          {
            timeout: 15_000,
            message: 'Config tools map should be removed after setting browser_list_tabs back to plugin default',
          },
        )
        .toBeUndefined();

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
// Re-selecting the current plugin-level value clears per-tool overrides
// ---------------------------------------------------------------------------

test.describe('Side panel — plugin-level re-selection clears overrides', () => {
  test('re-selecting the current plugin permission clears per-tool overrides', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-reselect-'));
    // Start with plugin at 'off' but a per-tool override of 'ask' for echo
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        'e2e-test': { permission: 'off', tools: { echo: 'ask' }, reviewedVersion: pluginVersion },
      },
    });

    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Expand the plugin card to see tool permissions
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();

      // The echo tool should show 'Ask' (per-tool override), not 'Off' (plugin default)
      const echoToolSelect = sidePanelPage.locator('[aria-label="Permission for echo tool"]');
      await expect(echoToolSelect).toContainText('Ask', { timeout: 5_000 });

      // Re-select 'Off' from the plugin-level dropdown (already 'Off')
      await selectPermission(sidePanelPage, 'Permission for e2e-test plugin', 'Off');

      // The echo tool should now reflect the cleared override (should now be 'Off')
      await expect(echoToolSelect).toContainText('Off', { timeout: 10_000 });

      // Verify the per-tool override was removed from config.json
      await expect
        .poll(
          () => {
            const config = readTestConfig(configDir);
            return config.permissions?.['e2e-test']?.tools;
          },
          { timeout: 10_000, message: 'per-tool overrides should be cleared from config.json' },
        )
        .toBeUndefined();

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
// skipPermissions mode — all selects disabled, no Switch components
// ---------------------------------------------------------------------------

test.describe('Side panel — skipPermissions mode and group headers', () => {
  test('skipPermissions shows banner and keeps permission selects interactive', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-skip-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], permissions: { 'e2e-test': { permission: 'auto' } } });

    // Enable skipPermissions — selects should remain interactive (not disabled)
    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '1' });
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      // Open side panel
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({
        timeout: 30_000,
      });

      // Wait for the approval-bypassed banner to confirm skipPermissions propagated
      await expect(sidePanelPage.getByText('Approvals skipped')).toBeVisible({ timeout: 15_000 });
      await expect(sidePanelPage.getByText('OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS')).toBeVisible();

      // Verify the plugin-level select trigger is visible and ENABLED (not disabled)
      const pluginTrigger = sidePanelPage.locator('[aria-label="Permission for e2e-test plugin"]');
      await expect(pluginTrigger).toBeVisible({ timeout: 5_000 });
      await expect(pluginTrigger).toBeEnabled();

      // Verify the browser tools select trigger is visible and ENABLED
      const browserTrigger = sidePanelPage.locator('[aria-label="Permission for browser tools"]');
      await expect(browserTrigger).toBeVisible({ timeout: 5_000 });
      await expect(browserTrigger).toBeEnabled();

      // Expand the plugin card to reveal tool rows
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();

      // Wait for tool rows to be visible
      await expect(sidePanelPage.getByText('Echo', { exact: true })).toBeVisible({ timeout: 5_000 });

      // Verify tool-level select triggers are ENABLED
      const echoTrigger = sidePanelPage.locator('[aria-label="Permission for echo tool"]');
      await expect(echoTrigger).toBeVisible({ timeout: 5_000 });
      await expect(echoTrigger).toBeEnabled();

      // Verify no Switch components exist anywhere in the side panel
      // (group headers are plain text dividers, not interactive switches)
      const switches = sidePanelPage.locator('[role="switch"]');
      await expect(switches).toHaveCount(0);

      await sidePanelPage.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('Restore approvals survives dev proxy hot reload (worker restart)', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-hot-restore-'));
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        browser: { permission: 'auto' },
        'e2e-test': { permission: 'ask', reviewedVersion: pluginVersion },
      },
    });

    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '1' });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      const sidePanelPage = await openSidePanel(context);

      // Verify the 'Approvals skipped' banner is visible
      await expect(sidePanelPage.getByText('Approvals skipped')).toBeVisible({ timeout: 15_000 });

      // Click 'Restore approvals' button
      await sidePanelPage.getByRole('button', { name: 'Restore approvals' }).click();

      // Verify the banner disappears
      await expect(sidePanelPage.getByText('Approvals skipped')).toBeHidden({ timeout: 5_000 });

      // Trigger hot reload (kills the worker, forks a new one)
      server.logs.length = 0;
      server.triggerHotReload();
      await waitForLog(server, 'Hot reload complete', 20_000);

      // Wait for reconnection and state sync
      await waitForExtensionConnected(server, 30_000);
      await waitForLog(server, 'Sent sync.full to extension', 15_000);

      // Verify the banner is still hidden after the hot reload
      await expect(sidePanelPage.getByText('Approvals skipped')).toBeHidden({ timeout: 10_000 });

      // Verify via MCP client that 'ask' tools are NOT auto-promoted.
      // When skipPermissions is active, tool descriptions get an '[Auto]' prefix.
      // After restoring approvals, 'ask' tools must retain their 'ask' behavior.
      const toolList = await mcpClient.listTools();
      const e2eTestTools = toolList.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eTestTools.length).toBeGreaterThan(0);
      for (const tool of e2eTestTools) {
        expect(tool.description.startsWith('[Auto]')).toBe(false);
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

  test('Restore approvals button disables skipPermissions and survives permission change reload', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-restore-'));
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        browser: { permission: 'auto' },
        'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
      },
    });

    // Enable skipPermissions so the banner appears
    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '1' });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      const sidePanelPage = await openSidePanel(context);

      // Verify the 'Approvals skipped' banner is visible
      await expect(sidePanelPage.getByText('Approvals skipped')).toBeVisible({ timeout: 15_000 });

      // Click 'Restore approvals' button
      await sidePanelPage.getByRole('button', { name: 'Restore approvals' }).click();

      // Verify the banner disappears
      await expect(sidePanelPage.getByText('Approvals skipped')).toBeHidden({ timeout: 5_000 });

      // Change browser permission to 'off' — this triggers a hot reload via plugins.changed
      await selectPermission(sidePanelPage, 'Permission for browser tools', 'Off');

      // Wait for the permission change to propagate via MCP
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const tool = toolList.find(t => t.name === 'browser_list_tabs');
            return tool?.description?.startsWith('[Disabled]') ?? false;
          },
          {
            timeout: 15_000,
            message: 'browser_list_tabs should have [Disabled] prefix after setting browser to off',
          },
        )
        .toBe(true);

      // Verify the banner is still hidden after the reload (skipPermissions was not re-enabled)
      await expect(sidePanelPage.getByText('Approvals skipped')).toBeHidden({ timeout: 5_000 });

      // Verify permission selects remain interactive
      const browserTrigger = sidePanelPage.locator('[aria-label="Permission for browser tools"]');
      await expect(browserTrigger).toBeEnabled();

      // Change browser permission back to 'auto' to verify selects still work
      await selectPermission(sidePanelPage, 'Permission for browser tools', 'Auto');
      await expect(browserTrigger).toContainText('Auto', { timeout: 5_000 });

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
// Stress tests — rapid cycling, race conditions, and boundary values
// ---------------------------------------------------------------------------

const tick = (ms = 100) => new Promise(r => setTimeout(r, ms));
const collectPageErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (err: Error) => errors.push(err.message));
  return errors;
};

test.describe('stress', () => {
  test('rapid permission cycling across plugin, tool, and browser selects', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-stress-cycle-'));
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        browser: { permission: 'auto' },
        'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
      },
    });

    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      const sidePanelPage = await openSidePanel(context);
      const pageErrors = collectPageErrors(sidePanelPage);

      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Expand plugin card to reveal tool rows
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();
      await expect(sidePanelPage.locator('[aria-label="Permission for echo tool"]')).toBeVisible({ timeout: 5_000 });

      // Expand browser card to reveal browser tool rows
      const browserCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await browserCard.click();
      await expect(sidePanelPage.locator('[aria-label="Permission for browser_list_tabs tool"]')).toBeVisible({
        timeout: 5_000,
      });

      const permValues: Array<'Off' | 'Ask' | 'Auto'> = ['Off', 'Ask', 'Auto'];

      // Cycle Off → Ask → Auto 3 times, interleaving plugin, tool, and browser selects
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const value of permValues) {
          await selectPermission(sidePanelPage, 'Permission for e2e-test plugin', value);
          await tick(50);
          await selectPermission(sidePanelPage, 'Permission for echo tool', value);
          await tick(50);
          await selectPermission(sidePanelPage, 'Permission for browser tools', value);
          await tick(50);
        }
      }

      // After all cycles, everything should end at 'Auto'
      const pluginSelect = sidePanelPage.locator('[aria-label="Permission for e2e-test plugin"]');
      const echoSelect = sidePanelPage.locator('[aria-label="Permission for echo tool"]');
      const browserSelect = sidePanelPage.locator('[aria-label="Permission for browser tools"]');

      await expect(pluginSelect).toContainText('Auto', { timeout: 10_000 });
      await expect(echoSelect).toContainText('Auto', { timeout: 10_000 });
      await expect(browserSelect).toContainText('Auto', { timeout: 10_000 });

      // Verify server state: e2e-test_echo and browser_list_tabs should not be disabled
      await expect
        .poll(
          async () => {
            const toolList = await mcpClient.listTools();
            const echo = toolList.find(t => t.name === 'e2e-test_echo');
            const listTabs = toolList.find(t => t.name === 'browser_list_tabs');
            return (
              echo !== undefined &&
              !echo.description.startsWith('[Disabled]') &&
              listTabs !== undefined &&
              !listTabs.description.startsWith('[Disabled]')
            );
          },
          {
            timeout: 15_000,
            message: 'e2e-test_echo and browser_list_tabs should not be disabled after cycling to Auto',
          },
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

  test('override clearing: changing plugin permission clears per-tool overrides', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const pluginVersion = getPluginVersion();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-stress-override-'));
    // Pre-seed with per-tool override: plugin is 'off', but echo has 'ask' override
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath],
      permissions: {
        'e2e-test': { permission: 'off', tools: { echo: 'ask' }, reviewedVersion: pluginVersion },
      },
    });

    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      const sidePanelPage = await openSidePanel(context);
      const pageErrors = collectPageErrors(sidePanelPage);

      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // Expand plugin card
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();

      // Verify echo shows 'Ask' (the per-tool override, not the plugin default 'Off')
      const echoSelect = sidePanelPage.locator('[aria-label="Permission for echo tool"]');
      await expect(echoSelect).toContainText('Ask', { timeout: 5_000 });

      // Change plugin permission to 'Auto' — this should clear per-tool overrides
      await selectPermission(sidePanelPage, 'Permission for e2e-test plugin', 'Auto');

      // Verify echo now shows 'Auto' (override cleared, inherits from plugin default)
      await expect(echoSelect).toContainText('Auto', { timeout: 10_000 });

      // Verify config.json tools map is cleared
      await expect
        .poll(
          () => {
            const config = readTestConfig(configDir);
            return config.permissions?.['e2e-test']?.tools;
          },
          { timeout: 10_000, message: 'per-tool overrides should be cleared from config.json after plugin change' },
        )
        .toBeUndefined();

      // Now set echo to 'Off' (fresh per-tool override)
      await selectPermission(sidePanelPage, 'Permission for echo tool', 'Off');
      await expect(echoSelect).toContainText('Off', { timeout: 5_000 });

      // Verify the override was written to config
      await expect
        .poll(
          () => {
            const config = readTestConfig(configDir);
            return config.permissions?.['e2e-test']?.tools?.echo;
          },
          { timeout: 10_000, message: 'echo should have per-tool override of off' },
        )
        .toBe('off');

      // Change plugin permission back to 'Auto' — should clear the fresh override
      await selectPermission(sidePanelPage, 'Permission for e2e-test plugin', 'Auto');
      await expect(echoSelect).toContainText('Auto', { timeout: 10_000 });

      // Verify tools map cleared again
      await expect
        .poll(
          () => {
            const config = readTestConfig(configDir);
            return config.permissions?.['e2e-test']?.tools;
          },
          { timeout: 10_000, message: 'per-tool overrides should be cleared again after second plugin change' },
        )
        .toBeUndefined();

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
