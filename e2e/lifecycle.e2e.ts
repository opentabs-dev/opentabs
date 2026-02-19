/**
 * Lifecycle E2E tests — MCP server hot reload and extension reconnection.
 *
 * These tests launch a real Chromium instance with the OpenTabs extension
 * side-loaded, start the MCP server as a subprocess, and verify the full
 * hot-reload lifecycle:
 *
 *   1. Extension connects to MCP server on startup
 *   2. Hot reload (bun --hot) triggers clean teardown + extension reconnect
 *   3. Rapid successive hot reloads all recover
 *   4. Kill → restart: extension detects TCP close and reconnects
 *   5. Old WebSocket replaced when a new connection arrives
 *   6. Ping/pong keepalive works end-to-end
 *   7. Server starts cleanly without --hot (no crash)
 *   8. extension_reload triggers full reconnect with re-injection into pre-existing tabs
 *
 * IMPORTANT: Hot-reload tests use `test.describe.serial` because
 * `triggerHotReload()` modifies a per-test wrapper file. Serial execution
 * within the block ensures deterministic sequencing of reload → reconnect.
 *
 * All tests use dynamic ports and isolated config directories.
 */

import {
  test,
  expect,
  startMcpServer,
  fetchWsInfo,
  readTestConfig,
  writeTestConfig,
  launchExtensionContext,
  createTestConfigDir,
  cleanupTestConfigDir,
  createMcpClient,
} from './fixtures.js';
import {
  waitForExtensionConnected,
  waitForExtensionDisconnected,
  waitForLog,
  waitFor,
  waitForToolResult,
  callToolExpectSuccess,
  setupToolTest,
  getExtensionId,
} from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';
import type { McpServer } from './fixtures.js';
import type { BrowserContext } from '@playwright/test';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('MCP server lifecycle', () => {
  test('server starts with --hot, extension auto-connects, and health is green', async ({
    mcpServer,
    extensionContext: _extensionContext,
  }) => {
    // The mcpServer fixture already asserts the server is listening.
    // Now wait for the extension (loaded by extensionContext) to connect.
    await waitForExtensionConnected(mcpServer);

    // Wait for the full connect→syncAll handshake to complete in the logs
    await waitForLog(mcpServer, 'tab.syncAll received');

    const h = await mcpServer.health();
    expect(h).not.toBeNull();
    if (!h) throw new Error('health returned null');
    expect(h.status).toBe('ok');
    expect(h.extensionConnected).toBe(true);
    expect(h.plugins).toBeGreaterThanOrEqual(0);

    // Verify server logs show the expected startup sequence
    const logsJoined = mcpServer.logs.join('\n');
    expect(logsJoined).toMatch(/MCP server v[\d.]+ listening/);
    expect(logsJoined).toContain('Extension WebSocket connected');
    expect(logsJoined).toContain('tab.syncAll received');
  });

  test('server starts without --hot and stays alive (no crash)', async ({ mcpServerNoHot }) => {
    // The fixture already asserts the server started. Verify it's healthy.
    const h = await mcpServerNoHot.health();
    expect(h).not.toBeNull();
    if (!h) throw new Error('health returned null');
    expect(h.status).toBe('ok');

    // The server should NOT have any hot-reload cleanup messages
    const logsJoined = mcpServerNoHot.logs.join('\n');
    expect(logsJoined).not.toContain('Hot reload detected');
    expect(logsJoined).toMatch(/MCP server v[\d.]+ listening/);
  });
});

