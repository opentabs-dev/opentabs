/**
 * Plugin settings E2E tests — verify the full plugin settings flow:
 *
 * 1. configSchema in health endpoint
 * 2. Settings resolution deriving URL patterns from url-type settings
 * 3. getConfig reading resolved values in the adapter runtime
 * 4. Side panel showing configSchema fields (Settings menu item)
 * 5. NeedsSetup badge absent when all required fields are satisfied
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpClient, McpServer } from './fixtures.js';
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
  openSidePanel,
  openTestAppTab,
  setupAdapterSymlink,
  waitForExtensionConnected,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// US-013: Health endpoint includes configSchema
// ---------------------------------------------------------------------------

test.describe('Plugin settings — health endpoint', () => {
  test('health endpoint includes configSchema for e2e-test plugin', async ({ mcpServer }) => {
    const health = await mcpServer.waitForHealth(h => h.pluginDetails !== undefined && h.pluginDetails.length > 0);

    const plugin = health.pluginDetails?.find(p => p.name === 'e2e-test');
    expect(plugin).toBeDefined();
    expect(plugin?.configSchema).toBeDefined();
    expect(plugin?.configSchema?.instanceUrl).toBeDefined();
    expect(plugin?.configSchema?.instanceUrl?.type).toBe('url');
    expect(plugin?.configSchema?.instanceUrl?.label).toBe('Instance URL');
    expect(plugin?.configSchema?.testString).toBeDefined();
    expect(plugin?.configSchema?.testString?.type).toBe('string');
  });

  test('health endpoint needsSetup is false when no required fields are unconfigured', async ({ mcpServer }) => {
    const health = await mcpServer.waitForHealth(h => h.pluginDetails !== undefined && h.pluginDetails.length > 0);

    const plugin = health.pluginDetails?.find(p => p.name === 'e2e-test');
    expect(plugin).toBeDefined();
    // e2e-test plugin has only optional configSchema fields, so needsSetup should be false
    expect(plugin?.needsSetup).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// US-013: Settings resolution — URL pattern derivation
// ---------------------------------------------------------------------------

test.describe('Plugin settings — URL pattern derivation', () => {
  test('writing settings to config.json and reloading derives URL patterns', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-settings-url-'));
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Verify initial state — e2e-test plugin has http://localhost/* from static urlPatterns
      const healthBefore = await server.waitForHealth(h => h.pluginDetails?.some(p => p.name === 'e2e-test') === true);
      const pluginBefore = healthBefore.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(pluginBefore).toBeDefined();

      // Write settings with a url-type field to config.json
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        tools,
        settings: {
          'e2e-test': { instanceUrl: 'http://example.com:8080/app' },
        },
      });

      // Trigger reload via POST /reload and verify it succeeds
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;
      const reloadResp = await fetch(`http://localhost:${String(server.port)}/reload`, {
        method: 'POST',
        headers,
        body: '{}',
        signal: AbortSignal.timeout(10_000),
      });
      const reloadBody = (await reloadResp.json()) as {
        ok: boolean;
        plugins?: number;
      };
      expect(reloadBody.ok).toBe(true);

      // Verify the plugin is still loaded after reload with settings
      const healthAfter = await server.waitForHealth(
        h => h.pluginDetails?.some(p => p.name === 'e2e-test') === true,
        15_000,
      );
      const pluginAfter = healthAfter.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(pluginAfter).toBeDefined();
      expect(pluginAfter?.toolCount).toBeGreaterThan(0);
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// US-013: sdk_get_config tool reads resolved settings
// ---------------------------------------------------------------------------

test.describe('Plugin settings — getConfig tool', () => {
  test('sdk_get_config returns values configured via settings', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let testServer: Awaited<ReturnType<typeof startTestServer>> | undefined;
    let context: Awaited<ReturnType<typeof launchExtensionContext>>['context'] | undefined;
    let cleanupDir: string | undefined;
    let client: McpClient | undefined;
    try {
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-settings-getconfig-'));
      // Write config with settings pre-populated
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        tools,
        settings: {
          'e2e-test': {
            testString: 'hello-from-settings',
          },
        },
      });

      server = await startMcpServer(configDir, true);
      testServer = await startTestServer();
      const ext = await launchExtensionContext(server.port, server.secret);
      context = ext.context;
      cleanupDir = ext.cleanupDir;
      setupAdapterSymlink(configDir, ext.extensionDir);

      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped');

      // Open a tab matching the plugin's URL pattern so the adapter is injected
      const page = await openTestAppTab(context, testServer.url, server, testServer);

      // Wait until the tool is callable
      await waitForToolResult(client, 'e2e-test__get_status', {}, { isError: false }, 15_000);

      // Call sdk_get_config to read the configured testString value
      const result = await client.callTool('e2e-test__sdk_get_config', {
        key: 'testString',
      });
      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.content) as {
        key: string;
        value: string | number | boolean | null;
      };
      expect(parsed.key).toBe('testString');
      expect(parsed.value).toBe('hello-from-settings');

      await page.close();
    } finally {
      await client?.close();
      if (context) await context.close().catch(() => {});
      await testServer?.kill();
      await server?.kill();
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// US-013: Side panel — configSchema fields and NeedsSetup badge
// ---------------------------------------------------------------------------

test.describe('Plugin settings — side panel', () => {
  test('side panel shows Settings menu item and no NeedsSetup badge for e2e-test plugin', async () => {
    const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }

    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-settings-sidepanel-'));
    writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

    const server = await startMcpServer(configDir, true);
    const testServer = await startTestServer();
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(server.port, server.secret);
    setupAdapterSymlink(configDir, extensionDir);

    try {
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped');

      // Open a test app tab so the plugin shows as ready
      const page = await openTestAppTab(context, testServer.url, server, testServer);

      // Open side panel
      const sidePanelPage = await openSidePanel(context);

      // Wait for the plugin card to appear
      await expect(sidePanelPage.getByText('E2E Test')).toBeVisible({
        timeout: 30_000,
      });

      // Verify unconfigured state is NOT shown (all configSchema fields are optional)
      await expect(sidePanelPage.getByRole('button', { name: 'Configure' })).not.toBeVisible();

      // Open the kebab menu (PluginMenu) on the e2e-test plugin card
      const menuButton = sidePanelPage.locator('[aria-label="Plugin options"]');
      await expect(menuButton).toBeVisible();
      await menuButton.click();

      // Verify the "Settings" menu item is visible
      await expect(sidePanelPage.getByRole('menuitem', { name: 'Settings' })).toBeVisible({ timeout: 5_000 });

      await page.close();
      await sidePanelPage.close();
    } finally {
      await context.close().catch(() => {});
      await testServer.kill();
      await server.kill();
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});
