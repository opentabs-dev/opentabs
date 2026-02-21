/**
 * SDK version compatibility E2E tests.
 *
 * Verifies that the MCP server correctly handles plugins with different SDK
 * version states: compatible, incompatible (too-new), and missing (legacy).
 * Also verifies that /health exposes sdkVersion at both the server and
 * per-plugin level.
 *
 * All tests use dynamic ports and isolated config directories.
 */

import {
  test,
  expect,
  copyE2eTestPlugin,
  createMcpClient,
  readPluginToolNames,
  startMcpServer,
  cleanupTestConfigDir,
  writeTestConfig,
} from './fixtures.js';
import { waitForExtensionConnected, waitForLog, setupToolTest, callToolExpectSuccess } from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Helper: create a config directory for a custom plugin
// ---------------------------------------------------------------------------

const createConfigForPlugin = (pluginDir: string): string => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-sdk-'));
  fs.chmodSync(configDir, 0o700);

  const toolNames = readPluginToolNames();
  const tools: Record<string, boolean> = {};
  for (const t of toolNames) {
    tools[t] = true;
  }

  writeTestConfig(configDir, {
    localPlugins: [pluginDir],
    tools,
    secret: crypto.randomUUID(),
  });

  return configDir;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('SDK version compatibility', () => {
  test('plugin with matching SDK version loads and tools are callable', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // The default e2e-test plugin has sdkVersion: "0.0.16" which matches
    // the server's SDK version. Verify it loads and tools work.
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const tools = await mcpClient.listTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('e2e-test_echo');

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
      message: 'sdk-version-ok',
    });
    expect(output.message).toBe('sdk-version-ok');
  });

  test('plugin with too-new SDK version (99.0.0) fails to load with clear error', async () => {
    // Create a copy of the e2e-test plugin and set sdkVersion to 99.0.0
    const { pluginDir, tmpDir } = copyE2eTestPlugin();
    const toolsJsonPath = path.join(pluginDir, 'dist', 'tools.json');
    const manifest = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf-8')) as Record<string, unknown>;
    manifest.sdkVersion = '99.0.0';
    fs.writeFileSync(toolsJsonPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const configDir = createConfigForPlugin(pluginDir);
    const server = await startMcpServer(configDir, false);

    try {
      // The server should start but the plugin should fail to load
      const health = await server.waitForHealth(h => h.status === 'ok');
      expect(health.status).toBe('ok');

      // The plugin should NOT be in the loaded plugins (it failed at discovery)
      expect(health.plugins).toBe(0);

      // Server logs should contain the SDK version error
      const logsJoined = server.logs.join('\n');
      expect(logsJoined).toContain('SDK');
      expect(logsJoined).toContain('99.0.0');
      expect(logsJoined).toContain('Rebuild the plugin');

      // MCP client should see no e2e-test tools
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();
      try {
        const tools = await client.listTools();
        const e2eTools = tools.filter(t => t.name.startsWith('e2e-test_'));
        expect(e2eTools).toHaveLength(0);
      } finally {
        await client.close();
      }
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('/health endpoint includes sdkVersion at server and per-plugin level', async ({
    mcpServer,
    extensionContext: _extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const health = await mcpServer.health();
    expect(health).not.toBeNull();
    if (!health) throw new Error('health returned null');

    // Server-level sdkVersion
    expect(typeof health.sdkVersion).toBe('string');
    expect(health.sdkVersion).toMatch(/^\d+\.\d+\.\d+/);

    // Per-plugin sdkVersion
    expect(health.pluginDetails).toBeDefined();
    const e2ePlugin = health.pluginDetails?.find(p => p.name === 'e2e-test');
    expect(e2ePlugin).toBeDefined();
    expect(e2ePlugin?.sdkVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('plugin with missing sdkVersion (legacy format) loads with warning', async () => {
    // Create a copy of the e2e-test plugin and strip sdkVersion from tools.json
    const { pluginDir, tmpDir } = copyE2eTestPlugin();
    const toolsJsonPath = path.join(pluginDir, 'dist', 'tools.json');
    const manifest = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf-8')) as Record<string, unknown>;
    delete manifest.sdkVersion;
    fs.writeFileSync(toolsJsonPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const configDir = createConfigForPlugin(pluginDir);
    const server = await startMcpServer(configDir, false);

    try {
      // Wait for the server to complete discovery
      const health = await server.waitForHealth(h => h.status === 'ok');
      expect(health.status).toBe('ok');

      // The plugin should load despite missing sdkVersion
      expect(health.plugins).toBeGreaterThan(0);

      // sdkVersion for the plugin should be null in health response
      const pluginDetail = health.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(pluginDetail).toBeDefined();
      expect(pluginDetail?.sdkVersion).toBeNull();

      // Server logs should contain the warning about missing sdkVersion
      const logsJoined = server.logs.join('\n');
      expect(logsJoined).toContain('does not declare sdkVersion');

      // Tools should still be registered
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();
      try {
        const tools = await client.listTools();
        const e2eTools = tools.filter(t => t.name.startsWith('e2e-test_'));
        expect(e2eTools.length).toBeGreaterThan(0);
      } finally {
        await client.close();
      }
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
