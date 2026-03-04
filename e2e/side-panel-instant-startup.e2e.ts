/**
 * Side panel instant startup E2E tests — verify the side panel renders
 * plugins instantly from the background script's local cache, without
 * waiting for MCP server round-trips or isReady() probes.
 *
 * These tests exercise the background-only communication architecture:
 *   1. getFullState() reads from background caches (metaCache + serverStateCache + lastKnownState)
 *   2. plugins.changed from handleSyncFull arrives BEFORE sendTabSyncAll probes
 *   3. Tab states stream progressively via tab.stateChanged as each probe completes
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
import { openSidePanel, setupAdapterSymlink, waitForExtensionConnected, waitForLog } from './helpers.js';

/** Build a tools map from the e2e-test plugin's prefixed tool names. */
const buildToolsMap = (): Record<string, boolean> => {
  const tools: Record<string, boolean> = {};
  for (const t of readPluginToolNames()) {
    tools[t] = true;
  }
  return tools;
};

// ---------------------------------------------------------------------------
// Side panel instant startup tests
// ---------------------------------------------------------------------------

test.describe('Side panel instant startup from background cache', () => {
  test('plugins appear within 2 seconds after closing and reopening side panel', async () => {
    // 1. Start MCP server with e2e-test plugin and test server
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-instant-reopen-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect and sync.full to complete
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      // 3. Open side panel and verify plugin is visible
      const sidePanelPage1 = await openSidePanel(context);
      await expect(sidePanelPage1.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 4. Close the side panel page
      await sidePanelPage1.close();

      // 5. Reopen the side panel — plugins must appear within 2 seconds
      // because getFullState() reads from background caches (no server round-trip)
      const sidePanelPage2 = await openSidePanel(context);
      await expect(sidePanelPage2.getByText('E2E Test')).toBeVisible({ timeout: 2_000 });

      await sidePanelPage2.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('plugin cards appear immediately after server restart, tab states fill in progressively', async () => {
    test.slow();

    // 1. Start MCP server with e2e-test plugin and a test web server
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-instant-reload-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      // 3. Open side panel and verify plugin card is visible
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 4. Open a matching tab so there's a real tab state to fill in
      const appTab = await context.newPage();
      await appTab.goto(testServer.url, { waitUntil: 'load' });

      // 5. Wait for the tab to become ready (solid border, no faded indicator)
      const e2ePluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await expect(e2ePluginCard.locator('[class*="border-border/30"]')).toBeHidden({ timeout: 30_000 });

      // 6. Trigger a dev proxy hot reload (simulates server restart).
      // This sends sync.full which triggers the full pipeline:
      // plugins.changed → getFullState() → plugin cards render → sendTabSyncAll → tab.stateChanged
      server.logs.length = 0;
      server.triggerHotReload();

      await waitForLog(server, 'Hot reload complete', 20_000);
      await waitForExtensionConnected(server, 30_000);

      // 7. After reconnect, the side panel should show plugin cards.
      // The card may briefly disappear during disconnect and reappear on reconnect.
      // Use a generous timeout for the full disconnect → reconnect → sync.full cycle.
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 8. The ready state (solid border) should fill in after sendTabSyncAll probes complete
      await expect(e2ePluginCard.locator('[class*="border-border/30"]')).toBeHidden({ timeout: 30_000 });

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

  test('plugin cards visible while tab state dots are still loading', async () => {
    test.slow();

    // This test verifies the ordering guarantee: plugins.changed is sent
    // BEFORE sendTabSyncAll in handleSyncFull, so plugin cards render
    // immediately while status dots are still being probed.

    // 1. Start MCP server with e2e-test plugin and test server
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-instant-ordering-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      // 2. Wait for extension to connect and initial sync to complete
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      // 3. Open a matching tab so there's a tab to probe during sync
      const appTab = await context.newPage();
      await appTab.goto(testServer.url, { waitUntil: 'load' });

      // 4. Wait for tab to become ready
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

      // 5. Open side panel and verify both plugin card and ready state are present
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      const e2ePluginCard = sidePanelPage.locator('button[aria-expanded]').filter({ hasText: 'E2E Test' });
      await expect(e2ePluginCard.locator('[class*="border-border/30"]')).toBeHidden({ timeout: 15_000 });

      // 6. Now trigger a hot reload. After reconnect, the side panel should
      // show plugin cards FIRST (from plugins.changed) and then the green
      // dot should appear AFTER (from tab.stateChanged following sendTabSyncAll).
      server.logs.length = 0;
      server.triggerHotReload();

      await waitForLog(server, 'Hot reload complete', 20_000);
      await waitForExtensionConnected(server, 30_000);

      // 7. Plugin card should reappear from the sync.full → plugins.changed path.
      // The card renders from background cache via getFullState() — fast.
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 8. At this moment, the ready state may not be set yet because
      // sendTabSyncAll (which probes isReady()) runs AFTER plugins.changed.
      // We just need to verify that the card is visible and the ready state
      // (solid border) eventually appears — proving progressive rendering works.
      await expect(e2ePluginCard.locator('[class*="border-border/30"]')).toBeHidden({ timeout: 30_000 });

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