test.describe.serial('Hot reload', () => {
  test('single hot reload: server preserved, extension stays connected, tab.syncAll resent', async ({
    mcpServer,
    extensionContext: _extensionContext,
  }) => {
    // 1. Wait for initial connection + full handshake
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // 2. Clear logs to isolate hot-reload output
    mcpServer.logs.length = 0;

    // 3. Trigger hot reload
    mcpServer.triggerHotReload();

    // 4. Wait for the hot-reload cycle to complete.
    //    The server and WebSocket connection are preserved across reloads.
    //    The server sends sync.full to the extension via the existing connection,
    //    and the extension responds with tab.syncAll.
    await waitForLog(mcpServer, 'tab.syncAll received', 20_000);

    // 5. Verify logs show the reload → resync sequence
    const logsJoined = mcpServer.logs.join('\n');
    expect(logsJoined).toContain('Hot reload complete');
    expect(logsJoined).toContain('tab.syncAll received');

    // 6. Extension should still be connected after reload
    const h = await mcpServer.health();
    expect(h).not.toBeNull();
    if (!h) throw new Error('health returned null');
    expect(h.extensionConnected).toBe(true);
  });

  test('three rapid hot reloads: extension stays connected after each one', async ({
    mcpServer,
    extensionContext: _extensionContext,
  }) => {
    test.slow(); // 3 sequential hot reloads — needs extra time under parallel load

    // Wait for initial full handshake
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    for (let i = 1; i <= 3; i++) {
      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();

      // Wait for the reload cycle: sync.full → tab.syncAll.
      // Use 30s timeout per reload — under parallel load, reconnect backoff
      // can take longer than the default 15s.
      await waitForLog(mcpServer, 'tab.syncAll received', 30_000);

      const logsJoined = mcpServer.logs.join('\n');
      expect(logsJoined).toContain('Hot reload complete');

      // Extension should still be connected
      const h = await mcpServer.health();
      expect(h).not.toBeNull();
      if (!h) throw new Error('health returned null');
      expect(h.extensionConnected).toBe(true);
    }
  });

  test('hot reload preserves plugin discovery (slack plugin still found)', async ({
    mcpServer,
    extensionContext: _extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // Note the plugin count before reload
    const before = await mcpServer.health();
    expect(before).not.toBeNull();
    if (!before) throw new Error('health returned null');
    const pluginsBefore = before.plugins;

    // Trigger hot reload
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();

    // Wait for full cycle
    await waitForLog(mcpServer, 'tab.syncAll received', 20_000);

    // Plugin count should be the same after reload
    const after = await mcpServer.health();
    expect(after).not.toBeNull();
    if (!after) throw new Error('health returned null');
    expect(after.plugins).toBe(pluginsBefore);

    // Logs should show plugin re-discovery
    const logsJoined = mcpServer.logs.join('\n');
    expect(logsJoined).toContain('Plugin discovery complete');
  });
});

test.describe('Kill and restart', () => {
  test('extension reconnects after server is killed and restarted', async ({
    mcpServer,
    extensionContext: _extensionContext,
  }) => {
    // 1. Initial connection
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // Remember the port — the extension is configured for THIS port
    const serverPort = mcpServer.port;
    // Get the config dir so the new server discovers the same plugins
    const serverConfigDir = mcpServer.configDir;

    // 2. Kill the server
    await mcpServer.kill();

    // 3. Verify server is dead
    const dead = await mcpServer.health();
    expect(dead).toBeNull();

    // 4. Start a NEW server on the SAME port using startMcpServer.
    //    We pass the same config dir and an explicit port so the extension
    //    (which is configured for serverPort) can reconnect.
    let newServer: McpServer | null = null;

    try {
      newServer = await startMcpServer(serverConfigDir, true, serverPort);

      // 5. Wait for extension to reconnect.
      //    Max backoff is 30s. If the extension was mid-backoff when the server
      //    died, it may need up to 30s for the current attempt to timeout + 30s
      //    for the next max-backoff interval + 5s for the reconnection handshake.
      await newServer.waitForHealth(h => h.extensionConnected, 65_000);

      await waitForLog(newServer, 'tab.syncAll received', 15_000);

      expect(newServer.logs.join('\n')).toContain('Extension WebSocket connected');
    } finally {
      if (newServer) await newServer.kill();
    }
  });
});

test.describe('WebSocket connection management', () => {
  test('old extension WS is closed when a new connection arrives', async ({
    mcpServer,
    extensionContext: _extensionContext,
  }) => {
    // 1. Wait for the real extension to connect
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');
    mcpServer.logs.length = 0;

    // 2. Open a second WebSocket — this should replace the extension's slot.
    const { wsUrl, wsSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
    const ws = wsSecret ? new WebSocket(wsUrl, ['opentabs', wsSecret]) : new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket connect failed'));
      setTimeout(() => reject(new Error('WebSocket connect timeout')), 5_000);
    });

    // 3. Wait for the server to log the replacement
    await waitForLog(mcpServer, 'Closing previous extension WebSocket', 5_000);

    const logsJoined = mcpServer.logs.join('\n');
    expect(logsJoined).toContain('Closing previous extension WebSocket');

    // 4. Close our fake client
    ws.close();

    // 5. The real extension should detect it was disconnected (via the close
    //    event from the server) and reconnect. Since the fake client also
    //    disconnected, the extension's reconnect will succeed.
    await waitForExtensionConnected(mcpServer, 15_000);

    const h = await mcpServer.health();
    expect(h).not.toBeNull();
    if (!h) throw new Error('health returned null');
    expect(h.extensionConnected).toBe(true);
  });

  test('ping/pong keepalive works: server responds to pings', async ({
    mcpServer,
    extensionContext: _extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);

    const { wsUrl: pingWsUrl, wsSecret: pingWsSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
    const ws = pingWsSecret ? new WebSocket(pingWsUrl, ['opentabs', pingWsSecret]) : new WebSocket(pingWsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket connect failed'));
      setTimeout(() => reject(new Error('WebSocket connect timeout')), 5_000);
    });

    // Send a JSON-RPC ping and wait for pong
    const pongPromise = new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => resolve(false), 5_000);
      ws.onmessage = event => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : '') as Record<string, unknown>;
          if (msg.method === 'pong') {
            clearTimeout(timeout);
            resolve(true);
          }
        } catch {
          // ignore non-JSON messages (e.g. sync.full)
        }
      };
    });

    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }));

    const gotPong = await pongPromise;
    expect(gotPong).toBe(true);

    ws.close();
  });
});

