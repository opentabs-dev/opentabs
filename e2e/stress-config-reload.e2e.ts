/**
 * Stress tests for config reload resilience — races, rapid writes,
 * hot reload spam, and corruption recovery.
 *
 * Validates that the MCP server handles concurrent and rapid configuration
 * changes gracefully: no duplicate plugins, no tool list corruption, and
 * correct final state after all events settle.
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
  readPluginToolNames,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import { BROWSER_TOOL_NAMES, waitForLog, waitForToolList } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build auth headers for a given secret */
const authHeaders = (secret: string | undefined): Record<string, string> => {
  const h: Record<string, string> = {};
  if (secret) h.Authorization = `Bearer ${secret}`;
  return h;
};

/** POST /reload with given headers and return the response */
const postReload = (port: number, headers: Record<string, string>, timeoutMs = 30_000): Promise<Response> =>
  fetch(`http://localhost:${port}/reload`, { method: 'POST', headers, signal: AbortSignal.timeout(timeoutMs) });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Stress: config watcher + POST /reload simultaneous race', () => {
  test('writing config AND POST /reload simultaneously produces no duplicate tools', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      // Start with empty config (no plugins)
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-stress-race-'));
      writeTestConfig(configDir, { localPlugins: [] });

      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Wait for config watcher to be ready
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Verify no plugin tools initially
      const toolsBefore = await client.listTools();
      const pluginToolsBefore = toolsBefore.filter(t => t.name.startsWith('e2e-test_'));
      expect(pluginToolsBefore.length).toBe(0);

      // Simultaneously: write config adding the e2e-test plugin AND POST /reload
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();

      const headers = authHeaders(server.secret);

      const configDirRef = configDir;
      await Promise.all([
        // Write config adding the plugin (triggers file watcher)
        Promise.resolve().then(() => {
          writeTestConfig(configDirRef, { localPlugins: [absPluginPath] });
        }),
        // POST /reload simultaneously
        postReload(server.port, headers),
      ]);

      // Wait for both triggers to settle — the server should coalesce or sequence
      // them, producing a consistent final state
      await new Promise(r => setTimeout(r, 2_000));

      // Poll until e2e-test tools appear
      const toolsAfter = await waitForToolList(
        client,
        list => list.some(t => t.name.startsWith('e2e-test_')),
        15_000,
        300,
        'e2e-test plugin tools to appear after simultaneous config write + POST /reload',
      );

      // Verify no duplicate tools — each e2e-test tool should appear exactly once
      const e2eTools = toolsAfter.filter(t => t.name.startsWith('e2e-test_'));
      const toolNames = e2eTools.map(t => t.name);
      const uniqueToolNames = [...new Set(toolNames)];
      expect(toolNames.length).toBe(uniqueToolNames.length);

      // Verify the correct number of tools
      expect(e2eTools.length).toBe(prefixedToolNames.length);

      // Browser tools should still be present
      for (const bt of BROWSER_TOOL_NAMES) {
        expect(toolsAfter.map(t => t.name)).toContain(bt);
      }

      // Health endpoint should show correct plugin count
      const health = await server.health();
      expect(health).not.toBeNull();
      expect(health?.status).toBe('ok');
      expect(health?.plugins).toBe(1);
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});
