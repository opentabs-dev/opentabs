/**
 * E2E tests for plugin tool group rendering in the side panel.
 *
 * Verifies that the PluginCard renders group headers correctly when the
 * e2e-test plugin has tools with `group` fields. This prevents regressions
 * where grouping logic is accidentally lost during refactors.
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
  test,
  writeTestConfig,
} from './fixtures.js';
import { openSidePanel, setupAdapterSymlink, waitForExtensionConnected, waitForLog } from './helpers.js';

/** Build a tools map from the e2e-test plugin's prefixed tool names. */
const buildToolsMap = (): Record<string, boolean> => {
  const tools: Record<string, boolean> = {};
  for (const t of readPluginToolNames()) {
    tools[t] = true;
  }
  return tools;
};

test.describe('Side panel — plugin tool groups', () => {
  test('renders group headers and tool rows within group sections', async () => {
    // 1. Start MCP server with e2e-test plugin
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-plugin-groups-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      // 3. Open side panel and verify plugin card is visible
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test').first()).toBeVisible({ timeout: 30_000 });

      // 4. Expand the E2E Test plugin accordion
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();

      // 5. Locate the expanded plugin accordion item.
      // The e2e-test plugin accordion value is 'e2e-test'.
      const pluginItem = sidePanelPage.locator('[data-state="open"]').filter({ hasText: 'E2E Test' });

      // 6. Verify group headers are visible. PluginCard group headers use the
      //    same styling as BrowserToolsCard: uppercase, tracking-wider span.
      const groupHeaders = pluginItem.locator('span.uppercase.tracking-wider');
      await expect(groupHeaders.first()).toBeVisible({ timeout: 5_000 });

      // 7. Verify at least 2 distinct group headers appear.
      // The e2e-test plugin has 2 groups: "Basic" and "Data", plus ungrouped
      // tools that appear under "Other" — so at least 3 headers total.
      const headerCount = await groupHeaders.count();
      expect(headerCount).toBeGreaterThanOrEqual(2);

      // 8. Verify specific known group names appear
      await expect(pluginItem.locator('span.uppercase.tracking-wider', { hasText: 'Basic' })).toBeVisible({
        timeout: 5_000,
      });
      await expect(pluginItem.locator('span.uppercase.tracking-wider', { hasText: 'Data' })).toBeVisible({
        timeout: 5_000,
      });

      // 9. Verify "Other" group appears for ungrouped tools
      await expect(pluginItem.locator('span.uppercase.tracking-wider', { hasText: 'Other' })).toBeVisible({
        timeout: 5_000,
      });

      // 10. Verify tool rows appear within their group sections.
      // "Echo" is in the "Basic" group, "List Items" is in the "Data" group.
      await expect(pluginItem.getByText('Echo', { exact: true })).toBeVisible({ timeout: 5_000 });
      await expect(pluginItem.getByText('List Items', { exact: true })).toBeVisible({ timeout: 5_000 });

      // 11. Verify group header ordering: "Basic" appears before "Data" (first-seen
      // order from the tools array: echo comes first with group "Basic").
      const headerTexts = await groupHeaders.evaluateAll(els => els.map(el => el.textContent?.trim() ?? ''));
      const basicIdx = headerTexts.indexOf('Basic');
      const dataIdx = headerTexts.indexOf('Data');
      expect(basicIdx).toBeGreaterThanOrEqual(0);
      expect(dataIdx).toBeGreaterThanOrEqual(0);
      expect(basicIdx).toBeLessThan(dataIdx);

      // 12. Verify group headers have the expected styling classes
      const firstHeader = groupHeaders.first();
      await expect(firstHeader).toHaveClass(/font-head/);
      await expect(firstHeader).toHaveClass(/text-xs/);
      await expect(firstHeader).toHaveClass(/uppercase/);
      await expect(firstHeader).toHaveClass(/tracking-wider/);

      await sidePanelPage.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('group headers are plain text dividers', async () => {
    // Group headers are non-interactive text labels (uppercase, tracking-wider)
    // displayed inside a bg-muted/20 container. There are no Switch toggles.
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-plugin-groups-headers-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test').first()).toBeVisible({ timeout: 30_000 });

      // Expand the E2E Test plugin accordion
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();

      const pluginItem = sidePanelPage.locator('[data-state="open"]').filter({ hasText: 'E2E Test' });

      // Wait for group headers to appear
      const groupHeaders = pluginItem.locator('span.uppercase.tracking-wider');
      await expect(groupHeaders.first()).toBeVisible({ timeout: 5_000 });

      // Group headers live inside bg-muted/30 containers with a left accent bar
      const groupHeaderContainers = pluginItem.locator('div.bg-muted\\/30');
      const containerCount = await groupHeaderContainers.count();
      expect(containerCount).toBeGreaterThanOrEqual(2);

      // No Switch components exist — group headers are non-interactive dividers
      const switches = pluginItem.locator('[role="switch"]');
      await expect(switches).toHaveCount(0);

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
  test('rapid accordion expand/collapse 10x keeps group headers intact', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-plugin-groups-stress-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    const pageErrors: Error[] = [];

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped', 15_000);

      const sidePanelPage = await openSidePanel(context);
      sidePanelPage.on('pageerror', error => pageErrors.push(error));

      await expect(sidePanelPage.getByText('E2E Test').first()).toBeVisible({ timeout: 30_000 });

      // Expand the E2E Test plugin accordion and verify group headers
      const pluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await pluginCard.click();

      const pluginItem = sidePanelPage.locator('[data-state="open"]').filter({ hasText: 'E2E Test' });
      const groupHeaders = pluginItem.locator('span.uppercase.tracking-wider');
      await expect(groupHeaders.first()).toBeVisible({ timeout: 5_000 });

      // Rapid expand/collapse 10 times
      const cycles = 10;
      for (let i = 0; i < cycles; i++) {
        await pluginCard.click(); // collapse
        await new Promise(r => setTimeout(r, 30));
        await pluginCard.click(); // expand
        await new Promise(r => setTimeout(r, 30));
      }

      // After rapid toggling, ensure card is expanded (aria-expanded="true")
      const isExpanded = await pluginCard.getAttribute('aria-expanded');
      if (isExpanded !== 'true') {
        await pluginCard.click();
      }

      // Verify group headers are still visible and correct
      const expandedItem = sidePanelPage.locator('[data-state="open"]').filter({ hasText: 'E2E Test' });
      const headers = expandedItem.locator('span.uppercase.tracking-wider');
      await expect(headers.first()).toBeVisible({ timeout: 5_000 });

      const headerCount = await headers.count();
      expect(headerCount).toBeGreaterThanOrEqual(2);

      // Verify known group names still render
      await expect(expandedItem.locator('span.uppercase.tracking-wider', { hasText: 'Basic' })).toBeVisible({
        timeout: 5_000,
      });
      await expect(expandedItem.locator('span.uppercase.tracking-wider', { hasText: 'Data' })).toBeVisible({
        timeout: 5_000,
      });

      // Assert zero pageerror events
      expect(pageErrors).toHaveLength(0);

      await sidePanelPage.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
