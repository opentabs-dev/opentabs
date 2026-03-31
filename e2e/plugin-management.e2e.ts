/**
 * Plugin management API E2E tests.
 *
 * Exercises the JSON-RPC plugin management methods through the extension
 * WebSocket protocol:
 *   - plugin.search — npm registry search
 *   - plugin.install — npm install + rediscovery
 *   - plugin.updateFromRegistry — npm update + rediscovery
 *   - plugin.remove — npm uninstall / local plugin removal + rediscovery
 *   - plugin.checkUpdates — outdated plugin detection
 *
 * Tests connect a raw WebSocket to the MCP server (same as the extension
 * would) and send JSON-RPC requests directly. This verifies the protocol
 * layer end-to-end, including param validation, error handling, and response
 * shapes.
 *
 * For install/remove/update, error paths are tested using the shared
 * mcpServer fixture. The install+remove happy path uses NPM_CONFIG_PREFIX
 * to redirect npm global operations to a temp directory, exercising the
 * real npm registry without modifying host state. The local plugin remove
 * path is tested with a temporary minimal plugin added to localPlugins.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createMinimalPlugin,
  createTestConfigDir,
  expect,
  fetchWsInfo,
  readTestConfig,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import { npmSlackPluginHasArtifacts, waitForToolList } from './helpers.js';

// ---------------------------------------------------------------------------
// WebSocket JSON-RPC helper
// ---------------------------------------------------------------------------

interface JsonRpcError {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

/**
 * Connect to the MCP server's WebSocket as an extension client.
 * Returns the WebSocket and a helper to send JSON-RPC requests.
 */
const connectWs = async (
  port: number,
  secret?: string,
): Promise<{
  ws: WebSocket;
  sendRequest: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<JsonRpcResponse>;
  close: () => void;
}> => {
  const { wsUrl, wsSecret } = await fetchWsInfo(port, secret);
  const protocols = ['opentabs'];
  if (wsSecret) protocols.push(wsSecret);
  const ws = protocols.length > 1 ? new WebSocket(wsUrl, protocols) : new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5_000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('WebSocket connect failed'));
    };
  });

  // Queue of pending response resolvers keyed by request id
  const pending = new Map<string, (resp: JsonRpcResponse) => void>();

  ws.onmessage = event => {
    try {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : '') as Record<string, unknown>;
      const id = msg.id;
      if (id !== undefined && typeof id === 'string') {
        const resolver = pending.get(id);
        if (resolver) {
          pending.delete(id);
          resolver(msg as unknown as JsonRpcResponse);
        }
      }
    } catch {
      // ignore non-JSON messages (sync.full, etc.)
    }
  };

  const sendRequest = (
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<JsonRpcResponse> => {
    const id = crypto.randomUUID();
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`JSON-RPC request timed out: ${method} (id=${id})`));
      }, timeoutMs);

      pending.set(id, resp => {
        clearTimeout(timeout);
        resolve(resp);
      });

      ws.send(JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {}, id }));
    });
  };

  const close = () => {
    for (const [id, resolver] of pending) {
      resolver({ jsonrpc: '2.0', id, error: { code: -1, message: 'WebSocket closed' } });
    }
    pending.clear();
    ws.close();
  };

  return { ws, sendRequest, close };
};

/**
 * Assert that a JSON-RPC response has an error with the expected code.
 * Returns the error for further assertions.
 */
const expectError = (resp: JsonRpcResponse, code: number): JsonRpcError => {
  expect(resp.error).toBeDefined();
  expect(resp.result).toBeUndefined();
  const error = resp.error;
  if (!error) throw new Error('Expected error but got none');
  expect(error.code).toBe(code);
  return error;
};

// ---------------------------------------------------------------------------
// plugin.search
// ---------------------------------------------------------------------------

