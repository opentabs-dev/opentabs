/**
 * E2E tests for browser tool group rendering in the side panel.
 *
 * Verifies that the BrowserToolsCard renders group headers correctly when the
 * browser tools catalog contains grouped tools. This prevents regressions where
 * grouping logic is accidentally lost (as happened during the permission
 * redesign merge).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupTestConfigDir,
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
  openSidePanel,
  openTestAppTab,
  setupAdapterSymlink,
  waitForExtensionConnected,
  waitForLog,
} from './helpers.js';

/** Build a tools map from the e2e-test plugin's prefixed tool names. */
const buildToolsMap = (): Record<string, boolean> => {
  const tools: Record<string, boolean> = {};
  for (const t of readPluginToolNames()) {
    tools[t] = true;
  }
  return tools;
};

test.describe('Side panel — browser tool groups', () => {
  test('renders at least 3 distinct group headers with tools below each', async () => {
    // 1. Start MCP server with e2e-test plugin (required for side panel to render)
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-bt-groups-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      // 3. Open side panel and verify Browser card is visible
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('Browser')).toBeVisible({ timeout: 30_000 });

      // 4. Expand the Browser accordion
      const browserCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await browserCard.click();

      // 5. Verify group headers are visible. Group headers are rendered as:
      //    <div class="border-border border-b bg-muted/20 px-3 py-1">
      //      <span class="font-head text-muted-foreground text-xs uppercase tracking-wider">GROUP NAME</span>
      //    </div>
      // Locate group header spans within the expanded Browser accordion item.
      const browserItem = sidePanelPage.locator('[data-state="open"]').filter({ hasText: 'Browser' });
      const groupHeaders = browserItem.locator('span.uppercase.tracking-wider');

      // Wait for at least one group header to appear
      await expect(groupHeaders.first()).toBeVisible({ timeout: 5_000 });

      // 6. Verify at least 3 distinct group headers appear (the catalog has 7 groups).
      await expect(groupHeaders.nth(2)).toBeVisible({ timeout: 5_000 });

      // 7. Verify specific known group names appear (these are from the catalog)
      for (const groupName of ['Tabs', 'Page Interaction', 'Page Inspection']) {
        await expect(browserItem.locator('span.uppercase.tracking-wider', { hasText: groupName })).toBeVisible({
          timeout: 5_000,
        });
      }

      // 8. Verify group headers have the expected styling classes (uppercase text)
      const firstHeader = groupHeaders.first();
      await expect(firstHeader).toHaveClass(/font-head/);
      await expect(firstHeader).toHaveClass(/text-xs/);
      await expect(firstHeader).toHaveClass(/uppercase/);
      await expect(firstHeader).toHaveClass(/tracking-wider/);

      // 9. Verify tool rows appear below their respective group headers.
      // "List Tabs" is a known tool in the Tabs group, "Click Element" is in
      // Page Interaction. Both should be visible within the expanded accordion.
      await expect(browserItem.getByText('List Tabs', { exact: true })).toBeVisible({ timeout: 5_000 });
      await expect(browserItem.getByText('Click Element', { exact: true })).toBeVisible({ timeout: 5_000 });

      await sidePanelPage.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('search filter shows only the matching group header', async () => {
    // 1. Start MCP server
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-bt-groups-filter-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      // 3. Open side panel and verify Browser card is visible
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('Browser')).toBeVisible({ timeout: 30_000 });

      // 4. Type a search term that matches tools in only one group.
      // "select option" matches only browser_select_option (display name "Select Option")
      // in the "Page Interaction" group. The search bar switches the view to
      // SearchResults, which renders BrowserToolsCard with a toolFilter prop.
      const searchInput = sidePanelPage.locator('input[placeholder*="earch"]');
      await searchInput.fill('select option');

      // 5. In SearchResults view, the Browser card starts collapsed.
      // Wait for it to appear, then expand it.
      const browserCardInSearch = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await expect(browserCardInSearch).toBeVisible({ timeout: 5_000 });
      await browserCardInSearch.click();

      // 6. Verify only the "Page Interaction" group header is visible.
      const browserItem = sidePanelPage.locator('[data-state="open"]').filter({ hasText: 'Browser' });
      const groupHeaders = browserItem.locator('span.uppercase.tracking-wider');

      await expect(browserItem.locator('span.uppercase.tracking-wider', { hasText: 'Page Interaction' })).toBeVisible({
        timeout: 5_000,
      });

      // Only one group header should be visible
      await expect(groupHeaders).toHaveCount(1);

      // Other groups should not be present
      await expect(browserItem.locator('span.uppercase.tracking-wider', { hasText: 'Tabs' })).toBeHidden();
      await expect(browserItem.locator('span.uppercase.tracking-wider', { hasText: 'Storage & Cookies' })).toBeHidden();

      // 7. Clear the filter and verify all groups return.
      // Clearing the search switches back to the normal view.
      await searchInput.fill('');

      // The normal view shows the Browser card. Re-expand it.
      const browserCardNormal = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await expect(browserCardNormal).toBeVisible({ timeout: 5_000 });
      await browserCardNormal.click();

      const normalBrowserItem = sidePanelPage.locator('[data-state="open"]').filter({ hasText: 'Browser' });
      const normalGroupHeaders = normalBrowserItem.locator('span.uppercase.tracking-wider');
      await expect(normalGroupHeaders.nth(2)).toBeVisible({ timeout: 5_000 });

      await sidePanelPage.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('stress', () => {
  test('rapid search cycling does not cause stale group rendering', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-bt-groups-stress-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    let server: Awaited<ReturnType<typeof startMcpServer>> | undefined;
    let testServer: Awaited<ReturnType<typeof startTestServer>> | undefined;
    let context: Awaited<ReturnType<typeof launchExtensionContext>>['context'] | undefined;
    let cleanupDir: string | undefined;

    const pageErrors: Error[] = [];

    try {
      server = await startMcpServer(configDir, true);
      testServer = await startTestServer();
      const ext = await launchExtensionContext(server.port, server.secret);
      context = ext.context;
      cleanupDir = ext.cleanupDir;
      setupAdapterSymlink(configDir, ext.extensionDir);

      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      await openTestAppTab(context, testServer.url, server, testServer);
      const sidePanelPage = await openSidePanel(context);
      sidePanelPage.on('pageerror', error => pageErrors.push(error));

      await expect(sidePanelPage.getByText('Browser')).toBeVisible({ timeout: 30_000 });

      // Expand browser card initially to confirm tools are visible
      const browserCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await browserCard.click();
      const browserItem = sidePanelPage.locator('[data-state="open"]').filter({ hasText: 'Browser' });
      await expect(browserItem.locator('span.uppercase.tracking-wider').first()).toBeVisible({ timeout: 5_000 });

      const searchInput = sidePanelPage.locator('input[placeholder*="earch"]');

      // Rapid search cycling: type 'tab', 'page', 'inspect' in quick succession
      for (const term of ['tab', 'page', 'inspect']) {
        await searchInput.fill(term);
        await new Promise(r => setTimeout(r, 100));
      }

      // Clear the search
      await searchInput.fill('');
      await new Promise(r => setTimeout(r, 300));

      // Verify browser card is still visible after clearing search
      const browserCardAfter = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'Browser' });
      await expect(browserCardAfter).toBeVisible({ timeout: 5_000 });

      // Expand and verify tool groups still render
      const isExpanded = await browserCardAfter.getAttribute('aria-expanded');
      if (isExpanded !== 'true') {
        await browserCardAfter.click();
      }
      await expect(browserCardAfter).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });
      const browserItemAfter = sidePanelPage.locator('[data-state="open"]').filter({ hasText: 'Browser' });
      const groupHeaders = browserItemAfter.locator('span.uppercase.tracking-wider');
      await expect(groupHeaders.nth(2)).toBeVisible({ timeout: 10_000 });

      expect(pageErrors).toHaveLength(0);

      await sidePanelPage.close();
    } finally {
      await context?.close().catch(() => {});
      await server?.kill();
      await testServer?.kill();
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('special characters in search do not crash', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-bt-groups-special-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    let server: Awaited<ReturnType<typeof startMcpServer>> | undefined;
    let testServer: Awaited<ReturnType<typeof startTestServer>> | undefined;
    let context: Awaited<ReturnType<typeof launchExtensionContext>>['context'] | undefined;
    let cleanupDir: string | undefined;

    const pageErrors: Error[] = [];

    try {
      server = await startMcpServer(configDir, true);
      testServer = await startTestServer();
      const ext = await launchExtensionContext(server.port, server.secret);
      context = ext.context;
      cleanupDir = ext.cleanupDir;
      setupAdapterSymlink(configDir, ext.extensionDir);

      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      await openTestAppTab(context, testServer.url, server, testServer);
      const sidePanelPage = await openSidePanel(context);
      sidePanelPage.on('pageerror', error => pageErrors.push(error));

      await expect(sidePanelPage.getByText('Browser')).toBeVisible({ timeout: 30_000 });

      const searchInput = sidePanelPage.locator('input[placeholder*="earch"]');

      // Test regex-special characters
      await searchInput.fill('^$.*+()[]{}|\\');
      await new Promise(r => setTimeout(r, 300));

      // Page should still be functional (no crash)
      await expect(sidePanelPage.locator('input[placeholder*="earch"]')).toBeVisible();

      // Clear and test HTML injection attempt
      await searchInput.fill('');
      await searchInput.fill('<script>alert(1)</script>');
      await new Promise(r => setTimeout(r, 300));

      // Page should still be functional
      await expect(sidePanelPage.locator('input[placeholder*="earch"]')).toBeVisible();

      // Clear and verify cards are still visible
      await searchInput.fill('');
      await new Promise(r => setTimeout(r, 300));
      await expect(sidePanelPage.getByText('Browser')).toBeVisible({ timeout: 5_000 });

      expect(pageErrors).toHaveLength(0);

      await sidePanelPage.close();
    } finally {
      await context?.close().catch(() => {});
      await server?.kill();
      await testServer?.kill();
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
