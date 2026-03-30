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
  createTestConfigDir,
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

/** Delay for the given number of milliseconds */
const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

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

test.describe('Stress: rapid config writes (10x in 2 seconds)', () => {
  test('10 rapid config writes settle to the final state', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      // Start with the e2e-test plugin registered
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-stress-rapid-'));
      writeTestConfig(configDir, { localPlugins: [absPluginPath] });

      server = await startMcpServer(configDir, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Wait for config watcher to be ready
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Verify plugin tools are present initially
      const toolsBefore = await client.listTools();
      const e2eToolsBefore = toolsBefore.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eToolsBefore.length).toBe(prefixedToolNames.length);

      const configDirRef = configDir;

      // Write config 10 times with 200ms between writes.
      // Odd iterations (1, 3, 5, 7, 9) remove the plugin; even iterations (0, 2, 4, 6, 8) add it.
      // Final write (i=9) removes the plugin.
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          writeTestConfig(configDirRef, { localPlugins: [absPluginPath] });
        } else {
          writeTestConfig(configDirRef, { localPlugins: [] });
        }
        if (i < 9) await delay(200);
      }

      // Wait for all watcher events to settle
      await delay(3_000);

      // Final write was i=9 (odd) → no plugins. Verify e2e-test tools are gone.
      const toolsAfterRapid = await waitForToolList(
        client,
        list => !list.some(t => t.name.startsWith('e2e-test_')),
        15_000,
        300,
        'e2e-test plugin tools to disappear after rapid config writes',
      );

      // Only browser tools (and platform tools) should remain
      for (const bt of BROWSER_TOOL_NAMES) {
        expect(toolsAfterRapid.map(t => t.name)).toContain(bt);
      }

      // Server health should remain ok throughout
      const health = await server.health();
      expect(health).not.toBeNull();
      expect(health?.status).toBe('ok');

      // Now write valid config WITH the plugin and verify recovery
      writeTestConfig(configDirRef, { localPlugins: [absPluginPath] });

      const toolsRecovered = await waitForToolList(
        client,
        list => list.some(t => t.name.startsWith('e2e-test_')),
        15_000,
        300,
        'e2e-test plugin tools to reappear after recovery write',
      );

      const e2eToolsRecovered = toolsRecovered.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eToolsRecovered.length).toBe(prefixedToolNames.length);
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Stress: hot reload spam (5x rapid SIGUSR1)', () => {
  test('5 rapid hot reloads stabilize with correct state and working dispatch', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      // Verify server is healthy before triggering reloads
      const initialHealth = await server.health();
      expect(initialHealth).not.toBeNull();
      if (!initialHealth) throw new Error('health returned null');
      expect(initialHealth.status).toBe('ok');

      // Create an MCP client and verify tools are available
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();

      const expectedToolNames = readPluginToolNames();
      const toolsBefore = await client.listTools();
      for (const name of expectedToolNames) {
        expect(toolsBefore.some(t => t.name === name)).toBe(true);
      }

      // Clear logs to isolate hot-reload output
      server.logs.length = 0;

      // Fire 5 SIGUSR1 signals with 500ms between each. Each signal triggers
      // startWorker() in the dev proxy, which kills the current worker and
      // forks a new one. Only the final worker's 'ready' IPC message produces
      // a stable state — intermediate workers are killed before they finish
      // starting.
      for (let i = 0; i < 5; i++) {
        server.triggerHotReload();
        if (i < 4) await delay(500);
      }

      // Wait for the final 'Hot reload complete' log. The proxy logs this
      // when the last-forked worker sends its 'ready' IPC message.
      await waitForLog(server, 'Hot reload complete', 30_000);

      // Verify the server is healthy after all 5 rapid reloads
      const healthAfter = await server.health();
      expect(healthAfter).not.toBeNull();
      if (!healthAfter) throw new Error('health returned null after rapid reloads');
      expect(healthAfter.status).toBe('ok');

      // Verify tools/list returns the expected tools. The MCP client
      // auto-reinitializes the session after a worker restart.
      const toolsAfter = await client.listTools();
      for (const name of expectedToolNames) {
        expect(toolsAfter.some(t => t.name === name)).toBe(true);
      }

      // Verify no error logs related to process management or state corruption
      const errorPatterns = ['deadlock', 'state corruption', 'uncaughtException'];
      const joinedLogs = server.logs.join('\n');
      for (const pattern of errorPatterns) {
        expect(joinedLogs).not.toContain(pattern);
      }

      await client.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});