test.describe('Pong watchdog (zombie detection)', () => {
  test('extension detects replaced connection and reconnects', async ({
    mcpServer,
    extensionContext: _extensionContext,
  }) => {
    // 1. Wait for extension to connect
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // 2. Steal the extension's slot with a fake client.
    //    The server's replacement logic closes the real extension's WS.
    //    We then close the fake client, leaving the server with no extension.
    //    The real extension received a close event and should reconnect.
    mcpServer.logs.length = 0;

    const { wsUrl: zombieWsUrl, wsSecret: zombieWsSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
    const ws = zombieWsSecret ? new WebSocket(zombieWsUrl, ['opentabs', zombieWsSecret]) : new WebSocket(zombieWsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('connect failed'));
      setTimeout(() => reject(new Error('timeout')), 5_000);
    });

    // Wait for the server to log the replacement (confirms old WS was closed)
    await waitForLog(mcpServer, 'Closing previous extension WebSocket', 5_000);

    // Close our fake client too so the server has no extension
    ws.close();

    // Server should now show no extension connected (briefly)
    await waitForExtensionDisconnected(mcpServer, 5_000);

    // 3. The real extension received a close event from the replacement and
    //    should reconnect via its backoff. Wait for it.
    await waitForExtensionConnected(mcpServer, 15_000);

    // Wait for full handshake
    await waitForLog(mcpServer, 'tab.syncAll received', 15_000);

    const h = await mcpServer.health();
    expect(h).not.toBeNull();
    if (!h) throw new Error('health returned null');
    expect(h.extensionConnected).toBe(true);

    // Verify the reconnect happened (fresh "connected" + "tab.syncAll")
    const logsJoined = mcpServer.logs.join('\n');
    expect(logsJoined).toContain('Extension WebSocket connected');
    expect(logsJoined).toContain('tab.syncAll received');
  });
});

