/**
 * Side panel error states E2E tests.
 *
 * Verifies:
 *   1. Failed plugin cards render with "Failed to load" header, specifier, and error message
 *   2. Long error messages (>100 chars) show a "Show more"/"Show less" toggle
 *   3. Permission change via the UI persists to config.json and is reflected in MCP tools/list
 *   4. Connection loss wipes transient state (search query, npm results) but preserves
 *      persisted state (accordion expand via chrome.storage.session)
 *
 * Note on optimistic rollback: PluginCard.tsx rolls back the Select value if
 * the bridge call fails (e.g., setToolPermission rejects). However, this cannot
 * be reliably triggered in E2E because the only failure path (server disconnect)
 * also triggers the App-level disconnect handler which wipes all plugin state
 * and shows the "Cannot Reach MCP Server" screen. The rollback error alert is
 * therefore only visible in component-level tests, not E2E. The positive path
 * (permission change succeeds and persists) is verified below.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createMinimalPlugin,
  E2E_TEST_PLUGIN_DIR,
  expect,
  launchExtensionContext,
  readPluginToolNames,
  readTestConfig,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import {
  openSidePanel,
  selectPermission,
  setupAdapterSymlink,
  waitForExtensionConnected,
  waitForLog,
} from './helpers.js';

test.describe('Side panel — permission change alongside error states', () => {
  test('permission change succeeds and persists to config.json alongside a broken plugin', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-perm-err-'));
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-config-'));

    // Create a broken plugin (no dist/) — will produce a FailedPluginCard
    const brokenDir = path.join(tmpDir, 'broken-plugin');
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(
      path.join(brokenDir, 'package.json'),
      JSON.stringify({
        name: 'opentabs-plugin-broken',
        version: '1.0.0',
        opentabs: { name: 'broken' },
      }),
    );
    const brokenPath = path.resolve(brokenDir);

    // Create a working minimal plugin with one tool
    const workingPath = createMinimalPlugin(tmpDir, 'test-perm', [{ name: 'do_thing', description: 'A test tool' }]);

    // Start both plugins: working plugin at 'off' (reviewed), broken plugin at 'auto'.
    // skipPermissions disabled so permission selects are interactive.
    writeTestConfig(configDir, {
      localPlugins: [workingPath, brokenPath],
      permissions: {
        'test-perm': { permission: 'off', reviewedVersion: '0.0.1' },
        broken: { permission: 'auto' },
      },
    });

    const server = await startMcpServer(configDir, true, undefined, {
      OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '',
    });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await mcpClient.initialize();

      const sidePanel = await openSidePanel(context);

      // Both cards are visible: the broken plugin error card and the working plugin card
      await expect(sidePanel.getByText('Failed to load')).toBeVisible({ timeout: 15_000 });
      await expect(sidePanel.getByText('Test test-perm')).toBeVisible({ timeout: 15_000 });

      // Verify the working plugin-level permission Select shows 'Off'
      const pluginSelect = sidePanel.locator('[aria-label="Permission for test-perm plugin"]');
      await expect(pluginSelect).toBeVisible({ timeout: 5_000 });
      await expect(pluginSelect).toContainText('Off', { timeout: 5_000 });

      // Verify the MCP tools/list shows the tool as disabled
      const toolsBefore = await mcpClient.listTools();
      const toolBefore = toolsBefore.find(t => t.name === 'test-perm_do_thing');
      expect(toolBefore?.description).toMatch(/^\[Disabled\]/);

      // Change the plugin permission from 'off' to 'auto'
      await selectPermission(sidePanel, 'Permission for test-perm plugin', 'Auto');

      // UI immediately reflects the new value (optimistic update)
      await expect(pluginSelect).toContainText('Auto', { timeout: 5_000 });

      // Verify config.json is updated with the new permission
      await expect
        .poll(
          () => {
            const config = readTestConfig(configDir);
            return config.permissions?.['test-perm']?.permission;
          },
          {
            timeout: 15_000,
            message: 'config.json should reflect permission change to auto',
          },
        )
        .toBe('auto');

      // Verify MCP tools/list reflects the change (no [Disabled] prefix)
      await expect
        .poll(
          async () => {
            const tools = await mcpClient.listTools();
            const tool = tools.find(t => t.name === 'test-perm_do_thing');
            return tool !== undefined && !tool.description.startsWith('[Disabled]');
          },
          {
            timeout: 15_000,
            message: 'MCP tools/list should show test-perm_do_thing without [Disabled] prefix',
          },
        )
        .toBe(true);

      // Verify the broken plugin error card is still visible (not affected by permission change)
      await expect(sidePanel.getByText('Failed to load')).toBeVisible();
    } finally {
      await mcpClient.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
  });
});

test.describe('Side panel error states', () => {
  test('broken plugin shows FailedPluginCard with specifier and error', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-broken-'));
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-config-'));

    // Create a broken plugin — valid package.json with opentabs field but no dist/ artifacts
    const brokenDir = path.join(tmpDir, 'broken-plugin');
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(
      path.join(brokenDir, 'package.json'),
      JSON.stringify({
        name: 'opentabs-plugin-broken',
        version: '1.0.0',
        opentabs: { name: 'broken' },
      }),
    );

    const brokenPath = path.resolve(brokenDir);
    writeTestConfig(configDir, { localPlugins: [brokenPath] });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      const sidePanel = await openSidePanel(context);

      // FailedPluginCard renders with "Failed to load" header
      await expect(sidePanel.getByText('Failed to load')).toBeVisible({ timeout: 15_000 });

      // The plugin specifier (the local path) is displayed
      await expect(sidePanel.getByText(brokenPath, { exact: true })).toBeVisible();

      // The error card container is rendered with destructive styling
      const errorCard = sidePanel.locator('.bg-destructive\\/10');
      await expect(errorCard).toBeVisible();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
  });

  test('long error shows Show more/less toggle', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-broken-'));
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-config-'));

    // Use a long directory name to guarantee the error message exceeds 100 chars.
    // The loader produces: "Failed to read dist/tools.json at <path>: file missing or invalid JSON"
    const longName =
      'broken-plugin-with-a-deliberately-very-long-directory-name-to-ensure-error-exceeds-one-hundred-chars';
    const brokenDir = path.join(tmpDir, longName);
    fs.mkdirSync(path.join(brokenDir, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(brokenDir, 'package.json'),
      JSON.stringify({
        name: `opentabs-plugin-${longName}`,
        version: '1.0.0',
        opentabs: { name: longName },
      }),
    );
    // Valid adapter but invalid tools.json triggers a long error message
    fs.writeFileSync(path.join(brokenDir, 'dist', 'adapter.iife.js'), '(function(){})();');
    fs.writeFileSync(path.join(brokenDir, 'dist', 'tools.json'), '{invalid json}');

    const brokenPath = path.resolve(brokenDir);
    writeTestConfig(configDir, { localPlugins: [brokenPath] });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      const sidePanel = await openSidePanel(context);

      // Wait for the FailedPluginCard
      await expect(sidePanel.getByText('Failed to load')).toBeVisible({ timeout: 15_000 });

      // "Show more" button appears for long errors (>100 chars)
      await expect(sidePanel.getByText('Show more')).toBeVisible();

      // Click "Show more" to expand — button changes to "Show less"
      await sidePanel.getByText('Show more').click();
      await expect(sidePanel.getByText('Show less')).toBeVisible();

      // Click "Show less" to collapse — button changes back to "Show more"
      await sidePanel.getByText('Show less').click();
      await expect(sidePanel.getByText('Show more')).toBeVisible();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// US-003: Connection loss — transient state wiped, persisted state survives
// ---------------------------------------------------------------------------

test.describe('Side panel — connection loss state behavior', () => {
  test('disconnect wipes transient state but preserves accordion expand', async () => {
    // Use the e2e-test plugin so the side panel has a real plugin card
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-conn-loss-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const serverPort = server.port;
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);

      const sidePanel = await openSidePanel(context);

      // 1. Wait for connected state: plugin card visible
      await expect(sidePanel.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 2. Expand the Browser tools accordion (persisted in chrome.storage.session)
      const browserCard = sidePanel.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await expect(browserCard).toBeVisible({ timeout: 5_000 });
      // Click to expand if not already expanded
      const isExpanded = await browserCard.getAttribute('aria-expanded');
      if (isExpanded !== 'true') {
        await browserCard.click();
      }
      await expect(browserCard).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });

      // 3. Type a search query to create transient state (searchQuery + search mode).
      // The search input is visible when connected and has the placeholder text.
      const searchInput = sidePanel.getByPlaceholder('Search plugins and tools...');
      await expect(searchInput).toBeVisible({ timeout: 5_000 });
      await searchInput.fill('test-search-query');
      await expect(searchInput).toHaveValue('test-search-query');

      // 4. Kill server → disconnect screen appears
      await server.kill();
      await expect(sidePanel.getByText('Cannot Reach MCP Server')).toBeVisible({ timeout: 30_000 });

      // Search bar should be hidden when disconnected (showSearchBar = connected && !loading)
      await expect(searchInput).toBeHidden({ timeout: 5_000 });

      // 5. Restart server on the same port → reconnection
      const server2 = await startMcpServer(configDir, true, serverPort);

      try {
        // Wait for the side panel to reconnect and show plugin cards again
        await expect(sidePanel.getByText('E2E Test')).toBeVisible({ timeout: 45_000 });

        // 6. Verify transient state is wiped: search bar is visible again but empty
        const searchInputAfter = sidePanel.getByPlaceholder('Search plugins and tools...');
        await expect(searchInputAfter).toBeVisible({ timeout: 5_000 });
        await expect(searchInputAfter).toHaveValue('');

        // 7. Verify persisted state survives: Browser accordion still expanded
        // (browserToolsOpen is stored in chrome.storage.session, not wiped by disconnect)
        const browserCardAfter = sidePanel.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
        await expect(browserCardAfter).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });
      } finally {
        await server2.kill();
      }

      await sidePanel.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// US-004: Stress tests — rapid permission changes during error state
// ---------------------------------------------------------------------------

/** Read the e2e-test plugin version from its package.json for reviewedVersion matching. */
const e2eTestPluginVersion = (
  JSON.parse(fs.readFileSync(path.join(E2E_TEST_PLUGIN_DIR, 'package.json'), 'utf-8')) as { version: string }
).version;