test.describe('plugin.search', () => {
  test('returns results when querying npm registry', async ({ mcpServer }) => {
    test.slow(); // network-dependent
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('plugin.search', { query: 'opentabs' });

      expect(resp.error).toBeUndefined();
      expect(resp.result).toBeDefined();

      const result = resp.result as {
        results: Array<{
          name: string;
          description: string;
          version: string;
          author: string;
        }>;
      };
      expect(Array.isArray(result.results)).toBe(true);

      // Each result should have the expected shape
      for (const r of result.results) {
        expect(typeof r.name).toBe('string');
        expect(typeof r.description).toBe('string');
        expect(typeof r.version).toBe('string');
        expect(typeof r.author).toBe('string');
      }
    } finally {
      close();
    }
  });

  test('returns results with no query (all opentabs plugins)', async ({ mcpServer }) => {
    test.slow(); // network-dependent
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('plugin.search');

      expect(resp.error).toBeUndefined();
      expect(resp.result).toBeDefined();

      const result = resp.result as { results: unknown[] };
      expect(Array.isArray(result.results)).toBe(true);
    } finally {
      close();
    }
  });

  test('returns -32602 for invalid params (query is a number)', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('plugin.search', { query: 42 } as unknown as Record<string, unknown>);

      const error = expectError(resp, -32602);
      expect(error.message).toContain('query must be a string');
    } finally {
      close();
    }
  });
});

// ---------------------------------------------------------------------------
// plugin.install
// ---------------------------------------------------------------------------

test.describe('plugin.install', () => {
  test('returns -32602 for missing name param', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('plugin.install', {});

      const error = expectError(resp, -32602);
      expect(error.message).toContain('name must be a non-empty string');
    } finally {
      close();
    }
  });

  test('returns -32602 for name as number', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('plugin.install', { name: 123 } as unknown as Record<string, unknown>);

      const error = expectError(resp, -32602);
      expect(error.message).toContain('name must be a non-empty string');
    } finally {
      close();
    }
  });

  test('returns -32602 for empty string name', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('plugin.install', { name: '' });

      const error = expectError(resp, -32602);
      expect(error.message).toContain('name must be a non-empty string');
    } finally {
      close();
    }
  });

  test('returns -32602 for invalid naming convention', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      // "opentabs-plugin-" alone (no suffix) is invalid
      const resp = await sendRequest('plugin.install', { name: 'opentabs-plugin-' });

      const error = expectError(resp, -32602);
      expect(error.message).toContain('does not match');
    } finally {
      close();
    }
  });

  test('returns -32603 for non-existent package', async ({ mcpServer }) => {
    test.slow(); // npm install takes time before failing
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('plugin.install', {
        name: 'this-package-does-not-exist-xyzzy-9999',
      });

      const error = expectError(resp, -32603);
      // npm error output should be included in the error data
      if (error.data) {
        expect(typeof error.data.stderr === 'string' || typeof error.data.stdout === 'string').toBe(true);
      }
    } finally {
      close();
    }
  });
});

// ---------------------------------------------------------------------------
// plugin.updateFromRegistry
// ---------------------------------------------------------------------------

test.describe('plugin.updateFromRegistry', () => {
  test('returns -32602 for missing name param', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('plugin.updateFromRegistry', {});

      const error = expectError(resp, -32602);
      expect(error.message).toContain('name must be a non-empty string');
    } finally {
      close();
    }
  });

  test('returns -32602 for non-installed plugin', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('plugin.updateFromRegistry', {
        name: 'nonexistent-plugin-xyzzy',
      });

      const error = expectError(resp, -32602);
      expect(error.message).toContain('not currently installed');
    } finally {
      close();
    }
  });
});

// ---------------------------------------------------------------------------
// plugin.remove
// ---------------------------------------------------------------------------