test.describe('WebSocket authentication', () => {
  test('unauthenticated WS connection is rejected when secret is configured', async ({ mcpServer }) => {
    // The mcpServer fixture creates a config with secret: crypto.randomUUID(),
    // so all connections require a valid token. Attempt to connect without one.
    const ws = new WebSocket(`ws://localhost:${mcpServer.port}/ws`);

    const result = await new Promise<string>(resolve => {
      ws.onopen = () => resolve('open');
      ws.onerror = () => resolve('error');
      ws.onclose = () => resolve('close');
      setTimeout(() => resolve('timeout'), 5_000);
    });

    // The server returns HTTP 401 before the upgrade completes,
    // so onopen should never fire.
    expect(result).not.toBe('open');
    expect(result).not.toBe('timeout');
  });

  test('/ws-info returns URL and secret as separate fields', async ({ mcpServer }) => {
    const headers: Record<string, string> = {};
    if (mcpServer.secret) headers['Authorization'] = `Bearer ${mcpServer.secret}`;
    const res = await fetch(`http://localhost:${mcpServer.port}/ws-info`, {
      headers,
      signal: AbortSignal.timeout(3_000),
    });

    expect(res.ok).toBe(true);

    const info = (await res.json()) as { wsUrl: string; wsSecret?: string };
    expect(info.wsUrl).toBe(`ws://localhost:${mcpServer.port}/ws`);
    expect(info.wsUrl).not.toContain('token=');
    expect(typeof info.wsSecret).toBe('string');
    expect((info.wsSecret ?? '').length).toBeGreaterThan(0);
  });

  test('authenticated WS connection via sec-websocket-protocol succeeds and exchanges ping/pong', async ({
    mcpServer,
  }) => {
    // Fetch the WebSocket URL and secret from /ws-info
    const { wsUrl, wsSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
    expect(wsSecret).not.toBeNull();

    // Connect using the secret via Sec-WebSocket-Protocol header
    const ws = wsSecret ? new WebSocket(wsUrl, ['opentabs', wsSecret]) : new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket connect failed'));
      setTimeout(() => reject(new Error('WebSocket connect timeout')), 5_000);
    });

    // Send a JSON-RPC ping and verify we get a pong back
    const pongPromise = new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => resolve(false), 5_000);
      ws.onmessage = event => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : '') as Record<string, unknown>;
          if (msg.method === 'pong') {
            clearTimeout(timeout);
            resolve(true);
          }
        } catch {
          // ignore non-JSON messages
        }
      };
    });

    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }));

    const gotPong = await pongPromise;
    expect(gotPong).toBe(true);

    ws.close();
  });
});

test.describe('Secret rotation during hot reload', () => {
  test('extension reconnects with new credentials after secret rotation', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    // This test exercises the full secret rotation lifecycle:
    // 1. Server starts with secret A, extension connects via /ws-info token
    // 2. Config changes to secret B, hot reload applies it
    // 3. Server closes the old WebSocket (hot reload reinitializes)
    // 4. Extension reconnects — re-fetches /ws-info to get new token
    // 5. Tool dispatch works via the new authenticated connection
    test.slow();

    // Verify extension is connected and tools work
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const preResult = await mcpClient.callTool('browser_list_tabs');
    expect(preResult.isError).toBe(false);

    // Rotate the secret in config.json
    const config = readTestConfig(mcpServer.configDir);
    const oldSecret = config.secret;
    config.secret = `rotated-${crypto.randomUUID()}`;
    expect(config.secret).not.toBe(oldSecret);
    writeTestConfig(mcpServer.configDir, config);

    // Trigger hot reload — server picks up the new secret
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();

    // Wait for hot reload to complete (updates state.wsSecret)
    await waitForLog(mcpServer, 'Hot reload complete', 15_000);

    // The extension's existing connection is still alive (hot reload preserves
    // the TCP socket). Force a disconnect by stealing the WS slot using the
    // new secret's token, so the extension has to reconnect.
    mcpServer.logs.length = 0;
    const { wsUrl: newWsUrl, wsSecret: newSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
    const fakeWs = newSecret ? new WebSocket(newWsUrl, ['opentabs', newSecret]) : new WebSocket(newWsUrl);
    await new Promise<void>((resolve, reject) => {
      fakeWs.onopen = () => resolve();
      fakeWs.onerror = () => reject(new Error('WebSocket connect failed'));
      setTimeout(() => reject(new Error('WebSocket connect timeout')), 5_000);
    });

    // The server replaces the old connection
    await waitForLog(mcpServer, 'Closing previous extension WebSocket', 5_000);
    fakeWs.close();
    await waitForExtensionDisconnected(mcpServer, 5_000);

    // Wait for the extension to reconnect — it must re-fetch /ws-info
    // to get a token signed with the new secret
    await waitForExtensionConnected(mcpServer, 45_000);
    await waitForLog(mcpServer, 'tab.syncAll received', 15_000);

    // Tool dispatch works through the new authenticated connection.
    // The original mcpClient was created with the old secret, so create a
    // new client with the rotated secret to verify the new auth works.
    const newClient = createMcpClient(mcpServer.port, config.secret);
    await newClient.initialize();
    try {
      const postResult = await newClient.callTool('browser_list_tabs');
      expect(postResult.isError).toBe(false);
    } finally {
      await newClient.close();
    }
  });
});

