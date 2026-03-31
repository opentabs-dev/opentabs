/**
 * E2E tests for multi-connection WebSocket support.
 *
 * Verifies that multiple WebSocket connections (identified by connectionId)
 * can coexist, tab state is scoped per-connection, dispatches route correctly,
 * and disconnecting one connection does not affect others.
 */

import { createRawWsConnection, expect, fetchWsInfo, test } from './fixtures.js';
import { waitForExtensionConnected, waitForLog } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
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

test.describe('Multi-connection WebSocket support', () => {
  test('two connections with different connectionIds coexist without eviction', async ({ mcpServer }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');

      // Both connections exist — health endpoint should show extensionConnected: true
      const health = await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);
      expect(health.extensionConnected).toBe(true);
      expect(health.extensionConnections).toBeGreaterThanOrEqual(2);

      // Wait 3 seconds to verify neither is evicted
      await new Promise(r => setTimeout(r, 3_000));

      const healthAfter = await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 5_000);
      expect(healthAfter.extensionConnections).toBeGreaterThanOrEqual(2);
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('same connectionId reconnect replaces only that connection', async ({ mcpServer }) => {
    let wsAlpha1: WebSocket | undefined;
    let wsAlpha2: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha1 = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');

      // Verify both are connected
      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Track when wsAlpha1 gets closed by the server
      const alpha1Closed = new Promise<void>(resolve => {
        wsAlpha1?.addEventListener('close', () => resolve());
      });

      // Reconnect with the same connectionId 'conn-alpha' — should replace wsAlpha1
      mcpServer.logs.length = 0;
      wsAlpha2 = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');

      // wsAlpha1 should receive a close frame from the server
      await alpha1Closed;

      // Verify we still have 2 connections (alpha2 replaced alpha1, beta untouched)
      const health = await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);
      expect(health.extensionConnections).toBeGreaterThanOrEqual(2);

      // Verify the replacement was logged
      await waitForLog(mcpServer, 'same-profile reconnect', 5_000);
    } finally {
      wsAlpha1?.close();
      wsAlpha2?.close();
      wsBeta?.close();
    }
  });

  test('tab.syncAll from one connection does not affect the other', async ({ mcpServer }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Send tab.syncAll from wsAlpha with e2e-test plugin having tab 1001
      sendJsonRpc(wsAlpha, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 1001, url: 'http://localhost/alpha', title: 'Alpha Tab', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      // Send tab.syncAll from wsBeta with e2e-test plugin having tab 2001
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

      // Health endpoint should show plugin with 'ready' state (merged view)
      const health = await mcpServer.waitForHealth(
        h => h.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState === 'ready',
        10_000,
      );
      const plugin = health.pluginDetails?.find(p => p.name === 'e2e-test');
      expect(plugin).toBeDefined();

      // Both tabs should be visible in the merged tab listing
      const tabs = plugin?.tabs ?? [];
      const tabIds = tabs.map(t => t.tabId);
      expect(tabIds).toContain(1001);
      expect(tabIds).toContain(2001);

      // Now send a new syncAll from alpha that removes tab 1001 — beta's tab 2001 should remain
      mcpServer.logs.length = 0;
      sendJsonRpc(wsAlpha, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'closed',
            tabs: [],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      // Beta's tab should still be there
      const healthAfter = await mcpServer.waitForHealth(h => {
        const p = h.pluginDetails?.find(pd => pd.name === 'e2e-test');
        return p?.tabs?.some(t => t.tabId === 2001) === true;
      }, 10_000);
      const pluginAfter = healthAfter.pluginDetails?.find(p => p.name === 'e2e-test');
      const tabsAfter = pluginAfter?.tabs ?? [];
      expect(tabsAfter.some(t => t.tabId === 2001)).toBe(true);
      expect(tabsAfter.some(t => t.tabId === 1001)).toBe(false);
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('closing one connection does not affect the other', async ({ mcpServer }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Close alpha
      wsAlpha.close();
      wsAlpha = undefined;

      // Beta should still be connected — health shows 1 connection
      const health = await mcpServer.waitForHealth(h => h.extensionConnections >= 1 && h.extensionConnected, 10_000);
      expect(health.extensionConnected).toBe(true);
      expect(health.extensionConnections).toBeGreaterThanOrEqual(1);

      // Verify that the server logged the disconnect for alpha
      await waitForLog(mcpServer, 'Extension WebSocket disconnected (connectionId: conn-alpha)', 5_000);
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('connection without connectionId gets a random UUID (backwards compat)', async ({ mcpServer }) => {
    const { wsUrl, wsSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
    const protocols = ['opentabs'];
    if (wsSecret) protocols.push(wsSecret);
    // No connectionId in the protocols — only ['opentabs', '<secret>']
    const ws = protocols.length > 1 ? new WebSocket(wsUrl, protocols) : new WebSocket(wsUrl);
    try {
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

      // Server should log a connection with a UUID-format connectionId
      await waitForLog(mcpServer, 'Extension WebSocket connected (connectionId:', 5_000);

      const health = await mcpServer.waitForHealth(h => h.extensionConnected, 10_000);
      expect(health.extensionConnected).toBe(true);
    } finally {
      ws.close();
    }
  });

  test('broadcasts (sync.full) are sent to all connections', async ({ mcpServer }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');

      // Both connections should receive the sync.full message that is sent on connect.
      // Set up listeners before they might arrive.
      const alphaGotSync = waitForWsMessage(wsAlpha, msg => msg.method === 'sync.full', 10_000);
      const betaGotSync = waitForWsMessage(wsBeta, msg => msg.method === 'sync.full', 10_000);

      // Trigger a POST /reload to cause sync.full broadcast
      const headers: Record<string, string> = {};
      if (mcpServer.secret) headers.Authorization = `Bearer ${mcpServer.secret}`;
      await fetch(`http://localhost:${mcpServer.port}/reload`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      // Both should receive sync.full
      const [alphaMsg, betaMsg] = await Promise.all([alphaGotSync, betaGotSync]);
      expect(alphaMsg.method).toBe('sync.full');
      expect(betaMsg.method).toBe('sync.full');
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('extension + raw WS coexist: extension handles dispatches while raw WS receives broadcasts', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // Wait for the real extension to connect and report tabs
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // Open a page so the e2e-test plugin has a matching tab
    const page = await extensionContext.newPage();
    await page.goto(testServer.url, { waitUntil: 'load', timeout: 10_000 });

    // Wait for the plugin to become ready
    await mcpServer.waitForHealth(h => h.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState === 'ready', 30_000);

    // Open a raw WS with a different connectionId — should coexist with the extension
    let rawWs: WebSocket | undefined;
    try {
      rawWs = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'raw-test-conn');

      // Verify we have at least 2 connections (extension + raw)
      const health = await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);
      expect(health.extensionConnections).toBeGreaterThanOrEqual(2);

      // The extension should still handle tool dispatches normally
      const result = await mcpClient.callTool('e2e-test_echo', { message: 'multi-conn-test' });
      expect(result.isError).toBeFalsy();
      const text = Array.isArray(result.content)
        ? result.content.map((c: { text?: string }) => c.text ?? '').join('')
        : String(result.content);
      expect(text).toContain('multi-conn-test');

      // The raw WS should receive broadcasts (like sync.full on reload)
      const rawGotSync = waitForWsMessage(rawWs, msg => msg.method === 'sync.full', 15_000);

      // Trigger a reload to broadcast sync.full
      const headers: Record<string, string> = {};
      if (mcpServer.secret) headers.Authorization = `Bearer ${mcpServer.secret}`;
      await fetch(`http://localhost:${mcpServer.port}/reload`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      const syncMsg = await rawGotSync;
      expect(syncMsg.method).toBe('sync.full');
    } finally {
      rawWs?.close();
      await page.close();
    }
  });

  // -------------------------------------------------------------------------
  // Multi-connection routing tests
  // -------------------------------------------------------------------------

  test('browser_list_tabs returns merged tabs from both connections with connectionId', async ({
    mcpServer,
    mcpClient,
  }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Set up message handlers for browser.listTabs dispatch on each connection
      const handleListTabs = (ws: WebSocket, fakeTabs: Array<Record<string, unknown>>) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.method === 'browser.listTabs' && msg.id !== undefined) {
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: fakeTabs }));
            }
          } catch {
            // Ignore non-JSON
          }
        });
      };

      handleListTabs(wsAlpha, [
        { id: 1001, title: 'Alpha Tab 1', url: 'http://localhost/alpha1', active: true, windowId: 1 },
        { id: 1002, title: 'Alpha Tab 2', url: 'http://localhost/alpha2', active: false, windowId: 1 },
      ]);

      handleListTabs(wsBeta, [
        { id: 2001, title: 'Beta Tab 1', url: 'http://localhost/beta1', active: true, windowId: 2 },
      ]);

      // Call browser_list_tabs via MCP client
      const result = await mcpClient.callTool('browser_list_tabs');
      expect(result.isError).toBe(false);

      const tabs = JSON.parse(result.content) as Array<Record<string, unknown>>;

      // Should contain tabs from both connections
      const tabIds = tabs.map(t => t.id);
      expect(tabIds).toContain(1001);
      expect(tabIds).toContain(1002);
      expect(tabIds).toContain(2001);

      // Each tab should have a connectionId
      for (const tab of tabs) {
        expect(tab.connectionId).toBeDefined();
        expect(typeof tab.connectionId).toBe('string');
      }

      // Alpha tabs should have connectionId 'conn-alpha', beta tabs 'conn-beta'
      const alphaTabs = tabs.filter(t => t.connectionId === 'conn-alpha');
      const betaTabs = tabs.filter(t => t.connectionId === 'conn-beta');
      expect(alphaTabs.map(t => t.id)).toEqual(expect.arrayContaining([1001, 1002]));
      expect(betaTabs.map(t => t.id)).toEqual(expect.arrayContaining([2001]));
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('browser_open_tab with connectionId routes to the specified connection', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // Wait for the real extension to connect
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // Open a second raw WS connection
    let rawWs: WebSocket | undefined;
    try {
      rawWs = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta-open');
      const ws = rawWs;

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Discover the real extension's connectionId by calling browser_list_tabs.
      // Set up the raw WS to respond to browser.listTabs with empty tabs.
      ws.addEventListener('message', (event: MessageEvent) => {
        try {
          const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (msg.method === 'browser.listTabs' && msg.id !== undefined) {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: [] }));
          }
          // Track if browser.openTab was dispatched to the raw WS (it shouldn't be)
          if (msg.method === 'browser.openTab' && msg.id !== undefined) {
            ws.send(
              JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                error: { code: -1, message: 'WRONG_CONNECTION: openTab dispatched to raw WS' },
              }),
            );
          }
        } catch {
          // Ignore
        }
      });

      // Get the real extension's connectionId from browser_list_tabs
      const listResult = await mcpClient.callTool('browser_list_tabs');
      expect(listResult.isError).toBe(false);
      const allTabs = JSON.parse(listResult.content) as Array<Record<string, unknown>>;

      // Find a connectionId that is NOT 'conn-beta-open' — that's the real extension's
      const realConnTab = allTabs.find(t => t.connectionId !== 'conn-beta-open');
      if (!realConnTab) throw new Error('No tabs found from real extension');
      const realConnectionId = realConnTab.connectionId as string;

      // Call browser_open_tab targeting the real extension
      const openResult = await mcpClient.callTool('browser_open_tab', {
        url: testServer.url,
        connectionId: realConnectionId,
      });
      expect(openResult.isError).toBe(false);

      // The result should contain the new tab info (from the real extension)
      const openData = JSON.parse(openResult.content) as Record<string, unknown>;
      expect(openData.id).toBeDefined();
    } finally {
      rawWs?.close();
    }
  });

  test('plugin_list_tabs includes connectionId for each tab', async ({ mcpServer, mcpClient }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-plt-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-plt-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Send tab.syncAll from both connections with e2e-test plugin tabs
      sendJsonRpc(wsAlpha, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 3001, url: 'http://localhost/plt-alpha', title: 'PLT Alpha', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      mcpServer.logs.length = 0;
      sendJsonRpc(wsBeta, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 3002, url: 'http://localhost/plt-beta', title: 'PLT Beta', ready: true }],
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
      const alphaTab = tabs.find(t => t.tabId === 3001);
      const betaTab = tabs.find(t => t.tabId === 3002);
      expect(alphaTab?.connectionId).toBe('conn-plt-alpha');
      expect(betaTab?.connectionId).toBe('conn-plt-beta');
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('network capture tracks on the correct connection via getConnectionForTab', async ({ mcpServer, mcpClient }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-net-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-net-beta');

      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Register tabs from each connection via tab.syncAll
      sendJsonRpc(wsAlpha, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 4001, url: 'http://localhost/net-alpha', title: 'Net Alpha', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      mcpServer.logs.length = 0;
      sendJsonRpc(wsBeta, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 4002, url: 'http://localhost/net-beta', title: 'Net Beta', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      // Set up both connections to handle browser.enableNetworkCapture and browser.disableNetworkCapture
      const setupCaptureHandler = (ws: WebSocket) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (
              (msg.method === 'browser.enableNetworkCapture' || msg.method === 'browser.disableNetworkCapture') &&
              msg.id !== undefined
            ) {
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }));
            }
          } catch {
            // Ignore
          }
        });
      };
      setupCaptureHandler(wsAlpha);
      setupCaptureHandler(wsBeta);

      // Enable network capture on tab 4001 (owned by alpha)
      const enableResult = await mcpClient.callTool('browser_enable_network_capture', { tabId: 4001 });
      expect(enableResult.isError).toBe(false);

      // Disable network capture on tab 4001
      const disableResult = await mcpClient.callTool('browser_disable_network_capture', { tabId: 4001 });
      expect(disableResult.isError).toBe(false);

      // Enable network capture on tab 4002 (owned by beta)
      const enableResult2 = await mcpClient.callTool('browser_enable_network_capture', { tabId: 4002 });
      expect(enableResult2.isError).toBe(false);

      // Disable network capture on tab 4002
      const disableResult2 = await mcpClient.callTool('browser_disable_network_capture', { tabId: 4002 });
      expect(disableResult2.isError).toBe(false);
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  // -------------------------------------------------------------------------
  // Cross-profile browser tool dispatch tests
  // -------------------------------------------------------------------------

  test('browser_get_tab_content routes to the correct connection via browserTabOwnership', async ({
    mcpServer,
    mcpClient,
  }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');
      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Set up handleListTabs on both connections
      const handleListTabs = (ws: WebSocket, fakeTabs: Array<Record<string, unknown>>) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.method === 'browser.listTabs' && msg.id !== undefined) {
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: fakeTabs }));
            }
          } catch {
            // Ignore non-JSON
          }
        });
      };

      handleListTabs(wsAlpha, [
        { id: 1001, title: 'Alpha Tab', url: 'http://localhost/alpha', active: true, windowId: 1 },
      ]);
      handleListTabs(wsBeta, [
        { id: 2001, title: 'Beta Tab', url: 'http://localhost/beta', active: true, windowId: 2 },
      ]);

      // Populate browserTabOwnership
      await mcpClient.callTool('browser_list_tabs');

      // Set up getTabContent handlers that return connection-specific markers
      const setupGetTabContentHandler = (ws: WebSocket, marker: string) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.method === 'browser.getTabContent' && msg.id !== undefined) {
              ws.send(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: msg.id,
                  result: { content: `content-from-${marker}`, title: 'Test', url: 'http://test' },
                }),
              );
            }
          } catch {
            // Ignore
          }
        });
      };
      setupGetTabContentHandler(wsAlpha, 'alpha');
      setupGetTabContentHandler(wsBeta, 'beta');

      // Call with alpha's tabId — should route to alpha
      const resultAlpha = await mcpClient.callTool('browser_get_tab_content', { tabId: 1001 });
      expect(resultAlpha.isError).toBe(false);
      expect(resultAlpha.content).toContain('content-from-alpha');

      // Call with beta's tabId — should route to beta
      const resultBeta = await mcpClient.callTool('browser_get_tab_content', { tabId: 2001 });
      expect(resultBeta.isError).toBe(false);
      expect(resultBeta.content).toContain('content-from-beta');
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('browser_execute_script routes to the correct connection via browserTabOwnership', async ({
    mcpServer,
    mcpClient,
  }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');
      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Set up handleListTabs
      const handleListTabs = (ws: WebSocket, fakeTabs: Array<Record<string, unknown>>) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.method === 'browser.listTabs' && msg.id !== undefined) {
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: fakeTabs }));
            }
          } catch {
            // Ignore
          }
        });
      };

      handleListTabs(wsAlpha, [
        { id: 1001, title: 'Alpha Tab', url: 'http://localhost/alpha', active: true, windowId: 1 },
      ]);
      handleListTabs(wsBeta, [
        { id: 2001, title: 'Beta Tab', url: 'http://localhost/beta', active: true, windowId: 2 },
      ]);

      await mcpClient.callTool('browser_list_tabs');

      // Set up executeScript handlers with connection-specific markers
      const setupExecHandler = (ws: WebSocket, marker: string) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.method === 'browser.executeScript' && msg.id !== undefined) {
              ws.send(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: msg.id,
                  result: { result: `executed-on-${marker}` },
                }),
              );
            }
          } catch {
            // Ignore
          }
        });
      };
      setupExecHandler(wsAlpha, 'alpha');
      setupExecHandler(wsBeta, 'beta');

      // Call with alpha's tabId — should route to alpha
      const result = await mcpClient.callTool('browser_execute_script', {
        tabId: 1001,
        code: 'return document.title',
      });
      expect(result.isError).toBe(false);
      expect(result.content).toContain('executed-on-alpha');
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('browser_navigate_tab routes to the correct connection via browserTabOwnership', async ({
    mcpServer,
    mcpClient,
  }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');
      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Set up handleListTabs
      const handleListTabs = (ws: WebSocket, fakeTabs: Array<Record<string, unknown>>) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.method === 'browser.listTabs' && msg.id !== undefined) {
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: fakeTabs }));
            }
          } catch {
            // Ignore
          }
        });
      };

      handleListTabs(wsAlpha, [
        { id: 1001, title: 'Alpha Tab', url: 'http://localhost/alpha', active: true, windowId: 1 },
      ]);
      handleListTabs(wsBeta, [
        { id: 2001, title: 'Beta Tab', url: 'http://localhost/beta', active: true, windowId: 2 },
      ]);

      await mcpClient.callTool('browser_list_tabs');

      // Set up navigateTab handlers with connection-specific markers
      const setupNavHandler = (ws: WebSocket, marker: string) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.method === 'browser.navigateTab' && msg.id !== undefined) {
              ws.send(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: msg.id,
                  result: { navigated: marker },
                }),
              );
            }
          } catch {
            // Ignore
          }
        });
      };
      setupNavHandler(wsAlpha, 'alpha');
      setupNavHandler(wsBeta, 'beta');

      // Call with alpha's tabId — should route to alpha
      const result = await mcpClient.callTool('browser_navigate_tab', {
        tabId: 1001,
        url: 'https://example.com',
      });
      expect(result.isError).toBe(false);
      expect(result.content).toContain('alpha');
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('browser tool with unknown tabId falls back gracefully', async ({ mcpServer, mcpClient }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');
      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Set up handleListTabs
      const handleListTabs = (ws: WebSocket, fakeTabs: Array<Record<string, unknown>>) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.method === 'browser.listTabs' && msg.id !== undefined) {
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: fakeTabs }));
            }
          } catch {
            // Ignore
          }
        });
      };

      handleListTabs(wsAlpha, [
        { id: 1001, title: 'Alpha Tab', url: 'http://localhost/alpha', active: true, windowId: 1 },
      ]);
      handleListTabs(wsBeta, [
        { id: 2001, title: 'Beta Tab', url: 'http://localhost/beta', active: true, windowId: 2 },
      ]);

      await mcpClient.callTool('browser_list_tabs');

      // Set up getTabContent handlers on both — either could respond for the unknown tab
      const setupGetTabContentHandler = (ws: WebSocket, marker: string) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.method === 'browser.getTabContent' && msg.id !== undefined) {
              ws.send(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: msg.id,
                  result: { content: `fallback-from-${marker}`, title: 'Test', url: 'http://test' },
                }),
              );
            }
          } catch {
            // Ignore
          }
        });
      };
      setupGetTabContentHandler(wsAlpha, 'alpha');
      setupGetTabContentHandler(wsBeta, 'beta');

      // Call with an unknown tabId (9999) — should fall back to some connection, not crash
      const result = await mcpClient.callTool('browser_get_tab_content', { tabId: 9999 });
      expect(result.isError).toBe(false);
      // The result should contain a marker from either connection (we don't know which one)
      expect(result.content).toMatch(/fallback-from-(alpha|beta)/);
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('after disconnect, browser tools targeting remaining connection tabs still work', async ({
    mcpServer,
    mcpClient,
  }) => {
    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-beta');
      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Set up handleListTabs
      const handleListTabs = (ws: WebSocket, fakeTabs: Array<Record<string, unknown>>) => {
        ws.addEventListener('message', (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.method === 'browser.listTabs' && msg.id !== undefined) {
              ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: fakeTabs }));
            }
          } catch {
            // Ignore
          }
        });
      };

      handleListTabs(wsAlpha, [
        { id: 1001, title: 'Alpha Tab', url: 'http://localhost/alpha', active: true, windowId: 1 },
      ]);
      handleListTabs(wsBeta, [
        { id: 2001, title: 'Beta Tab', url: 'http://localhost/beta', active: true, windowId: 2 },
      ]);

      await mcpClient.callTool('browser_list_tabs');

      // Set up getTabContent handler on beta
      wsBeta.addEventListener('message', (event: MessageEvent) => {
        try {
          const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (msg.method === 'browser.getTabContent' && msg.id !== undefined) {
            wsBeta?.send(
              JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                result: { content: 'content-from-beta-after-disconnect', title: 'Test', url: 'http://test' },
              }),
            );
          }
        } catch {
          // Ignore
        }
      });

      // Disconnect alpha
      wsAlpha.close();
      wsAlpha = undefined;
      await mcpServer.waitForHealth(h => h.extensionConnections <= 1, 10_000);

      // Repopulate browserTabOwnership with only beta's tabs
      // Set up listTabs handler again since we need a fresh call
      // (beta already has its handler from above)
      const listResult = await mcpClient.callTool('browser_list_tabs');
      expect(listResult.isError).toBe(false);

      // Call browser_get_tab_content with beta's tabId — should still work
      const result = await mcpClient.callTool('browser_get_tab_content', { tabId: 2001 });
      expect(result.isError).toBe(false);
      expect(result.content).toContain('content-from-beta-after-disconnect');
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('disconnecting one connection mid-dispatch returns error within 5s, other stays functional', async ({
    mcpServer,
    mcpClient,
  }) => {
    test.slow();

    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-dispatch-alpha');
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-dispatch-beta');
      await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);

      // Register tabs from each connection so dispatches can be routed
      sendJsonRpc(wsAlpha, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 6001, url: 'http://localhost/dispatch-alpha', title: 'Dispatch Alpha', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      mcpServer.logs.length = 0;
      sendJsonRpc(wsBeta, 'tab.syncAll', {
        tabs: {
          'e2e-test': {
            state: 'ready',
            tabs: [{ tabId: 6002, url: 'http://localhost/dispatch-beta', title: 'Dispatch Beta', ready: true }],
          },
        },
      });
      await waitForLog(mcpServer, 'tab.syncAll received', 5_000);

      // Set up Beta to respond to tool.dispatch messages with a successful echo
      wsBeta.addEventListener('message', (event: MessageEvent) => {
        try {
          const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (msg.method === 'tool.dispatch' && msg.id !== undefined) {
            const params = msg.params as Record<string, unknown> | undefined;
            const input = (params?.input as Record<string, unknown>) ?? {};
            wsBeta?.send(
              JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                result: { message: input.message ?? 'beta-response' },
              }),
            );
          }
        } catch {
          // Ignore non-JSON
        }
      });

      // Alpha intentionally does NOT handle tool.dispatch — leaving dispatches pending.

      // Fire a tool dispatch targeting Alpha's tab (6001) — don't await yet
      const dispatchStart = Date.now();
      const alphaDispatch = mcpClient.callTool('e2e-test_echo', { message: 'alpha-test', tabId: 6001 });

      // Wait 500ms for the dispatch to be sent to Alpha, then disconnect Alpha
      await new Promise(r => setTimeout(r, 500));
      wsAlpha.close();
      wsAlpha = undefined;

      // The dispatch must resolve with an error within 5s of disconnect
      const result = await alphaDispatch;
      const elapsed = Date.now() - dispatchStart;

      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/disconnect|Extension disconnected/i);
      // 5s bound: dispatch should resolve quickly after disconnect, not wait 30s timeout
      expect(elapsed).toBeLessThan(6_000);

      // Verify Beta is still functional by dispatching a tool call targeting Beta's tab
      const betaResult = await mcpClient.callTool('e2e-test_echo', { message: 'beta-alive', tabId: 6002 });
      expect(betaResult.isError).toBe(false);
      expect(betaResult.content).toContain('beta-alive');
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });

  test('health endpoint shows extensionConnections count accurately', async ({ mcpServer }) => {
    // Initially no connections
    const h0 = await mcpServer.health();
    expect(h0).not.toBeNull();
    if (!h0) return;
    expect(h0.extensionConnected).toBe(false);
    expect(h0.extensionConnections).toBe(0);

    let wsAlpha: WebSocket | undefined;
    let wsBeta: WebSocket | undefined;
    try {
      // Add first connection
      wsAlpha = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-count-a');
      const h1 = await mcpServer.waitForHealth(h => h.extensionConnections >= 1, 10_000);
      expect(h1.extensionConnections).toBeGreaterThanOrEqual(1);
      expect(h1.extensionConnected).toBe(true);

      // Add second connection
      wsBeta = await createRawWsConnection(mcpServer.port, mcpServer.secret, 'conn-count-b');
      const h2 = await mcpServer.waitForHealth(h => h.extensionConnections >= 2, 10_000);
      expect(h2.extensionConnections).toBeGreaterThanOrEqual(2);

      // Close first connection
      wsAlpha.close();
      wsAlpha = undefined;

      // Should drop to at least 1
      const h3 = await mcpServer.waitForHealth(h => h.extensionConnections <= 1, 10_000);
      expect(h3.extensionConnections).toBeLessThanOrEqual(1);
      expect(h3.extensionConnected).toBe(true);

      // Close second
      wsBeta.close();
      wsBeta = undefined;

      // Should be 0
      const h4 = await mcpServer.waitForHealth(h => h.extensionConnections === 0, 10_000);
      expect(h4.extensionConnected).toBe(false);
      expect(h4.extensionConnections).toBe(0);
    } finally {
      wsAlpha?.close();
      wsBeta?.close();
    }
  });
});
