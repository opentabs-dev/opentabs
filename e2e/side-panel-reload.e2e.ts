/**
 * Side panel auto-refresh E2E tests — verify that the side panel updates
 * automatically when POST /reload triggers plugin rediscovery.
 *
 * These tests exercise the full POST /reload pipeline:
 *   POST /reload → performConfigReload → reloadCore → sendSyncFull →
 *   extension background processes sync.full → chrome.storage updated →
 *   offscreen broadcasts ws:message → side panel detects change and re-renders
 *
 * Unlike the config-watcher tests in side-panel-live-update.e2e.ts (which rely
 * on the dev-mode file watcher to detect config.json changes), these tests
 * explicitly trigger rediscovery via the HTTP endpoint — simulating what
 * `opentabs-plugin build` does after compiling a plugin.
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

/** POST /reload with Bearer auth. Reads secret from auth.json in the extension directory. */
const postReload = async (port: number, configDir: string): Promise<Response> => {
  const authPath = path.join(configDir, 'extension', 'auth.json');
  const authData = JSON.parse(fs.readFileSync(authPath, 'utf-8')) as { secret?: string };
  const secret = authData.secret ?? '';
  return fetch(`http://localhost:${String(port)}/reload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });
};

// ---------------------------------------------------------------------------
// Side panel auto-refresh via POST /reload
// ---------------------------------------------------------------------------

test.describe('Side panel auto-refresh — POST /reload', () => {
  test('side panel reflects plugin removal after POST /reload', async () => {
    // Start with the e2e-test plugin registered (same pattern as live-update tests)
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-reload-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Open side panel and verify plugin is visible
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.locator('text=E2E Test')).toBeVisible({ timeout: 30_000 });

      // Remove the plugin from config
      writeTestConfig(configDir, { localPlugins: [], tools: {} });

      // Wait for the config watcher to process the change before calling POST /reload.
      // This avoids a race between the two reload paths (config watcher vs HTTP endpoint).
      await waitForLog(server, 'Config reload complete: 0 plugin', 10_000);

      // POST /reload confirms the rediscovery and triggers another sync.full
      const reloadRes = await postReload(server.port, configDir);
      expect(reloadRes.ok).toBe(true);
      const body = (await reloadRes.json()) as { ok: boolean; plugins: number };
      expect(body.plugins).toBe(0);

      // Verify the plugin is gone and browser tools section remains visible
      await expect(sidePanelPage.locator('text=E2E Test')).toBeHidden({ timeout: 30_000 });
      await expect(sidePanelPage.locator('text=Browser')).toBeVisible({ timeout: 5_000 });

      await sidePanelPage.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('side panel reflects plugin addition after POST /reload', async () => {
    // Start with empty config (no plugins)
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-reload-add-'));
    writeTestConfig(configDir, { localPlugins: [], tools: {} });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Open side panel and verify browser tools section is visible (no plugins installed)
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.locator('text=Browser')).toBeVisible({ timeout: 10_000 });

      // Add plugin to config
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const tools = buildToolsMap();
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      // Wait for the config watcher to process the change before calling POST /reload
      await waitForLog(server, 'Config reload complete: 1 plugin', 10_000);

      // POST /reload confirms the rediscovery and triggers another sync.full
      const reloadRes = await postReload(server.port, configDir);
      expect(reloadRes.ok).toBe(true);
      const body = (await reloadRes.json()) as { ok: boolean; plugins: number };
      expect(body.plugins).toBeGreaterThan(0);

      // Verify the side panel shows the plugin (from the sync.full pipeline)
      await expect(sidePanelPage.locator('text=E2E Test')).toBeVisible({ timeout: 30_000 });

      await sidePanelPage.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('side panel preserves plugin state after POST /reload without config change', async () => {
    // Start with the e2e-test plugin registered
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-reload-noop-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Open side panel and verify plugin is visible
      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.locator('text=E2E Test')).toBeVisible({ timeout: 30_000 });

      // Trigger POST /reload WITHOUT changing config — plugin should remain
      const reloadRes = await postReload(server.port, configDir);
      expect(reloadRes.ok).toBe(true);
      const body = (await reloadRes.json()) as { ok: boolean; plugins: number };
      expect(body.ok).toBe(true);
      expect(body.plugins).toBeGreaterThan(0);

      // Verify the side panel still shows the plugin after reload
      await expect(sidePanelPage.locator('text=E2E Test')).toBeVisible({ timeout: 5_000 });

      await sidePanelPage.close();
    } finally {
      await context.close().catch(() => {});
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Stress tests — rapid POST /reload spam
// ---------------------------------------------------------------------------

test.describe('stress', () => {
  test('rapid POST /reload spam settles to correct state without duplicate cards', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const tools = buildToolsMap();

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-reload-stress-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    const pageErrors: Error[] = [];

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Open side panel and verify plugin is visible
      const sidePanelPage = await openSidePanel(context);
      sidePanelPage.on('pageerror', err => pageErrors.push(err));
      await expect(sidePanelPage.locator('text=E2E Test')).toBeVisible({ timeout: 30_000 });

      // Fire 3 POST /reload requests sequentially with 200ms between each
      for (let i = 0; i < 3; i++) {
        const res = await postReload(server.port, configDir);
        expect(res.ok).toBe(true);
        await new Promise(r => setTimeout(r, 200));
      }

      // Wait for the side panel to settle after rapid reloads.
      // Each POST /reload triggers a full sync.full pipeline through the extension,
      // which can temporarily clear and re-populate the side panel state.
      // Use waitForLog to confirm the last reload was fully processed.
      await waitForLog(server, 'Config reload complete', 15_000);

      // Verify the plugin card is still visible after rapid reloads.
      await expect(sidePanelPage.locator('text=E2E Test')).toBeVisible({ timeout: 30_000 });

      // Verify no duplicate plugin cards. Count the number of accordion triggers
      // whose text includes "E2E Test" (each plugin renders one trigger button).
      const pluginTriggers = sidePanelPage.locator('button[data-radix-collection-item]', { hasText: 'E2E Test' });
      await expect(pluginTriggers).toHaveCount(1, { timeout: 5_000 });

      // Verify zero page errors
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

// ---------------------------------------------------------------------------
// Side panel recovery after dev proxy hot reload (process restart)
// ---------------------------------------------------------------------------

test.describe
  .serial('Side panel recovery after dev proxy hot reload', () => {
    test('side panel shows plugin list before and after dev proxy hot reload', async () => {
      test.slow();

      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const tools = buildToolsMap();

      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sp-hot-reload-'));
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      const server = await startMcpServer(configDir, true);
      const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
      setupAdapterSymlink(configDir, extensionDir);

      try {
        await waitForExtensionConnected(server);

        // Open side panel and verify plugin is visible before the hot reload
        const sidePanelPage = await openSidePanel(context);
        await expect(sidePanelPage.locator('text=E2E Test')).toBeVisible({ timeout: 30_000 });

        // Trigger a dev proxy hot reload (SIGUSR1 → worker kill + restart).
        // This is a full process-level restart, unlike POST /reload which is
        // an in-process config rediscovery. Clear logs first so we detect the
        // single 'Hot reload complete' from the new worker unambiguously.
        server.logs.length = 0;
        server.triggerHotReload();

        // Wait for the new worker to be fully up and the extension to reconnect.
        // The pipeline is: worker restart → new sync.full to extension →
        // chrome.storage update → offscreen broadcasts ws:message →
        // side panel App.tsx detects sync.full and re-renders.
        await waitForLog(server, 'Hot reload complete', 20_000);
        await waitForExtensionConnected(server, 30_000);

        // After the hot reload pipeline completes, the side panel should still
        // show the e2e-test plugin. Use a generous timeout to allow for the
        // sync.full → chrome.storage → side panel re-render pipeline.
        await expect(sidePanelPage.locator('text=E2E Test')).toBeVisible({ timeout: 30_000 });

        await sidePanelPage.close();
      } finally {
        await context.close().catch(() => {});
        await server.kill();
        fs.rmSync(cleanupDir, { recursive: true, force: true });
        cleanupTestConfigDir(configDir);
      }
    });
  });