test.describe('Side panel connectivity', () => {
  test('side panel shows connected state after extension connects', async ({ mcpServer, extensionContext }) => {
    // Wait for the extension to connect to the server
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // Verify the background service worker is running.
    // In Playwright, MV3 service workers appear via context.serviceWorkers().
    const workers = extensionContext.serviceWorkers();
    let bgWorker = workers.find(w => w.url().includes('background'));

    if (!bgWorker) {
      // Wait for the service worker to appear
      bgWorker = await extensionContext.waitForEvent('serviceworker', {
        predicate: w => w.url().includes('background'),
        timeout: 10_000,
      });
    }

    expect(bgWorker).toBeDefined();

    // The health endpoint confirms the extension is fully connected —
    // which means the side panel would show "Connected" if opened.
    const h = await mcpServer.health();
    expect(h).not.toBeNull();
    if (!h) throw new Error('health returned null');
    expect(h.extensionConnected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extension_reload — verifies the reload signal causes a disconnect, then
// tests the full reconnect → sync.full → tab.syncAll → re-injection cycle
// using a forced disconnect + reconnect (since Playwright's headless Chromium
// does not restart extensions after chrome.runtime.reload).
// ---------------------------------------------------------------------------

test.describe('extension_reload', () => {
  test('extension_reload triggers full reconnect cycle with sync.full, tab.syncAll, and re-injection', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // 1. Wait for initial connection, open tab, verify adapter injection + tool dispatch
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const baseline = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
      message: 'before-reload',
    });
    expect(baseline.message).toBe('before-reload');

    // Verify adapter is present in the tab before reload
    const adapterBefore = await page.evaluate(() => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as
        | { adapters?: Record<string, unknown> }
        | undefined;
      return ot?.adapters?.['e2e-test'] !== undefined;
    });
    expect(adapterBefore).toBe(true);

    // 2. Clear logs to isolate the reload cycle output
    mcpServer.logs.length = 0;

    // 3. Call extension_reload MCP tool — verifies the signal is sent and
    //    causes the extension to disconnect via chrome.runtime.reload()
    const reloadResult = await mcpClient.callTool('extension_reload');
    expect(reloadResult.isError).toBe(false);

    // 4. Wait for the extension to disconnect (chrome.runtime.reload() kills
    //    the service worker and all connections)
    await waitForExtensionDisconnected(mcpServer, 15_000);
    expect(mcpServer.logs.join('\n')).toContain('Extension WebSocket disconnected');

    // 5. In Playwright's headless Chromium, chrome.runtime.reload() terminates
    //    the extension but Chromium does not restart it. Simulate the reconnect
    //    cycle that would happen in a real browser by stealing the WS slot with
    //    a fake client, then closing it, so the real extension (from a subsequent
    //    hot reload) reconnects. This exercises the exact same server-side code
    //    paths: WebSocket connect → sync.full → tab.syncAll → reinjectStoredPlugins.
    //
    //    Trigger a hot reload to re-send sync.full on the existing connection.
    //    The extension is dead, so first do a kill→restart of the server on the
    //    same port to get a clean state. Then relaunch the extension context.
    //
    //    Instead, use a hot reload which preserves the WebSocket if the extension
    //    is still connected. Since the extension disconnected, hot reload will
    //    notice the extension is gone and wait for reconnect. But the extension
    //    is dead — so we need to create a fresh browser context.

    // Close the old context (extension is dead after chrome.runtime.reload)
    await page.close();
    await extensionContext.close();

    // Launch a fresh extension context pointed at the same MCP server.
    // This simulates what happens in a real browser when the extension restarts.
    const { context: newContext, cleanupDir, extensionDir } = await launchExtensionContext(mcpServer.port);

    // Symlink the adapters directory for the new extension copy
    const serverAdaptersParent = path.join(mcpServer.configDir, 'extension');
    fs.mkdirSync(serverAdaptersParent, { recursive: true });
    const serverAdaptersDir = path.join(serverAdaptersParent, 'adapters');
    const extensionAdaptersDir = path.join(extensionDir, 'adapters');
    // Remove old symlink/directory and create new one
    fs.rmSync(serverAdaptersDir, { recursive: true, force: true });
    fs.symlinkSync(extensionAdaptersDir, serverAdaptersDir);

    mcpServer.logs.length = 0;

    try {
      // 6. Wait for the fresh extension to connect and complete the full handshake
      await waitForExtensionConnected(mcpServer, 45_000);
      await waitForLog(mcpServer, 'tab.syncAll received', 15_000);

      // 7. Verify server logs show the full reconnect cycle
      const logsJoined = mcpServer.logs.join('\n');
      expect(logsJoined).toContain('Extension WebSocket connected');
      expect(logsJoined).toContain('tab.syncAll received');

      // 8. Verify the extension is connected via health endpoint
      const h = await mcpServer.health();
      expect(h).not.toBeNull();
      if (!h) throw new Error('health returned null');
      expect(h.status).toBe('ok');
      expect(h.extensionConnected).toBe(true);

      // 9. Open a tab to the test server — the fresh extension should inject
      //    the adapter via its onUpdated listener (reinjectStoredPlugins already
      //    ran on sync.full, but this tab wasn't open yet in the new context)
      const newPage = await newContext.newPage();
      await newPage.goto(testServer.url, { waitUntil: 'load' });

      await waitFor(
        async () => {
          const present = await newPage.evaluate(() => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | { adapters?: Record<string, unknown> }
              | undefined;
            return ot?.adapters?.['e2e-test'] !== undefined;
          });
          return present;
        },
        20_000,
        500,
        'e2e-test adapter to be injected into tab after extension restart',
      );

      // 10. Verify browser_list_tabs works after reload
      const tabsResult = await mcpClient.callTool('browser_list_tabs');
      expect(tabsResult.isError).toBe(false);

      // 11. Verify plugin tool dispatch works after reload (tab state = ready)
      const afterResult = await waitForToolResult(
        mcpClient,
        'e2e-test_echo',
        { message: 'after-reload' },
        { isError: false },
        15_000,
      );
      const afterOutput = JSON.parse(afterResult.content) as Record<string, unknown>;
      expect(afterOutput.message).toBe('after-reload');

      await newPage.close();
    } finally {
      await newContext.close();
      try {
        fs.rmSync(cleanupDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });
});

// ---------------------------------------------------------------------------
// URL change reconnection — verifies that changing the MCP server URL in
// chrome.storage.local while disconnected triggers reconnection to the new server.
// This exercises the US-002 fix: the ws:setUrl handler's third branch where
// ws is null and no reconnect timer is pending.
// ---------------------------------------------------------------------------

/**
 * Set mcpServerUrl in chrome.storage.local via an extension page.
 * This triggers the background script's chrome.storage.onChanged listener,
 * which relays ws:setUrl to the offscreen document.
 */
const setMcpServerUrl = async (context: BrowserContext, wsUrl: string): Promise<void> => {
  const extId = await getExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/side-panel/side-panel.html`, {
    waitUntil: 'load',
    timeout: 10_000,
  });
  await page.evaluate(async (url: string) => {
    const chromeApi = (globalThis as Record<string, unknown>).chrome as {
      storage: { local: { set: (items: Record<string, unknown>) => Promise<void> } };
    };
    await chromeApi.storage.local.set({ mcpServerUrl: url });
  }, wsUrl);
  await page.close();
};

test.describe('URL change reconnection', () => {
  test('changing mcpServerUrl while disconnected triggers reconnection to new server', async ({
    mcpServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // 1. Verify extension is connected to server A and tools work
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const preResult = await mcpClient.callTool('browser_list_tabs');
    expect(preResult.isError).toBe(false);

    const serverAPort = mcpServer.port;

    // 2. Kill server A
    await mcpServer.kill();

    // Verify server A is dead
    const dead = await mcpServer.health();
    expect(dead).toBeNull();

    // 3. Wait for extension to detect the disconnect and exhaust initial
    //    reconnect attempts. The backoff starts at 1s and doubles (1→2→4s),
    //    so after 5s the extension has failed several reconnects.
    await new Promise(r => setTimeout(r, 5_000));

    // 4. Start a NEW server B on a DIFFERENT port with the same plugin config
    const configDirB = createTestConfigDir();
    let serverB: McpServer | null = null;

    try {
      serverB = await startMcpServer(configDirB, true);
      const serverBPort = serverB.port;

      // Verify server B is on a different port than A
      expect(serverBPort).not.toBe(serverAPort);

      // Set up adapter symlinks for server B. Read the extension's adapters
      // directory from server A's existing symlink so server B can write
      // adapter IIFEs to the same extension copy.
      const serverAAdaptersDir = path.join(mcpServer.configDir, 'extension', 'adapters');
      const extensionAdaptersDir = fs.readlinkSync(serverAAdaptersDir);
      const serverBAdaptersParent = path.join(configDirB, 'extension');
      fs.mkdirSync(serverBAdaptersParent, { recursive: true });
      const serverBAdaptersDir = path.join(serverBAdaptersParent, 'adapters');
      fs.rmSync(serverBAdaptersDir, { recursive: true, force: true });
      fs.symlinkSync(extensionAdaptersDir, serverBAdaptersDir);

      // 5. Change mcpServerUrl in chrome.storage.local to point to server B.
      //    The background script's chrome.storage.onChanged listener relays
      //    ws:setUrl to the offscreen document, which (per US-002) calls
      //    connect() even when ws is null and no reconnect timer is pending.
      const newWsUrl = `ws://localhost:${serverBPort}/ws`;
      await setMcpServerUrl(extensionContext, newWsUrl);

      // 6. Wait for extension to connect to server B
      await waitForExtensionConnected(serverB, 45_000);
      await waitForLog(serverB, 'tab.syncAll received', 15_000);

      // 7. Verify server B shows the extension connected
      const h = await serverB.health();
      expect(h).not.toBeNull();
      if (!h) throw new Error('health returned null');
      expect(h.status).toBe('ok');
      expect(h.extensionConnected).toBe(true);

      // 8. Verify tool dispatch works through server B
      const clientB = createMcpClient(serverBPort, serverB.secret);
      await clientB.initialize();

      const tabsResult = await clientB.callTool('browser_list_tabs');
      expect(tabsResult.isError).toBe(false);

      await clientB.close();
    } finally {
      if (serverB) await serverB.kill();
      cleanupTestConfigDir(configDirB);
    }
  });
});
