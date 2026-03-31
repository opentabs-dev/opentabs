/**
 * Config watcher E2E tests — verify that modifying config.json automatically
 * triggers plugin discovery without manual hot reload or POST /reload.
 *
 * Key scenarios:
 *   1. Empty config → add plugin path → tools auto-appear in tools/list
 *   2. Config with plugin → remove plugin path → tools auto-disappear
 *   3. Config with plugin → add second plugin → both plugins' tools present
 *   4. Config watcher survives a hot reload and still detects subsequent changes
 *
 * All tests use dynamic ports and isolated config directories. No test calls
 * POST /reload or triggerHotReload — the config file watcher must detect
 * changes automatically.
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
import { BROWSER_TOOL_NAMES, waitFor, waitForLog, waitForToolList } from './helpers.js';

// ---------------------------------------------------------------------------
// Config watcher — auto-discovery on config.json change
// ---------------------------------------------------------------------------

test.describe('Config watcher — auto-discovery', () => {
  test('adding a plugin path to config.json auto-discovers plugin tools', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      // Start with empty config (no plugins)
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cw-add-'));
      writeTestConfig(configDir, { localPlugins: [], tools: {} });

      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Wait for config watcher to be set up
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Initially only browser tools and platform tools should be present
      const toolsBefore = await client.listTools();
      const builtInToolSet = new Set([
        ...BROWSER_TOOL_NAMES,
        'plugin_inspect',
        'plugin_mark_reviewed',
        'plugin_get_workflow',
      ]);
      const pluginToolsBefore = toolsBefore.filter(t => !builtInToolSet.has(t.name));
      expect(pluginToolsBefore.length).toBe(0);

      for (const bt of BROWSER_TOOL_NAMES) {
        expect(toolsBefore.map(t => t.name)).toContain(bt);
      }

      // Write new config.json with the e2e-test plugin path.
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      // Poll until plugin tools appear — the config watcher should auto-detect
      // the change without any manual reload
      const toolsAfter = await waitForToolList(
        client,
        list => list.some(t => t.name.startsWith('e2e-test_')),
        15_000,
        300,
        'e2e-test plugin tools to appear after config.json change',
      );

      // Verify all e2e-test plugin tools are present
      const e2eTools = toolsAfter.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eTools.length).toBe(prefixedToolNames.length);

      // Browser tools should still be present
      for (const bt of BROWSER_TOOL_NAMES) {
        expect(toolsAfter.map(t => t.name)).toContain(bt);
      }
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('removing a plugin path from config.json auto-removes plugin tools', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      // Start with the e2e-test plugin registered
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cw-remove-'));
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Wait for config watcher to be set up
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Verify plugin tools are present initially
      const toolsBefore = await client.listTools();
      const e2eToolsBefore = toolsBefore.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eToolsBefore.length).toBe(prefixedToolNames.length);

      // Remove the plugin from config.json
      writeTestConfig(configDir, { localPlugins: [], tools: {} });

      // Poll until plugin tools disappear
      const toolsAfter = await waitForToolList(
        client,
        list => !list.some(t => t.name.startsWith('e2e-test_')),
        15_000,
        300,
        'e2e-test plugin tools to disappear after config.json change',
      );

      // Only browser tools should remain
      for (const bt of BROWSER_TOOL_NAMES) {
        expect(toolsAfter.map(t => t.name)).toContain(bt);
      }
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('adding a second plugin via config.json auto-discovers both plugins', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    let tmpDir: string | undefined;
    try {
      // Start with the e2e-test plugin registered
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cw-multi-'));
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);

      // Create a minimal second plugin
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cw-extra-'));
      const newPluginDir = createMinimalPlugin(tmpDir, 'cw-extra', [
        { name: 'ping', description: 'Ping' },
        { name: 'pong', description: 'Pong' },
      ]);

      await client.initialize();

      // Wait for config watcher to be set up
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Verify only e2e-test tools are present initially
      const toolsBefore = await client.listTools();
      expect(toolsBefore.some(t => t.name.startsWith('e2e-test_'))).toBe(true);
      expect(toolsBefore.some(t => t.name.startsWith('cw-extra_'))).toBe(false);

      // Add the second plugin to config.json (keeping the first)
      const updatedTools: Record<string, boolean> = { ...tools };
      updatedTools['cw-extra_ping'] = true;
      updatedTools['cw-extra_pong'] = true;
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath, newPluginDir],
        tools: updatedTools,
      });

      // Poll until the new plugin's tools appear
      const toolsAfter = await waitForToolList(
        client,
        list => list.some(t => t.name === 'cw-extra_ping') && list.some(t => t.name === 'cw-extra_pong'),
        15_000,
        300,
        'cw-extra plugin tools to appear after config.json change',
      );

      // Both plugins' tools should be present
      const e2eTools = toolsAfter.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eTools.length).toBe(prefixedToolNames.length);
      expect(toolsAfter.map(t => t.name)).toContain('cw-extra_ping');
      expect(toolsAfter.map(t => t.name)).toContain('cw-extra_pong');
    } finally {
      await client?.close();
      await server?.kill();
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('10 rapid config writes converge to last write within 5s', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    let tmpDir: string | undefined;
    try {
      // Create 3 minimal plugins with known tool counts
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cw-rapid-'));
      const alphaDir = createMinimalPlugin(tmpDir, 'alpha', [
        { name: 'a1', description: 'Alpha tool 1' },
        { name: 'a2', description: 'Alpha tool 2' },
      ]);
      const betaDir = createMinimalPlugin(tmpDir, 'beta', [{ name: 'b1', description: 'Beta tool 1' }]);
      const gammaDir = createMinimalPlugin(tmpDir, 'gamma', [
        { name: 'g1', description: 'Gamma tool 1' },
        { name: 'g2', description: 'Gamma tool 2' },
        { name: 'g3', description: 'Gamma tool 3' },
      ]);

      // Start with empty config (no plugins)
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cw-rapid-cfg-'));
      writeTestConfig(configDir, { localPlugins: [] });

      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Wait for config watcher to be set up
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // 10 rapid config writes at ~200ms intervals with varying plugin combinations.
      // The last write (index 9) configures alpha, beta, gamma.
      const configs: string[][] = [
        [alphaDir], // 0: alpha only
        [betaDir], // 1: beta only
        [alphaDir, betaDir], // 2: alpha + beta
        [], // 3: empty
        [gammaDir], // 4: gamma only
        [alphaDir, gammaDir], // 5: alpha + gamma
        [betaDir, gammaDir], // 6: beta + gamma
        [alphaDir], // 7: alpha only
        [betaDir, gammaDir], // 8: beta + gamma
        [alphaDir, betaDir, gammaDir], // 9: all three (final)
      ];

      for (let i = 0; i < configs.length; i++) {
        const plugins = configs[i] ?? [];
        writeTestConfig(configDir, { localPlugins: plugins });
        if (i < configs.length - 1) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      // The expected final tools from alpha, beta, gamma
      const expectedTools = ['alpha_a1', 'alpha_a2', 'beta_b1', 'gamma_g1', 'gamma_g2', 'gamma_g3'];
      const expectedToolSet = new Set(expectedTools);

      // Wait until tools/list converges to exactly the last-written config within 5s
      const builtInToolSet = new Set([
        ...BROWSER_TOOL_NAMES,
        'plugin_inspect',
        'plugin_mark_reviewed',
        'plugin_get_workflow',
      ]);

      const toolsAfter = await waitForToolList(
        client,
        list => {
          const pluginTools = list.filter(t => !builtInToolSet.has(t.name));
          if (pluginTools.length !== expectedTools.length) return false;
          return pluginTools.every(t => expectedToolSet.has(t.name));
        },
        5_000,
        300,
        'tools/list to converge to alpha + beta + gamma (6 tools)',
      );

      // Verify exact tool set — no duplicates, no tools from intermediate configs
      const pluginTools = toolsAfter.filter(t => !builtInToolSet.has(t.name));
      expect(pluginTools.length).toBe(expectedTools.length);
      const actualToolNames = new Set(pluginTools.map(t => t.name));
      for (const expected of expectedTools) {
        expect(actualToolNames.has(expected)).toBe(true);
      }
      // No duplicate tool names
      expect(pluginTools.length).toBe(actualToolNames.size);
    } finally {
      await client?.close();
      await server?.kill();
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('config watcher still works after hot reload', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      // Start with empty config
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cw-after-hr-'));
      writeTestConfig(configDir, { localPlugins: [], tools: {} });

      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Wait for config watcher to be set up
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Trigger a hot reload (this restarts all file watchers including config watcher).
      // Capture both baseline counts before triggering — the config watcher may restart
      // (emitting 'Config watcher: Watching') before 'Hot reload complete' is logged, so
      // both counts must be snapshotted before triggerHotReload() to avoid missing new lines.
      const s = server;
      const hotReloadCountBefore = s.logs.filter(l => l.includes('Hot reload complete')).length;
      const watcherCountBefore = s.logs.filter(l => l.includes('Config watcher: Watching')).length;
      s.triggerHotReload();
      await waitFor(
        () => s.logs.filter(l => l.includes('Hot reload complete')).length > hotReloadCountBefore,
        20_000,
        200,
        'Hot reload complete',
      );

      // Verify config watcher was restarted after hot reload
      await waitFor(
        () => s.logs.filter(l => l.includes('Config watcher: Watching')).length > watcherCountBefore,
        10_000,
        200,
        'Config watcher: Watching',
      );

      // Now write a config.json change — the restarted config watcher should detect it
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      // Poll until plugin tools appear via the config watcher (not hot reload)
      const toolsAfter = await waitForToolList(
        client,
        list => list.some(t => t.name.startsWith('e2e-test_')),
        15_000,
        300,
        'e2e-test plugin tools to appear after config.json change (post-hot-reload)',
      );

      const e2eTools = toolsAfter.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eTools.length).toBe(prefixedToolNames.length);
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});
