/**
 * Config watcher E2E tests — production mode.
 *
 * Verifies that config.json changes are detected and applied in production mode
 * (server started without --dev flag), without requiring POST /reload or restart.
 *
 * All tests use dynamic ports and isolated config directories. No test calls
 * POST /reload — the config file watcher must detect changes automatically.
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

/** Read the version string from the e2e-test plugin's package.json. */
const readE2eTestPluginVersion = (): string => {
  const pkgPath = path.join(E2E_TEST_PLUGIN_DIR, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
  return pkg.version;
};

// ---------------------------------------------------------------------------
// Config watcher — production mode auto-discovery
// ---------------------------------------------------------------------------

test.describe('Config watcher — production mode auto-discovery', () => {
  test('removing a plugin path from config.json auto-removes plugin tools in production mode', async () => {
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

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cwp-remove-'));
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      // Start server in production mode (no --dev flag)
      server = await startMcpServer(configDir, false, undefined, undefined, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Verify plugin tools are present initially
      const toolsBefore = await client.listTools();
      const e2eToolsBefore = toolsBefore.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eToolsBefore.length).toBe(prefixedToolNames.length);

      // Wait for config watcher to be set up
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Remove the plugin from config.json
      writeTestConfig(configDir, { localPlugins: [], tools: {} });

      // Poll until plugin tools disappear — the config watcher should auto-detect
      // the change without any manual reload
      const toolsAfter = await waitForToolList(
        client,
        list => !list.some(t => t.name.startsWith('e2e-test_')),
        15_000,
        300,
        'e2e-test plugin tools to disappear after config.json change in production mode',
      );

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

  test('settings change derives new URL patterns in production mode', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      // Start with the e2e-test plugin registered but no settings
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }

      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cwp-settings-'));
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      // Start server in production mode (no --dev flag)
      server = await startMcpServer(configDir, false, undefined, undefined, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Wait for config watcher to be set up
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Write config.json adding url-type settings for two instances
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        tools,
        settings: {
          'e2e-test': {
            instanceUrl: {
              prod: 'https://example.com',
              staging: 'https://staging.example.com',
            },
          },
        },
      });

      // Poll health endpoint until both derived URL patterns appear — the config
      // watcher should detect the change and trigger a reload without POST /reload
      const health = await server.waitForHealth(h => {
        const plugin = h.pluginDetails?.find(p => p.name === 'e2e-test');
        if (!plugin) return false;
        return (
          plugin.urlPatterns.includes('*://example.com/*') && plugin.urlPatterns.includes('*://staging.example.com/*')
        );
      }, 15_000);

      const plugin = health.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(plugin).toBeDefined();
      expect(plugin?.urlPatterns).toContain('*://example.com/*');
      expect(plugin?.urlPatterns).toContain('*://staging.example.com/*');
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('permission change in config.json takes effect in production mode', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const pluginVersion = readE2eTestPluginVersion();
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }

      // Start with e2e-test plugin registered but permission explicitly set to 'off'
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cwp-perm-'));
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        tools,
        permissions: {
          browser: { permission: 'auto' },
          'e2e-test': { permission: 'off' },
        },
      });

      // Start server in production mode without OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS
      // so permission checks are actually enforced
      server = await startMcpServer(
        configDir,
        false,
        undefined,
        { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: undefined },
        true,
      );
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Verify initial health shows permission 'off' for e2e-test plugin
      const initialHealth = await server.health();
      const initialPlugin = initialHealth?.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(initialPlugin).toBeDefined();
      expect(initialPlugin?.permission).toBe('off');

      // Wait for config watcher to be set up
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Update config.json to set permission to 'auto' with a reviewedVersion
      writeTestConfig(configDir, {
        localPlugins: [absPluginPath],
        tools,
        permissions: {
          browser: { permission: 'auto' },
          'e2e-test': { permission: 'auto', reviewedVersion: pluginVersion },
        },
      });

      // Poll health endpoint until the plugin's permission changes to 'auto' —
      // the config watcher should detect the change without POST /reload
      const health = await server.waitForHealth(h => {
        const plugin = h.pluginDetails?.find(p => p.name === 'e2e-test');
        return plugin?.permission === 'auto';
      }, 15_000);

      const plugin = health.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(plugin).toBeDefined();
      expect(plugin?.permission).toBe('auto');
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('rapid config.json writes are debounced into a single reload in production mode', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      // Start with empty config (no plugins)
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cwp-debounce-'));
      writeTestConfig(configDir, { localPlugins: [], tools: {} });

      // Start server in production mode (no --dev flag)
      server = await startMcpServer(configDir, false, undefined, undefined, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Wait for config watcher to be set up
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Record how many reload-trigger log lines exist before our writes
      const reloadLogBefore = server.logs.filter(l =>
        l.includes('config.json changed \u2014 triggering reload'),
      ).length;

      // Write config.json 5 times in rapid succession (every 20ms).
      // Each write changes the content slightly so the watcher detects a real change.
      // All 5 writes happen within 80ms — well within the 200ms debounce window.
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }

      for (let i = 0; i < 5; i++) {
        // First 4 writes use empty localPlugins; last write adds the plugin
        // so we can verify the final state matches the last write.
        const localPlugins = i === 4 ? [absPluginPath] : [];
        const writeTools = i === 4 ? tools : {};
        writeTestConfig(configDir, { localPlugins, tools: writeTools });
        if (i < 4) {
          await new Promise(r => setTimeout(r, 20));
        }
      }

      // Wait 2 seconds for debounced reloads to complete
      await new Promise(r => setTimeout(r, 2_000));

      // Count new reload-trigger log lines — should be <= 2 (debounce consolidated most writes)
      const reloadLogAfter = server.logs.filter(l => l.includes('config.json changed \u2014 triggering reload')).length;
      const reloadCount = reloadLogAfter - reloadLogBefore;
      expect(reloadCount).toBeGreaterThanOrEqual(1);
      expect(reloadCount).toBeLessThanOrEqual(2);

      // Final state must reflect the last write (plugin tools present)
      await waitForToolList(
        client,
        list => list.some(t => t.name.startsWith('e2e-test_')),
        15_000,
        300,
        'e2e-test plugin tools to appear after debounced config writes',
      );
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('MCP client receives tools/list_changed notification after config.json adds a plugin in production mode', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      // Start with empty config (no plugins)
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cwp-notif-'));
      writeTestConfig(configDir, { localPlugins: [], tools: {} });

      // Start server in production mode (no --dev flag)
      server = await startMcpServer(configDir, false, undefined, undefined, true);
      client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // The session ID is set after initialize — we need it to open the SSE GET stream.
      const sessionId = client.sessionId;
      if (!sessionId) throw new Error('No session ID after initialize');

      // Capture port and secret into local variables so they're safely usable
      // inside the Promise closure without optional chaining (server is defined here).
      const serverPort = server.port;
      const serverSecret = server.secret;

      // Open a GET /mcp SSE connection to receive server-pushed notifications.
      // The server sends notifications/tools/list_changed through this stream.
      const notificationReceived = new Promise<void>((resolve, reject) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('Timed out waiting for tools/list_changed notification (15s)'));
        }, 15_000);

        const headers: Record<string, string> = {
          Accept: 'text/event-stream',
          'mcp-session-id': sessionId,
        };
        if (serverSecret) {
          headers.Authorization = `Bearer ${serverSecret}`;
        }

        fetch(`http://localhost:${serverPort}/mcp`, {
          headers,
          signal: controller.signal,
        })
          .then(async res => {
            if (!res.ok || !res.body) {
              reject(new Error(`GET /mcp failed: ${res.status}`));
              return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                // Parse SSE data lines
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                  if (!line.startsWith('data:')) continue;
                  const raw = line.slice('data:'.length).trim();
                  if (!raw) continue;
                  try {
                    const msg = JSON.parse(raw) as Record<string, unknown>;
                    if (msg.method === 'notifications/tools/list_changed') {
                      clearTimeout(timeout);
                      controller.abort();
                      resolve();
                      return;
                    }
                  } catch {
                    // non-JSON SSE line, skip
                  }
                }
              }
            } catch (err) {
              // AbortError is expected when we resolve early — ignore it.
              const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
              if (!isAbort) {
                reject(err as Error);
              }
            }
          })
          .catch(err => {
            const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
            if (!isAbort) {
              reject(err as Error);
            }
          });
      });

      // Wait for config watcher to be set up
      await waitForLog(server, 'Config watcher: Watching', 10_000);

      // Write config.json with the e2e-test plugin path — the config watcher
      // should detect the change, trigger a reload, and send tools/list_changed
      const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);
      const prefixedToolNames = readPluginToolNames();
      const tools: Record<string, boolean> = {};
      for (const t of prefixedToolNames) {
        tools[t] = true;
      }
      writeTestConfig(configDir, { localPlugins: [absPluginPath], tools });

      // Wait for the notification to arrive on the SSE stream
      await notificationReceived;

      // After receiving the notification, verify the new tools are visible
      const toolsAfter = await client.listTools();
      const e2eTools = toolsAfter.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eTools.length).toBe(prefixedToolNames.length);
    } finally {
      await client?.close();
      await server?.kill();
      if (configDir) cleanupTestConfigDir(configDir);
    }
  });

  test('adding a plugin path to config.json auto-discovers plugin tools in production mode', async () => {
    let configDir: string | undefined;
    let server: McpServer | undefined;
    let client: McpClient | undefined;
    try {
      // Start with empty config (no plugins)
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-cwp-add-'));
      writeTestConfig(configDir, { localPlugins: [], tools: {} });

      // Start server in production mode (no --dev flag)
      server = await startMcpServer(configDir, false, undefined, undefined, true);
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

      // Write new config.json with the e2e-test plugin path
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
        'e2e-test plugin tools to appear after config.json change in production mode',
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
});
