/**
 * E2E tests for the SVG icon rendering pipeline: MCP server discovery →
 * health endpoint → extension sync → side panel PluginIcon component.
 *
 * Verifies that custom SVG icons are loaded by the MCP server, included
 * in health/config responses, and rendered correctly in the side panel
 * with proper active/inactive treatment and letter-avatar fallback.
 */

import {
  test,
  expect,
  startMcpServer,
  startTestServer,
  cleanupTestConfigDir,
  writeTestConfig,
  readPluginToolNames,
  launchExtensionContext,
  createMinimalPlugin,
  E2E_TEST_PLUGIN_DIR,
} from './fixtures.js';
import { waitForExtensionConnected, waitForLog, openSidePanel, setupAdapterSymlink } from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Health endpoint — iconSvg field
// ---------------------------------------------------------------------------

test.describe('Icon pipeline — health endpoint', () => {
  test('/health includes iconSvg for the e2e-test plugin', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-icon-health-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    try {
      const health = await server.waitForHealth(h => h.status === 'ok');

      const e2ePlugin = health.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(e2ePlugin).toBeDefined();
      expect(typeof e2ePlugin?.iconSvg).toBe('string');
      expect((e2ePlugin?.iconSvg as string).length).toBeGreaterThan(0);
      expect(e2ePlugin?.iconSvg as string).toContain('<svg');
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Side panel — custom SVG icon rendering
// ---------------------------------------------------------------------------

test.describe('Icon pipeline — side panel rendering', () => {
  test('plugin with custom icon renders SVG, not letter avatar', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-icon-svg-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      const sidePanelPage = await openSidePanel(context);

      // Wait for plugin card to appear
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // The PluginIcon renders custom SVG inside a div.border-border container
      // via dangerouslySetInnerHTML. Verify an <svg> element exists.
      const iconSvg = sidePanelPage.locator('.border-border svg').first();
      await expect(iconSvg).toBeVisible({ timeout: 10_000 });

      await sidePanelPage.close();
    } finally {
      await context.close();
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });

  test('inactive icon differs from active icon when tab state changes', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-icon-inactive-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      const sidePanelPage = await openSidePanel(context);
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });

      // 1. With no matching tab open (closed state), capture the inactive icon's SVG content
      const iconContainer = sidePanelPage.locator('.border-border').first();
      const inactiveHtml = await iconContainer.innerHTML();
      expect(inactiveHtml).toContain('<svg');

      // No status dot should be visible in closed state, and hint text is shown
      await expect(sidePanelPage.locator('.bg-success').first()).toBeHidden({ timeout: 5_000 });
      await expect(sidePanelPage.getByText('Open localhost')).toBeVisible({ timeout: 5_000 });

      // 2. Open a matching tab to transition to 'ready' state
      const appTab = await context.newPage();
      await appTab.goto(testServer.url, { waitUntil: 'load' });

      // Poll /health with auth headers to get pluginDetails
      const authHeaders: Record<string, string> = {};
      if (server.secret) authHeaders['Authorization'] = `Bearer ${server.secret}`;

      await expect
        .poll(
          async () => {
            const res = await fetch(`http://localhost:${server.port}/health`, { headers: authHeaders });
            const body = (await res.json()) as {
              pluginDetails?: Array<{ name: string; tabState: string }>;
            };
            return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
          },
          { timeout: 30_000, message: 'Server tab state for e2e-test did not become ready' },
        )
        .toBe('ready');

      // Reload side panel to pick up the ready state
      await sidePanelPage.reload({ waitUntil: 'load' });
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 15_000 });

      // 3. Capture the active icon's SVG content
      const activeIconContainer = sidePanelPage.locator('.border-border').first();
      const activeHtml = await activeIconContainer.innerHTML();
      expect(activeHtml).toContain('<svg');

      // Ready state should show green status dot and no hint text
      await expect(sidePanelPage.locator('.bg-success').first()).toBeVisible({ timeout: 5_000 });
      await expect(sidePanelPage.getByText('Open localhost')).toBeHidden({ timeout: 5_000 });

      // The active and inactive SVG content should differ (different fill values)
      expect(activeHtml).not.toBe(inactiveHtml);

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

  test('plugin without icons renders letter avatar', async () => {
    // Create a minimal plugin with no icon files
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-icon-avatar-'));
    const noIconPluginDir = createMinimalPlugin(tmpDir, 'no-icon-test', [
      { name: 'ping', description: 'Simple ping tool' },
    ]);

    const absE2ePluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }
    // Also enable the no-icon plugin's tool
    tools['no-icon-test_ping'] = true;

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-icon-avatar-cfg-'));
    writeTestConfig(configDir, {
      localPlugins: [absE2ePluginPath, noIconPluginDir],
      tools,
    });

    const server = await startMcpServer(configDir, true);
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received', 15_000);

      const sidePanelPage = await openSidePanel(context);

      // Wait for both plugin cards to appear
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({ timeout: 30_000 });
      await expect(sidePanelPage.getByText('Test no-icon-test')).toBeVisible({ timeout: 15_000 });

      // The no-icon plugin should render a letter avatar (span with text, no svg).
      // "Test no-icon-test" → first letter "T"
      //
      // Find the plugin card for no-icon-test, then check its icon area.
      const noIconCard = sidePanelPage.locator('button[aria-expanded]', { hasText: 'Test no-icon-test' });
      await expect(noIconCard).toBeVisible({ timeout: 10_000 });

      // The letter avatar span is inside a .border-border div (the PluginIcon container)
      const avatarContainer = noIconCard.locator('.border-border').first();
      const letterSpan = avatarContainer.locator('span');
      await expect(letterSpan).toBeVisible({ timeout: 5_000 });
      await expect(letterSpan).toHaveText('T');

      // The avatar container should NOT contain an svg element
      const svgCount = await avatarContainer.locator('svg').count();
      expect(svgCount).toBe(0);

      await sidePanelPage.close();
    } finally {
      await context.close();
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
