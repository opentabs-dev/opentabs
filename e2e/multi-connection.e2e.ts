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
