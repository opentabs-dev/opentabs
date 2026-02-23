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
 * For install/remove/update, only error paths are tested at the API level
 * because the happy paths require actual npm install -g, which modifies
 * global state. The local plugin remove path is tested with a temporary
 * minimal plugin added to localPlugins.
 */

import {
  test,
  expect,
  fetchWsInfo,
  createTestConfigDir,
  cleanupTestConfigDir,
  readTestConfig,
  writeTestConfig,
  createMinimalPlugin,
  startMcpServer,
} from './fixtures.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  sendRequest: (method: string, params?: Record<string, unknown>) => Promise<JsonRpcResponse>;
  close: () => void;
}> => {
  const { wsUrl, wsSecret } = await fetchWsInfo(port, secret);
  const protocols = ['opentabs'];
  if (wsSecret) protocols.push(wsSecret);
  const ws = protocols.length > 1 ? new WebSocket(wsUrl, protocols) : new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connect failed'));
    setTimeout(() => reject(new Error('WebSocket connect timeout')), 5_000);
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

  const sendRequest = (method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> => {
    const id = crypto.randomUUID();
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`JSON-RPC request timed out: ${method} (id=${id})`));
      }, 30_000);

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
          isOfficial: boolean;
        }>;
      };
      expect(Array.isArray(result.results)).toBe(true);

      // Each result should have the expected shape
      for (const r of result.results) {
        expect(typeof r.name).toBe('string');
        expect(typeof r.description).toBe('string');
        expect(typeof r.version).toBe('string');
        expect(typeof r.author).toBe('string');
        expect(typeof r.isOfficial).toBe('boolean');
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
      // Enable the removable plugin's tool
      config.tools['removable_ping'] = true;
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
    const { ws, close } = await connectWs(mcpServer.port, mcpServer.secret);

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

      // Wait a bit to see if any responses come back
      await new Promise(r => setTimeout(r, 2_000));

      // Filter out non-plugin responses (sync.full, pong, plugins.changed, etc.)
      // A JSON-RPC response has an "id" field. Notifications from the server
      // (sync.full, plugins.changed) have no id but have a "method" field.
      // We're looking for any response that indicates our notification-style
      // calls got a response — they shouldn't.
      const pluginResponses = received.filter(m => m.error !== undefined && m.id === undefined);

      // No error responses should be returned for notification-style calls
      expect(pluginResponses).toHaveLength(0);
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
