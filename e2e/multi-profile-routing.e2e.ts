/**
 * E2E tests for plugin-aware dispatch routing across multiple profiles.
 *
 * Verifies that plugin tool dispatch routes to the correct connection when
 * a plugin's tabs exist on only one of multiple connected profiles, using
 * raw WebSocket connections as fake extension profiles.
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

/** Wait for a WebSocket to receive a message matching a predicate. */
const waitForWsMessage = (
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`waitForWsMessage timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const handler = (event: MessageEvent): void => {
      try {
        const data = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (predicate(data)) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          resolve(data);
        }
      } catch {
        // Not JSON — ignore
      }
    };
    ws.addEventListener('message', handler);
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Multi-profile plugin-aware dispatch routing', () => {
  test('plugin tool routes to the connection with the plugin in ready state', async ({ mcpServer, mcpClient }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // conn-alpha has NO e2e-test tabs
      sendJsonRpc(wsAlpha, 'tab.syncAll', {
        tabs: {},
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      // conn-beta has e2e-test plugin in ready state
      mcpServer.logs.length = 0;
      sendJsonRpc(wsBeta, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 2001, url: 'http://localhost/beta', title: 'Beta Tab', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      // Set up listener on conn-beta for the tool.dispatch message BEFORE calling the tool
      const betaDispatch = waitForWsMessage(wsBeta, msg => msg.method === 'tool.dispatch', 15_000);

      // Call e2e-test_echo via MCP — should route to conn-beta (not conn-alpha)
      const toolCallPromise = mcpClient.callTool('e2e-test_echo', { message: 'route-test' });

      // Wait for conn-beta to receive the dispatch
      const dispatchMsg = await betaDispatch;
      expect(dispatchMsg.method).toBe('tool.dispatch');

      // Respond from conn-beta with the tool result
      const dispatchId = dispatchMsg.id;
      wsBeta.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: dispatchId,
          result: { output: { ok: true, message: 'route-test' } },
        }),
      );

      // Verify the MCP client gets the success response
      const result = await toolCallPromise;
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('route-test');
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('plugin tool succeeds when both profiles have the plugin ready', async ({ mcpServer, mcpClient }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Both connections have e2e-test in ready state
      sendJsonRpc(wsAlpha, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 1001, url: 'http://localhost/alpha', title: 'Alpha Tab', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      mcpServer.logs.length = 0;
      sendJsonRpc(wsBeta, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 2001, url: 'http://localhost/beta', title: 'Beta Tab', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      // Set up dispatch handlers on BOTH connections — exactly one will receive it
      const setupDispatchHandler = (ws: WebSocket, marker: string) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.method === 'tool.dispatch' && msg.id !== undefined) {
              ws.send(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: msg.id,
                  result: { output: { ok: true, message: `from-${marker}` } },
                }),
              );
            }
          } catch {
            // Ignore
          }
        });
      };
      setupDispatchHandler(wsAlpha, 'alpha');
      setupDispatchHandler(wsBeta, 'beta');

      // Call the tool — should succeed via either connection
      const result = await mcpClient.callTool('e2e-test_echo', { message: 'both-ready' });
      expect(result.isError).toBeFalsy();
      expect(result.content).toMatch(/from-(alpha|beta)/);
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('plugin tool fails when neither profile has the plugin in ready state', async ({ mcpServer, mcpClient }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Neither connection has any e2e-test tabs
      sendJsonRpc(wsAlpha, 'tab.syncAll', { tabs: {} });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      mcpServer.logs.length = 0;
      sendJsonRpc(wsBeta, 'tab.syncAll', { tabs: {} });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      // Set up handlers on both connections to respond with a "No matching tab" error
      // (simulating what the real extension would do when no adapter is loaded)
      const setupErrorHandler = (ws: WebSocket) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.method === 'tool.dispatch' && msg.id !== undefined) {
              ws.send(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: msg.id,
                  error: { code: -32600, message: 'No matching tab for plugin e2e-test' },
                }),
              );
            }
          } catch {
            // Ignore
          }
        });
      };
      setupErrorHandler(wsAlpha);
      setupErrorHandler(wsBeta);

      // Call the tool — should get an error
      const result = await mcpClient.callTool('e2e-test_echo', { message: 'should-fail' });
      expect(result.isError).toBe(true);
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('plugin_list_tabs returns tabs from both connections with connectionId', async ({ mcpServer, mcpClient }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-route-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-route-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Send tab.syncAll from both connections with e2e-test plugin tabs
      sendJsonRpc(wsAlpha, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 5001, url: 'http://localhost/route-alpha', title: 'Route Alpha', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      mcpServer.logs.length = 0;
      sendJsonRpc(wsBeta, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 5002, url: 'http://localhost/route-beta', title: 'Route Beta', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      // Call plugin_list_tabs for the e2e-test plugin
      const result = await mcpClient.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
      expect(result.isError).toBe(false);

      const plugins = JSON.parse(result.content) as Array<{
        plugin: string;
        tabs: Array<{ tabId: number; connectionId: string }>;
      }>;
      expect(plugins.length).toBeGreaterThanOrEqual(1);

      const e2ePlugin = plugins.find(p => p.plugin === 'e2e-test');
      if (!e2ePlugin) throw new Error('e2e-test plugin not found in plugin_list_tabs response');

      const tabs = e2ePlugin.tabs;
      expect(tabs.length).toBeGreaterThanOrEqual(2);

      // Each tab should have a connectionId
      for (const tab of tabs) {
        expect(tab.connectionId).toBeDefined();
        expect(typeof tab.connectionId).toBe('string');
      }

      // Verify connectionId assignment is correct
      const alphaTab = tabs.find(t => t.tabId === 5001);
      const betaTab = tabs.find(t => t.tabId === 5002);
      expect(alphaTab?.connectionId).toBe('conn-route-alpha');
      expect(betaTab?.connectionId).toBe('conn-route-beta');
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });
});