test.describe('plugin.remove', () => {
  test('returns -32602 for missing name param', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('plugin.remove', {});

      const error = expectError(resp, -32602);
      expect(error.message).toContain('name must be a non-empty string');
    } finally {
      close();
    }
  });

  test('returns -32602 for non-installed plugin', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('plugin.remove', { name: 'nonexistent-plugin-xyzzy' });

      const error = expectError(resp, -32602);
      expect(error.message).toContain('not currently installed');
    } finally {
      close();
    }
  });

  test('removes a local plugin and returns ok', async () => {
    // Create an isolated config with a temporary minimal plugin
    const configDir = createTestConfigDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-remove-'));

    let server: Awaited<ReturnType<typeof startMcpServer>> | undefined;
    let client:
      | {
          sendRequest: (m: string, p?: Record<string, unknown>) => Promise<JsonRpcResponse>;
          close: () => void;
        }
      | undefined;

    try {
      // Create a minimal plugin to remove
      const removableDir = createMinimalPlugin(tmpDir, 'removable', [{ name: 'ping', description: 'test' }]);

      // Add the removable plugin to config
      const config = readTestConfig(configDir);
      config.localPlugins.push(removableDir);
      writeTestConfig(configDir, config);

      // Start the server with this config
      server = await startMcpServer(configDir);

      // Wait for the server to be healthy with both plugins
      await server.waitForHealth(h => h.plugins >= 2, 15_000);

      // Connect a WebSocket client
      client = await connectWs(server.port, server.secret);

      // Remove the plugin via API
      const resp = await client.sendRequest('plugin.remove', { name: 'removable' });

      expect(resp.error).toBeUndefined();
      expect(resp.result).toBeDefined();
      expect((resp.result as { ok: boolean }).ok).toBe(true);

      // Verify the plugin is gone from the registry
      const health = await server.waitForHealth(h => h.plugins === 1, 15_000);
      expect(health.plugins).toBe(1);

      // Verify the plugin was removed from config.json localPlugins
      const updatedConfig = readTestConfig(configDir);
      const hasRemovable = updatedConfig.localPlugins.some(p => p.includes('removable'));
      expect(hasRemovable).toBe(false);
    } finally {
      client?.close();
      if (server) await server.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// plugin.checkUpdates
// ---------------------------------------------------------------------------

test.describe('plugin.checkUpdates', () => {
  test('returns outdatedPlugins array shape', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('plugin.checkUpdates');

      expect(resp.error).toBeUndefined();
      expect(resp.result).toBeDefined();

      const result = resp.result as { outdatedPlugins: unknown[] };
      expect(Array.isArray(result.outdatedPlugins)).toBe(true);

      // Each item should have the expected shape (may be empty if nothing is outdated)
      for (const p of result.outdatedPlugins) {
        const plugin = p as {
          name: string;
          currentVersion: string;
          latestVersion: string;
          updateCommand: string;
        };
        expect(typeof plugin.name).toBe('string');
        expect(typeof plugin.currentVersion).toBe('string');
        expect(typeof plugin.latestVersion).toBe('string');
        expect(typeof plugin.updateCommand).toBe('string');
      }
    } finally {
      close();
    }
  });
});

// ---------------------------------------------------------------------------
// Notification rejection — methods require an id (request/response pattern)
// ---------------------------------------------------------------------------

test.describe('notification rejection', () => {
  test('plugin methods without id get no response (treated as notifications)', async ({ mcpServer }) => {
    const { ws, sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const methods = [
        'plugin.search',
        'plugin.install',
        'plugin.updateFromRegistry',
        'plugin.remove',
        'plugin.checkUpdates',
      ];

      // Collect any messages received
      const received: Record<string, unknown>[] = [];
      const originalOnmessage = ws.onmessage;
      ws.onmessage = event => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : '') as Record<string, unknown>;
          received.push(msg);
        } catch {
          // ignore
        }
        // Forward to the original handler (for the pending map)
        if (originalOnmessage) originalOnmessage.call(ws, event);
      };

      // Send each method as a notification (no id field)
      for (const method of methods) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', method, params: {} }));
      }

      // Sentinel request: send a real request after the notifications. Since the
      // server processes messages in order, when this response arrives we know all
      // prior notifications have already been handled — no sleep needed.
      await sendRequest('plugin.checkUpdates');

      // Filter out non-plugin responses (sync.full, pong, plugins.changed, etc.)
      // A JSON-RPC response has an "id" field. Notifications from the server
      // (sync.full, plugins.changed) have no id but have a "method" field.
      // We're looking for any response that indicates our notification-style
      // calls got a response — they shouldn't.
      // The sentinel response has an id and is excluded by the m.id === undefined filter.
      const pluginResponses = received.filter(m => m.error !== undefined && m.id === undefined);

      // No error responses should be returned for notification-style calls
      expect(pluginResponses).toHaveLength(0);
    } finally {
      close();
    }
  });
});

