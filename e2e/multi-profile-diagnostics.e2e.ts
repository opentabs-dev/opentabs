/**
 * E2E tests for aggregated extension diagnostic tools across profiles.
 *
 * Verifies that extension_get_state, extension_get_logs, and extension_check_adapter
 * return aggregated data from all connected profiles when multiple raw WebSocket
 * connections simulate multiple browser profiles.
 */

import { createRawWsConnection, expect, test } from './fixtures.js';
import { waitForLog } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers (copied from multi-connection.e2e.ts — not exported)
// ---------------------------------------------------------------------------

/** Send a JSON-RPC message over a raw WebSocket. */
const sendJsonRpc = (ws: WebSocket, method: string, params: Record<string, unknown>, id?: string | number): void => {
  const msg: Record<string, unknown> = { jsonrpc: '2.0', method, params };
  if (id !== undefined) msg.id = id;
  ws.send(JSON.stringify(msg));
};

/**
 * Set up a persistent handler on a WebSocket that auto-responds to a specific
 * JSON-RPC method with a given result. Filters out messages without the target
 * method (like sync.full) automatically.
 */
const setupAutoResponder = (ws: WebSocket, method: string, result: unknown): void => {
  ws.addEventListener('message', (event: MessageEvent) => {
    try {
      const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (msg.method === method && msg.id !== undefined) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      }
    } catch {
      // Ignore
    }
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Multi-profile aggregated extension diagnostics', () => {
  test('extension_get_state returns connections array from both profiles', async ({ mcpServer, mcpClient }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-diag-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-diag-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Send distinct tab.syncAll from each connection
      sendJsonRpc(wsAlpha, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 6001, url: 'http://localhost/diag-alpha', title: 'Diag Alpha', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      mcpServer.logs.length = 0;
      sendJsonRpc(wsBeta, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 6002, url: 'http://localhost/diag-beta', title: 'Diag Beta', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      // Set up auto-responders for extension.getState on both connections
      setupAutoResponder(wsAlpha, 'extension.getState', {
        connection: { wsConnected: true },
        plugins: [{ name: 'e2e-test', state: 'ready' }],
        networkCaptures: [],
        offscreen: { exists: true },
      });
      setupAutoResponder(wsBeta, 'extension.getState', {
        connection: { wsConnected: true },
        plugins: [{ name: 'e2e-test', state: 'ready' }],
        networkCaptures: [],
        offscreen: { exists: true },
      });

      // Call extension_get_state
      const result = await mcpClient.callTool('extension_get_state');
      expect(result.isError).toBe(false);

      const data = JSON.parse(result.content) as {
        connections: Array<{ connectionId: string; connection?: unknown; plugins?: unknown }>;
      };
      expect(data.connections).toBeDefined();
      expect(data.connections.length).toBeGreaterThanOrEqual(2);

      // Verify both connectionIds are present
      const connIds = data.connections.map(c => c.connectionId);
      expect(connIds).toContain('conn-diag-alpha');
      expect(connIds).toContain('conn-diag-beta');

      // Each entry should have extension state data
      for (const conn of data.connections) {
        expect(conn.connection).toBeDefined();
        expect(conn.plugins).toBeDefined();
      }
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('extension_get_logs merges and sorts entries from both profiles', async ({ mcpServer, mcpClient }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-log-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-log-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Set up auto-responders for extension.getLogs with different timestamps
      setupAutoResponder(wsAlpha, 'extension.getLogs', {
        entries: [
          { timestamp: 2000, level: 'info', message: 'alpha-log-2', source: 'background' },
          { timestamp: 1000, level: 'info', message: 'alpha-log-1', source: 'background' },
        ],
        stats: { totalBackground: 2, totalOffscreen: 0, bufferSize: 2 },
      });
      setupAutoResponder(wsBeta, 'extension.getLogs', {
        entries: [
          { timestamp: 2500, level: 'warn', message: 'beta-log-2', source: 'background' },
          { timestamp: 1500, level: 'info', message: 'beta-log-1', source: 'background' },
        ],
        stats: { totalBackground: 2, totalOffscreen: 0, bufferSize: 2 },
      });

      // Call extension_get_logs
      const result = await mcpClient.callTool('extension_get_logs');
      expect(result.isError).toBe(false);

      const data = JSON.parse(result.content) as {
        entries: Array<{ timestamp: number; connectionId: string; message: string }>;
        stats: { totalBackground: number; totalOffscreen: number; bufferSize: number };
      };

      // Should have all 4 entries
      expect(data.entries.length).toBe(4);

      // Entries should be sorted by timestamp descending (newest first)
      const timestamps = data.entries.map(e => e.timestamp);
      expect(timestamps).toEqual([2500, 2000, 1500, 1000]);

      // Each entry should have a connectionId
      for (const entry of data.entries) {
        expect(entry.connectionId).toBeDefined();
      }

      // Verify correct connectionId attribution
      const alphaEntries = data.entries.filter(e => e.connectionId === 'conn-log-alpha');
      const betaEntries = data.entries.filter(e => e.connectionId === 'conn-log-beta');
      expect(alphaEntries.length).toBe(2);
      expect(betaEntries.length).toBe(2);

      // Stats should be summed across connections
      expect(data.stats.totalBackground).toBe(4);
      expect(data.stats.bufferSize).toBe(4);
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('extension_check_adapter returns connections array from both profiles', async ({ mcpServer, mcpClient }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-adapter-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-adapter-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Set up auto-responders for extension.checkAdapter with different adapter statuses
      setupAutoResponder(wsAlpha, 'extension.checkAdapter', {
        plugin: 'e2e-test',
        tabs: [{ tabId: 7001, injected: true, hash: 'abc123', hashMatch: true, ready: true, tools: 3 }],
      });
      setupAutoResponder(wsBeta, 'extension.checkAdapter', {
        plugin: 'e2e-test',
        tabs: [{ tabId: 7002, injected: true, hash: 'abc123', hashMatch: true, ready: true, tools: 3 }],
      });

      // Call extension_check_adapter
      const result = await mcpClient.callTool('extension_check_adapter', { plugin: 'e2e-test' });
      expect(result.isError).toBe(false);

      const data = JSON.parse(result.content) as {
        connections: Array<{ connectionId: string; plugin?: string; tabs?: unknown[] }>;
      };
      expect(data.connections).toBeDefined();
      expect(data.connections.length).toBeGreaterThanOrEqual(2);

      // Verify both connectionIds are present
      const connIds = data.connections.map(c => c.connectionId);
      expect(connIds).toContain('conn-adapter-alpha');
      expect(connIds).toContain('conn-adapter-beta');

      // Each entry should have adapter status data
      for (const conn of data.connections) {
        expect(conn.plugin).toBe('e2e-test');
        expect(conn.tabs).toBeDefined();
      }
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('extension_get_state with single connection returns connections array with one element', async ({
    mcpServer,
    mcpClient,
  }) => {
    let wsSingle: WebSocket | undefined;
    try {
      wsSingle = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-single');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 1, 10_000);

      // Set up auto-responder for extension.getState
      setupAutoResponder(wsSingle, 'extension.getState', {
        connection: { wsConnected: true },
        plugins: [],
        networkCaptures: [],
        offscreen: { exists: false },
      });

      // Call extension_get_state
      const result = await mcpClient.callTool('extension_get_state');
      expect(result.isError).toBe(false);

      const data = JSON.parse(result.content) as {
        connections: Array<{ connectionId: string }>;
      };
      expect(data.connections).toBeDefined();
      expect(data.connections.length).toBe(1);
      expect(data.connections[0]?.connectionId).toBe('conn-single');
    } finally {
      wsSingle?.close();
    }
  });

  test('extension_get_logs with distinct tab states returns entries from both profiles', async ({
    mcpServer,
    mcpClient,
  }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-logdist-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-logdist-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Send different tab states from each connection
      sendJsonRpc(wsAlpha, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 8001, url: 'http://localhost/log-alpha', title: 'Log Alpha', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      mcpServer.logs.length = 0;
      sendJsonRpc(wsBeta, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'unavailable',
            tabs: [{ tabId: 8002, url: 'http://localhost/log-beta', title: 'Log Beta', ready: false }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      // Set up auto-responders with different log entries
      setupAutoResponder(wsAlpha, 'extension.getState', {
        connection: { wsConnected: true },
        plugins: [{ name: 'e2e-test', state: 'ready' }],
        networkCaptures: [],
        offscreen: { exists: true },
      });
      setupAutoResponder(wsBeta, 'extension.getState', {
        connection: { wsConnected: true },
        plugins: [{ name: 'e2e-test', state: 'unavailable' }],
        networkCaptures: [],
        offscreen: { exists: true },
      });

      // Verify extension_get_state reflects distinct plugin states per profile
      const stateResult = await mcpClient.callTool('extension_get_state');
      expect(stateResult.isError).toBe(false);

      const stateData = JSON.parse(stateResult.content) as {
        connections: Array<{ connectionId: string; plugins?: Array<{ name: string; state: string }> }>;
      };
      expect(stateData.connections.length).toBeGreaterThanOrEqual(2);

      const alphaConn = stateData.connections.find(c => c.connectionId === 'conn-logdist-alpha');
      const betaConn = stateData.connections.find(c => c.connectionId === 'conn-logdist-beta');
      expect(alphaConn?.plugins?.[0]?.state).toBe('ready');
      expect(betaConn?.plugins?.[0]?.state).toBe('unavailable');
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });
});
