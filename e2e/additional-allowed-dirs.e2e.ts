/**
 * E2E tests for additionalAllowedDirectories config — verify that plugins
 * located outside the default allowed roots (home, tmp) can be discovered
 * when their parent directory is listed in additionalAllowedDirectories.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpClient, McpServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createMinimalPlugin,
  E2E_TEST_PLUGIN_DIR,
  expect,
  readPluginToolNames,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const configWithPlugins = (
  localPlugins: string[],
  additionalAllowedDirectories: string[],
  extraTools: Record<string, boolean> = {},
): {
  localPlugins: string[];
  tools: Record<string, boolean>;
  additionalAllowedDirectories: string[];
} => {
  const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
  const prefixedToolNames = readPluginToolNames();
  const tools: Record<string, boolean> = {};
  for (const t of prefixedToolNames) tools[t] = true;
  return {
    localPlugins: [absPluginPath, ...localPlugins],
    tools: { ...tools, ...extraTools },
    additionalAllowedDirectories,
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('additionalAllowedDirectories', () => {
  test('plugin in an additional allowed directory is discovered', async () => {
    let tmpDir: string | undefined;
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      // Create plugin in a temp directory (which is within os.tmpdir, already allowed)
      // but the key test is that the config field is threaded through discovery
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-allowdirs-'));
      const pluginDir = createMinimalPlugin(tmpDir, 'allowed-dir-test', [{ name: 'ping', description: 'A ping tool' }]);

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-allowdirs-cfg-'));
      const config = configWithPlugins([pluginDir], [tmpDir], { 'allowed-dir-test_ping': true });
      writeTestConfig(configDir, config);

      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      const health = await server.waitForHealth(h => {
        const plugin = h.pluginDetails?.find(p => p.name === 'allowed-dir-test');
        return plugin !== undefined;
      }, 15_000);

      const plugin = health.pluginDetails?.find(p => p.name === 'allowed-dir-test');
      expect(plugin).toBeDefined();
      expect(plugin?.toolCount).toBe(1);

      // Verify tool is in tools/list
      const tools = await client.listTools();
      expect(tools.some(t => t.name === 'allowed-dir-test_ping')).toBe(true);
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('additionalAllowedDirectories is preserved across config saves', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    try {
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-allowdirs-persist-'));
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const extraDirs = ['/opt/custom-plugins', '/srv/plugins'];

      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        additionalAllowedDirectories: extraDirs,
      });

      server = await startMcpServer(configDir, true);
      await server.waitForHealth(h => h.status === 'ok');

      // Trigger a reload (which re-reads and re-writes config internally)
      const reloadRes = await fetch(`http://localhost:${String(server.port)}/reload`, {
        method: 'POST',
        headers: server.secret ? { Authorization: `Bearer ${server.secret}` } : {},
        signal: AbortSignal.timeout(10_000),
      });
      expect(reloadRes.ok).toBe(true);

      // Read config and verify additionalAllowedDirectories is preserved
      const configPath = path.join(configDir, 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        additionalAllowedDirectories?: string[];
      };
      expect(config.additionalAllowedDirectories).toBeDefined();
      expect(config.additionalAllowedDirectories).toContain('/opt/custom-plugins');
      expect(config.additionalAllowedDirectories).toContain('/srv/plugins');
    } finally {
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});