// ---------------------------------------------------------------------------
// config.setPluginPermission — set plugin-level permission
// ---------------------------------------------------------------------------

test.describe('config.setPluginPermission', () => {
  test('setting plugin to off adds [Disabled] prefix to all its tools', async () => {
    // Create standalone server without skipPermissions
    const configDir = createTestConfigDir();
    const config = readTestConfig(configDir);
    config.permissions = { 'e2e-test': { permission: 'auto' } };
    writeTestConfig(configDir, config);

    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
    const { sendRequest, close } = await connectWs(server.port, server.secret);
    const mcpClient = createMcpClient(server.port, server.secret);
    await mcpClient.initialize();

    try {
      // Baseline: e2e-test plugin tools are present without [Disabled] prefix
      const baselineTools = await mcpClient.listTools();
      const echoBaseline = baselineTools.find(t => t.name === 'e2e-test_echo');
      if (!echoBaseline) throw new Error('Expected e2e-test_echo in tools/list');
      expect(echoBaseline.description).not.toMatch(/^\[Disabled\]/);

      // Set plugin permission to 'off'
      const resp = await sendRequest('config.setPluginPermission', {
        plugin: 'e2e-test',
        permission: 'off',
      });
      expect(resp.error).toBeUndefined();
      expect((resp.result as { ok: boolean }).ok).toBe(true);

      // Wait for tools/list to reflect the change — tools get [Disabled] prefix
      await waitForToolList(
        mcpClient,
        tools => {
          const echo = tools.find(t => t.name === 'e2e-test_echo');
          return echo?.description?.startsWith('[Disabled]') ?? false;
        },
        10_000,
        300,
        'e2e-test_echo [Disabled] prefix after plugin off',
      );
    } finally {
      await mcpClient.close();
      close();
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('setting plugin to auto removes [Disabled] prefix from its tools', async () => {
    const configDir = createTestConfigDir();
    const config = readTestConfig(configDir);
    config.permissions = { 'e2e-test': { permission: 'auto' } };
    writeTestConfig(configDir, config);

    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
    const { sendRequest, close } = await connectWs(server.port, server.secret);
    const mcpClient = createMcpClient(server.port, server.secret);
    await mcpClient.initialize();

    try {
      // Set to off first
      await sendRequest('config.setPluginPermission', { plugin: 'e2e-test', permission: 'off' });
      await waitForToolList(
        mcpClient,
        tools => {
          const echo = tools.find(t => t.name === 'e2e-test_echo');
          return echo?.description?.startsWith('[Disabled]') ?? false;
        },
        10_000,
        300,
        'e2e-test_echo [Disabled] prefix after plugin off',
      );

      // Set back to auto
      const resp = await sendRequest('config.setPluginPermission', {
        plugin: 'e2e-test',
        permission: 'auto',
      });
      expect(resp.error).toBeUndefined();
      expect((resp.result as { ok: boolean }).ok).toBe(true);

      // Wait for tools/list to reflect the re-enabled tools
      await waitForToolList(
        mcpClient,
        tools => {
          const echo = tools.find(t => t.name === 'e2e-test_echo');
          return echo !== undefined && !echo.description.startsWith('[Disabled]');
        },
        10_000,
        300,
        'e2e-test_echo no [Disabled] prefix after plugin auto',
      );
    } finally {
      await mcpClient.close();
      close();
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('calling an off tool returns isError: true with disabled message', async () => {
    const configDir = createTestConfigDir();
    const config = readTestConfig(configDir);
    config.permissions = { 'e2e-test': { permission: 'auto' } };
    writeTestConfig(configDir, config);

    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
    const { sendRequest, close } = await connectWs(server.port, server.secret);
    const mcpClient = createMcpClient(server.port, server.secret);
    await mcpClient.initialize();

    try {
      // Set plugin to off
      await sendRequest('config.setPluginPermission', { plugin: 'e2e-test', permission: 'off' });
      await waitForToolList(
        mcpClient,
        tools => {
          const echo = tools.find(t => t.name === 'e2e-test_echo');
          return echo?.description?.startsWith('[Disabled]') ?? false;
        },
        10_000,
        300,
        'e2e-test_echo [Disabled] after plugin off',
      );

      // Calling the off tool should return isError: true with review flow message
      const result = await mcpClient.callTool('e2e-test_echo', { message: 'hello' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('has not been reviewed yet');
    } finally {
      await mcpClient.close();
      close();
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('returns -32602 for invalid params (missing permission)', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('config.setPluginPermission', { plugin: 'e2e-test' });

      expectError(resp, -32602);
    } finally {
      close();
    }
  });
});

// ---------------------------------------------------------------------------
// config.setToolPermission — set per-tool permission
// ---------------------------------------------------------------------------

test.describe('config.setToolPermission', () => {
  test('setting a tool to off adds [Disabled] prefix to only that tool', async () => {
    const configDir = createTestConfigDir();
    const config = readTestConfig(configDir);
    config.permissions = { 'e2e-test': { permission: 'auto' } };
    writeTestConfig(configDir, config);

    const server = await startMcpServer(configDir, true, undefined, { OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '' });
    const { sendRequest, close } = await connectWs(server.port, server.secret);
    const mcpClient = createMcpClient(server.port, server.secret);
    await mcpClient.initialize();

    try {
      // Baseline: echo tool is present without prefix
      const baselineTools = await mcpClient.listTools();
      const echoBaseline = baselineTools.find(t => t.name === 'e2e-test_echo');
      if (!echoBaseline) throw new Error('Expected e2e-test_echo in tools/list');
      expect(echoBaseline.description).not.toMatch(/^\[Disabled\]/);

      // Set only the echo tool to 'off'
      const resp = await sendRequest('config.setToolPermission', {
        plugin: 'e2e-test',
        tool: 'echo',
        permission: 'off',
      });
      expect(resp.error).toBeUndefined();
      expect((resp.result as { ok: boolean }).ok).toBe(true);

      // Wait for echo to get [Disabled] prefix
      await waitForToolList(
        mcpClient,
        tools => {
          const echo = tools.find(t => t.name === 'e2e-test_echo');
          return echo?.description?.startsWith('[Disabled]') ?? false;
        },
        10_000,
        300,
        'e2e-test_echo [Disabled] prefix after tool off',
      );

      // Other e2e-test tools should NOT have the prefix
      const updatedTools = await mcpClient.listTools();
      const greetTool = updatedTools.find(t => t.name === 'e2e-test_greet');
      if (!greetTool) throw new Error('Expected e2e-test_greet in tools/list');
      expect(greetTool.description).not.toMatch(/^\[Disabled\]/);
    } finally {
      await mcpClient.close();
      close();
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('returns -32602 for non-existent tool', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      const resp = await sendRequest('config.setToolPermission', {
        plugin: 'e2e-test',
        tool: 'nonexistent_tool',
        permission: 'off',
      });

      const error = expectError(resp, -32602);
      expect(error.message).toContain('not found');
    } finally {
      close();
    }
  });
});

// ---------------------------------------------------------------------------
// WebSocket authentication — methods work through the extension protocol
// ---------------------------------------------------------------------------

test.describe('WebSocket authentication', () => {
  test('authenticated WebSocket can call plugin management methods', async ({ mcpServer }) => {
    const { sendRequest, close } = await connectWs(mcpServer.port, mcpServer.secret);

    try {
      // Send a checkUpdates request — it always works (no name lookup needed)
      // and returns a well-formed JSON-RPC response proving auth succeeded
      const resp = await sendRequest('plugin.checkUpdates');

      expect(resp.jsonrpc).toBe('2.0');
      expect(resp.id).toBeDefined();
      // Should succeed with outdatedPlugins array
      expect(resp.error).toBeUndefined();
      const result = resp.result as { outdatedPlugins: unknown[] };
      expect(Array.isArray(result.outdatedPlugins)).toBe(true);
    } finally {
      close();
    }
  });
});

// ---------------------------------------------------------------------------
// Stress: install + immediate remove race
// ---------------------------------------------------------------------------

test.describe('install + remove race', () => {
  test('concurrent install and remove settle to uninstalled state', async () => {
    const configDir = createTestConfigDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-race-'));

    let server: Awaited<ReturnType<typeof startMcpServer>> | undefined;
    let client:
      | {
          sendRequest: (m: string, p?: Record<string, unknown>, t?: number) => Promise<JsonRpcResponse>;
          close: () => void;
        }
      | undefined;
    let mcpClient: ReturnType<typeof createMcpClient> | undefined;

    try {
      // Create a local minimal plugin to use in the race
      const raceableDir = createMinimalPlugin(tmpDir, 'raceable', [
        { name: 'ping', description: 'ping tool' },
        { name: 'pong', description: 'pong tool' },
      ]);

      // Add the raceable plugin to config
      const config = readTestConfig(configDir);
      config.localPlugins.push(raceableDir);
      config.permissions = {
        ...config.permissions,
        raceable: { permission: 'auto' },
      };
      writeTestConfig(configDir, config);

      // Start server and wait for the raceable plugin to be discovered
      server = await startMcpServer(configDir);
      await server.waitForHealth(h => {
        const raceable = h.pluginDetails?.find(p => p.name === 'raceable');
        return raceable !== undefined;
      }, 15_000);

      // Connect WebSocket and MCP clients
      client = await connectWs(server.port, server.secret);
      mcpClient = createMcpClient(server.port, server.secret);
      await mcpClient.initialize();

      // Verify baseline: raceable tools exist
      const baselineTools = await mcpClient.listTools();
      const raceableTools = baselineTools.filter(t => t.name.startsWith('raceable_'));
      expect(raceableTools.length).toBe(2);

      // Fire install and remove concurrently within 10ms via Promise.allSettled.
      // install will fail (no npm package "opentabs-plugin-raceable" exists) — that's fine.
      // remove will succeed (removes local plugin from config + rediscovers).
      const [installResult, removeResult] = await Promise.allSettled([
        client.sendRequest('plugin.install', { name: 'raceable' }, 60_000),
        client.sendRequest('plugin.remove', { name: 'raceable' }, 60_000),
      ]);

      // Both must settle (not hang)
      expect(installResult.status).toBe('fulfilled');
      expect(removeResult.status).toBe('fulfilled');

      // Both responses must be valid JSON-RPC (either success or known error)
      if (installResult.status === 'fulfilled') {
        const resp = installResult.value;
        expect(resp.result !== undefined || resp.error !== undefined).toBe(true);
      }
      if (removeResult.status === 'fulfilled') {
        const resp = removeResult.value;
        expect(resp.result !== undefined || resp.error !== undefined).toBe(true);
      }

      // Wait for the server to stabilize after concurrent operations
      await server.waitForHealth(h => h.status === 'ok', 15_000);

      // Verify final state: plugin MUST NOT be in pluginDetails
      const finalHealth = await server.health();
      expect(finalHealth).not.toBeNull();
      const raceablePlugin = finalHealth?.pluginDetails?.find(p => p.name === 'raceable');
      expect(raceablePlugin).toBeUndefined();

      // Verify final state: zero tools with the raceable_ prefix
      const finalTools = await mcpClient.listTools();
      const raceableToolsAfter = finalTools.filter(t => t.name.startsWith('raceable_'));
      expect(raceableToolsAfter).toHaveLength(0);

      // Verify final state: config.json localPlugins does NOT contain the plugin's path
      const finalConfig = readTestConfig(configDir);
      const hasRaceable = finalConfig.localPlugins.some(p => p.includes('raceable'));
      expect(hasRaceable).toBe(false);
    } finally {
      await mcpClient?.close();
      client?.close();
      if (server) await server.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// plugin.install + plugin.remove happy path (real npm registry, isolated prefix)
// ---------------------------------------------------------------------------

const slackArtifactsAvailable = npmSlackPluginHasArtifacts();

test.describe('plugin.install + plugin.remove happy path', () => {
  test.skip(!slackArtifactsAvailable, 'published @opentabs-dev/opentabs-plugin-slack is missing build artifacts');

  test('installs an npm plugin via NPM_CONFIG_PREFIX and then removes it', async () => {
    test.slow(); // real npm install + uninstall over the network
    const configDir = createTestConfigDir();
    const prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-npm-install-'));

    let server: Awaited<ReturnType<typeof startMcpServer>> | undefined;
    let client: Awaited<ReturnType<typeof connectWs>> | undefined;
    let mcpClient: ReturnType<typeof createMcpClient> | undefined;

    try {
      // Start server with npm discovery enabled, prefix isolated to temp dir
      server = await startMcpServer(configDir, false, undefined, {
        OPENTABS_SKIP_NPM_DISCOVERY: undefined,
        NPM_CONFIG_PREFIX: prefixDir,
      });

      // Connect a WebSocket client for plugin management RPC
      client = await connectWs(server.port, server.secret);

      // Install the slack plugin via the shorthand name (generous timeout for npm install -g)
      const installResp = await client.sendRequest('plugin.install', { name: 'slack' }, 120_000);

      expect(installResp.error).toBeUndefined();
      expect(installResp.result).toBeDefined();
      const installResult = installResp.result as {
        ok: boolean;
        plugin: { name: string; displayName: string; version: string; toolCount: number };
      };
      expect(installResult.ok).toBe(true);
      expect(installResult.plugin.name).toBe('slack');
      expect(installResult.plugin.toolCount).toBeGreaterThan(0);

      // Verify the plugin appears in /health with source='npm'
      const health = await server.waitForHealth(h => {
        const slackPlugin = h.pluginDetails?.find(p => p.name === 'slack');
        return slackPlugin !== undefined && slackPlugin.source === 'npm';
      }, 15_000);
      const slackPlugin = health.pluginDetails?.find(p => p.name === 'slack');
      expect(slackPlugin).toBeDefined();
      expect(slackPlugin?.source).toBe('npm');

      // Verify slack tools appear in MCP tools/list
      mcpClient = createMcpClient(server.port, server.secret);
      await mcpClient.initialize();
      const tools = await mcpClient.listTools();
      expect(tools.some(t => t.name.startsWith('slack_'))).toBe(true);

      // Remove the plugin (generous timeout for npm uninstall -g + rediscovery)
      const removeResp = await client.sendRequest('plugin.remove', { name: 'slack' }, 60_000);
      expect(removeResp.error).toBeUndefined();
      expect((removeResp.result as { ok: boolean }).ok).toBe(true);

      // Verify the plugin is gone from /health
      await server.waitForHealth(h => {
        const slack = h.pluginDetails?.find(p => p.name === 'slack');
        return slack === undefined;
      }, 30_000);

      // Verify slack tools are gone from MCP tools/list
      const toolsAfter = await mcpClient.listTools();
      expect(toolsAfter.some(t => t.name.startsWith('slack_'))).toBe(false);
    } finally {
      await mcpClient?.close();
      client?.close();
      if (server) await server.kill();
      cleanupTestConfigDir(configDir);
      fs.rmSync(prefixDir, { recursive: true, force: true });
    }
  });
});