const tick = (ms = 100) => new Promise(r => setTimeout(r, ms));
const collectPageErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (err: Error) => errors.push(err.message));
  return errors;
};

test.describe('stress', () => {
  test('rapid permission changes while error card is visible', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-stress-err-'));
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-config-'));

    // Create a broken plugin (no dist/) — will produce a FailedPluginCard
    const brokenDir = path.join(tmpDir, 'broken-plugin');
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(
      path.join(brokenDir, 'package.json'),
      JSON.stringify({
        name: 'opentabs-plugin-broken',
        version: '1.0.0',
        opentabs: { name: 'broken' },
      }),
    );
    const brokenPath = path.resolve(brokenDir);

    // Use the e2e-test plugin as the working plugin
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

    // Start both plugins: e2e-test at 'off', broken at 'auto'.
    // skipPermissions disabled so permission selects are interactive.
    // reviewedVersion set to prevent the unreviewed plugin confirmation dialog
    // from blocking rapid permission toggling.
    writeTestConfig(configDir, {
      localPlugins: [absPluginPath, brokenPath],
      permissions: {
        'e2e-test': { permission: 'off', reviewedVersion: e2eTestPluginVersion },
        broken: { permission: 'auto' },
      },
    });

    const server = await startMcpServer(configDir, true, undefined, {
      OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '',
    });
    const mcpClient = createMcpClient(server.port, server.secret);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);
      await mcpClient.initialize();

      const sidePanelPage = await openSidePanel(context);
      const pageErrors = collectPageErrors(sidePanelPage);

      // Verify both cards are visible: error card and working plugin card
      await expect(sidePanelPage.getByText('Failed to load')).toBeVisible({ timeout: 15_000 });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });

      // Expand the e2e-test plugin card to reveal permission select
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();
      const pluginSelect = sidePanelPage.locator('[aria-label="Permission for e2e-test plugin"]');
      await expect(pluginSelect).toBeVisible({ timeout: 5_000 });
      await expect(pluginSelect).toContainText('Off', { timeout: 5_000 });

      // Rapidly toggle permission 5x: Off → Auto → Off → Auto → Off
      const sequence: Array<'Off' | 'Auto'> = ['Off', 'Auto', 'Off', 'Auto', 'Off'];
      for (const value of sequence) {
        await selectPermission(sidePanelPage, 'Permission for e2e-test plugin', value);
        await tick(100);
      }

      // Verify the final value ('Off') is shown in the UI
      await expect(pluginSelect).toContainText('Off', { timeout: 10_000 });

      // Verify config.json persisted the final permission value
      await expect
        .poll(
          () => {
            const config = readTestConfig(configDir);
            return config.permissions?.['e2e-test']?.permission;
          },
          {
            timeout: 15_000,
            message: 'config.json should reflect final permission value of off',
          },
        )
        .toBe('off');

      // Verify the broken plugin error card remained visible throughout
      await expect(sidePanelPage.getByText('Failed to load')).toBeVisible();

      expect(pageErrors).toEqual([]);

      await sidePanelPage.close();
    } finally {
      await mcpClient.close().catch(() => {});
      await context.close().catch(() => {});
      await server.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(cleanupDir, { recursive: true, force: true });
    }
  });
});
