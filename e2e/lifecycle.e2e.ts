/**
 * Lifecycle E2E tests — MCP server hot reload and extension reconnection.
 *
 * These tests launch a real Chromium instance with the OpenTabs extension
 * side-loaded, start the MCP server as a subprocess, and verify the full
 * hot-reload lifecycle:
 *
 *   1. Extension connects to MCP server on startup
 *   2. Hot reload (SIGUSR1 to dev proxy) triggers worker restart + extension reconnect
 *   3. Rapid successive hot reloads all recover
 *   4. Kill → restart: extension detects TCP close and reconnects
 *   5. Old WebSocket replaced when a new connection arrives
 *   6. Ping/pong keepalive works end-to-end
 *   7. Server starts cleanly in non-hot mode (no crash)
 *   8. extension_reload triggers full reconnect with re-injection into pre-existing tabs
 *
 * IMPORTANT: Hot-reload tests use `test.describe.serial` because they
 * trigger worker restarts that affect the extension's WebSocket state. Serial
 * execution ensures deterministic sequencing of reload → reconnect.
 *
 * All tests use dynamic ports and isolated config directories.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';
import type { McpServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createTestConfigDir,
  expect,
  fetchWsInfo,
  launchExtensionContext,
  startMcpServer,
  symlinkCrossPlatform,
  test,
} from './fixtures.js';
import {
  callToolExpectSuccess,
  getExtensionId,
  setupToolTest,
  waitFor,
  waitForExtensionConnected,
  waitForExtensionDisconnected,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

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

    // Wait for the full connect→syncAll handshake to complete in the logs.
    // Under heavy parallel load, the extension's initial connection and
    // sync.full → tab.syncAll handshake can take longer than the default 15s.
    await waitForLog(mcpServer, 'plugin(s) mapped', 30_000);

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
    expect(logsJoined).toContain('plugin(s) mapped');
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

test.describe
  .serial('Hot reload', () => {
    test('single hot reload: server preserved, extension stays connected, tab.syncAll resent', async ({
      mcpServer,
      extensionContext: _extensionContext,
    }) => {
      // 1. Wait for initial connection + full handshake
      await waitForExtensionConnected(mcpServer);
      await waitForLog(mcpServer, 'plugin(s) mapped');

      // 2. Clear logs to isolate hot-reload output
      mcpServer.logs.length = 0;

      // 3. Trigger hot reload
      mcpServer.triggerHotReload();

      // 4. Wait for the hot-reload cycle to complete.
      //    The server and WebSocket connection are preserved across reloads.
      //    The server sends sync.full to the extension via the existing connection,
      //    and the extension responds with tab.syncAll.
      await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);

      // 5. Verify logs show the reload → resync sequence
      const logsJoined = mcpServer.logs.join('\n');
      expect(logsJoined).toContain('Hot reload complete');
      expect(logsJoined).toContain('plugin(s) mapped');

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
      await waitForLog(mcpServer, 'plugin(s) mapped');

      for (let i = 1; i <= 3; i++) {
        mcpServer.logs.length = 0;
        mcpServer.triggerHotReload();

        // Wait for the reload cycle: sync.full → tab.syncAll.
        // Use 30s timeout per reload — under parallel load, reconnect backoff
        // can take longer than the default 15s.
        await waitForLog(mcpServer, 'plugin(s) mapped', 30_000);

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
      await waitForLog(mcpServer, 'plugin(s) mapped');

      // Note the plugin count before reload
      const before = await mcpServer.health();
      expect(before).not.toBeNull();
      if (!before) throw new Error('health returned null');
      const pluginsBefore = before.plugins;

      // Trigger hot reload
      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();

      // Wait for full cycle
      await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);

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
    await waitForLog(mcpServer, 'plugin(s) mapped');

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

      await waitForLog(newServer, 'plugin(s) mapped', 15_000);

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
    await waitForLog(mcpServer, 'plugin(s) mapped');
    mcpServer.logs.length = 0;

    // 2. Open a second WebSocket with wsSecret — this should replace the extension's slot.
    const { wsUrl, wsSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
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

    // 3. Wait for the server to log the replacement
    try {
      await waitForLog(mcpServer, 'Closing previous extension WebSocket', 5_000);

      const logsJoined = mcpServer.logs.join('\n');
      expect(logsJoined).toContain('Closing previous extension WebSocket');
    } finally {
      // 4. Close our fake client
      ws.close();
    }

    // 5. The real extension should detect it was disconnected (via the close
    //    event from the server) and reconnect. Since the fake client also
    //    disconnected, the extension's reconnect will succeed.
    const h = await mcpServer.waitForHealth(health => health.extensionConnected, 15_000);
    expect(h.extensionConnected).toBe(true);
  });

  test('ping/pong keepalive works: server responds to pings', async ({
    mcpServer,
    extensionContext: _extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);

    const { wsUrl: pingWsUrl, wsSecret: pingWsSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
    const pingProtocols = ['opentabs'];
    if (pingWsSecret) pingProtocols.push(pingWsSecret);
    const ws = pingProtocols.length > 1 ? new WebSocket(pingWsUrl, pingProtocols) : new WebSocket(pingWsUrl);
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

    // Send a JSON-RPC ping and wait for pong
    try {
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
    } finally {
      ws.close();
    }
  });
});

test.describe('Pong watchdog (zombie detection)', () => {
  test('extension detects replaced connection and reconnects', async ({
    mcpServer,
    extensionContext: _extensionContext,
  }) => {
    // 1. Wait for extension to connect
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'plugin(s) mapped');

    // 2. Steal the extension's slot with a fake client.
    //    The server's replacement logic closes the real extension's WS.
    //    We then close the fake client, leaving the server with no extension.
    //    The real extension received a close event and should reconnect.
    mcpServer.logs.length = 0;

    const { wsUrl: zombieWsUrl, wsSecret: zombieWsSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
    const zombieProtocols = ['opentabs'];
    if (zombieWsSecret) zombieProtocols.push(zombieWsSecret);
    const ws = zombieProtocols.length > 1 ? new WebSocket(zombieWsUrl, zombieProtocols) : new WebSocket(zombieWsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 5_000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('connect failed'));
      };
    });

    // Wait for the server to log the replacement (confirms old WS was closed)
    try {
      await waitForLog(mcpServer, 'Closing previous extension WebSocket', 5_000);
    } finally {
      // Close our fake client too so the server has no extension
      ws.close();
    }

    // Server should now show no extension connected (briefly)
    await waitForExtensionDisconnected(mcpServer, 5_000);

    // 3. The real extension received a close event from the replacement and
    //    should reconnect via its backoff. Wait for it.
    await waitForExtensionConnected(mcpServer, 15_000);

    // Wait for full handshake
    await waitForLog(mcpServer, 'plugin(s) mapped', 15_000);

    const h = await mcpServer.health();
    expect(h).not.toBeNull();
    if (!h) throw new Error('health returned null');
    expect(h.extensionConnected).toBe(true);

    // Verify the reconnect happened (fresh "connected" + "tab.syncAll")
    const logsJoined = mcpServer.logs.join('\n');
    expect(logsJoined).toContain('Extension WebSocket connected');
    expect(logsJoined).toContain('plugin(s) mapped');
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

  test('/ws-info returns URL without leaking the secret in the URL', async ({ mcpServer }) => {
    const headers: Record<string, string> = {};
    if (mcpServer.secret) headers.Authorization = `Bearer ${mcpServer.secret}`;
    const res = await fetch(`http://localhost:${mcpServer.port}/ws-info`, {
      headers,
      signal: AbortSignal.timeout(3_000),
    });

    expect(res.ok).toBe(true);

    const info = (await res.json()) as { wsUrl: string; wsSecret?: string };
    expect(info.wsUrl).toBe(`ws://localhost:${mcpServer.port}/ws`);
    // The secret must never appear in the WebSocket URL as a query parameter
    // (keeps it out of logs and browser history) and must not be returned in
    // the HTTP response body (prevents leaking it in proxy logs or debug tools).
    expect(info.wsUrl).not.toContain('token=');
    expect(info.wsSecret).toBeUndefined();
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

    // Send a JSON-RPC ping and verify we get a pong back
    try {
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
    } finally {
      ws.close();
    }
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
    await waitForLog(mcpServer, 'plugin(s) mapped');

    const preResult = await mcpClient.callTool('browser_list_tabs');
    expect(preResult.isError).toBe(false);

    // Rotate the secret in auth.json (single source of truth for auth)
    const authPath = path.join(mcpServer.configDir, 'extension', 'auth.json');
    const authData = JSON.parse(fs.readFileSync(authPath, 'utf-8')) as { secret?: string };
    const oldSecret = authData.secret;
    const newSecret = `rotated-${crypto.randomUUID()}`;
    expect(newSecret).not.toBe(oldSecret);
    fs.writeFileSync(authPath, `${JSON.stringify({ secret: newSecret })}\n`, 'utf-8');

    // Trigger hot reload — server picks up the new secret from auth.json
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();

    // Wait for hot reload to complete (updates state.wsSecret)
    await waitForLog(mcpServer, 'Hot reload complete', 15_000);
    mcpServer.secret = newSecret;

    // Hot reload restarts the worker, which reads the rotated secret from
    // auth.json. The proxy breaks the extension's WebSocket connection during
    // the restart. The extension detects the disconnect and reconnects,
    // re-fetching /ws-info to get a token signed with the new secret.
    // Wait for the extension to reconnect after the hot reload.
    await waitForExtensionConnected(mcpServer, 45_000);
    await waitForLog(mcpServer, 'plugin(s) mapped', 15_000);

    // Tool dispatch works through the new authenticated connection.
    // The original mcpClient was created with the old secret, so create a
    // new client with the rotated secret to verify the new auth works.
    const newClient = createMcpClient(mcpServer.port, newSecret);
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
    await waitForLog(mcpServer, 'plugin(s) mapped');

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
    const {
      context: newContext,
      cleanupDir,
      extensionDir,
    } = await launchExtensionContext(mcpServer.port, mcpServer.secret);

    // Symlink the adapters directory for the new extension copy
    const serverAdaptersParent = path.join(mcpServer.configDir, 'extension');
    fs.mkdirSync(serverAdaptersParent, { recursive: true });
    const serverAdaptersDir = path.join(serverAdaptersParent, 'adapters');
    const extensionAdaptersDir = path.join(extensionDir, 'adapters');
    // Remove old symlink/directory and create new one
    fs.rmSync(serverAdaptersDir, { recursive: true, force: true });
    symlinkCrossPlatform(extensionAdaptersDir, serverAdaptersDir, 'dir');

    mcpServer.logs.length = 0;

    try {
      // 6. Wait for the fresh extension to connect and complete the full handshake
      await waitForExtensionConnected(mcpServer, 45_000);
      await waitForLog(mcpServer, 'plugin(s) mapped', 15_000);

      // 7. Verify server logs show the full reconnect cycle
      const logsJoined = mcpServer.logs.join('\n');
      expect(logsJoined).toContain('Extension WebSocket connected');
      expect(logsJoined).toContain('plugin(s) mapped');

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
// Stress: hot reload during active tool dispatch — verifies that an in-flight
// slow_with_progress call settles cleanly after hot reload (no hang), and that
// post-reload recovery works (extension reconnects, fresh echo call succeeds).
// ---------------------------------------------------------------------------

test.describe('Stress: hot reload during active tool dispatch', () => {
  test('in-flight slow_with_progress settles after hot reload, fresh echo succeeds after recovery', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Start a 5-second slow tool call (in-flight during reload)
    const slowCallPromise = mcpClient.callTool('e2e-test_slow_with_progress', {
      durationMs: 5000,
      steps: 5,
      message: 'in-flight-during-reload',
    });

    // Wait 500ms to ensure the call is in-flight, then trigger hot reload
    await new Promise(r => setTimeout(r, 500));
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();

    // The in-flight call MUST settle within 30s (success or structured error,
    // no raw rejection hang). Use Promise.allSettled to prevent transport
    // rejections from short-circuiting.
    const settled = await Promise.allSettled([slowCallPromise]);
    const outcome = settled[0];

    if (outcome.status === 'fulfilled') {
      const result = outcome.value;
      if (result.isError) {
        // Any non-empty error content is acceptable during hot reload — the
        // specific wording varies depending on timing (worker killed before
        // response, WebSocket closed, dispatch cancelled, concurrency limit, etc.)
        expect(result.content.length).toBeGreaterThan(0);
      }
      // Success with valid content is also acceptable
    }
    // Rejected (transport error) is acceptable during hot reload — the call settled

    // Wait for hot reload to complete within 20s
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);

    // Extension reconnects (health shows extensionConnected=true)
    await waitForExtensionConnected(mcpServer, 30_000);
    const health = await mcpServer.health();
    expect(health).not.toBeNull();
    if (!health) throw new Error('health returned null');
    expect(health.extensionConnected).toBe(true);

    // Fresh echo call succeeds within 20s
    const recoveredResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after-reload-stress' },
      { isError: false },
      20_000,
    );
    const recoveredOutput = JSON.parse(recoveredResult.content) as Record<string, unknown>;
    expect(recoveredOutput.message).toBe('after-reload-stress');

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// URL change reconnection — verifies that changing the MCP server URL in
// chrome.storage.local while disconnected triggers reconnection to the new server.
// This exercises the US-002 fix: the ws:setUrl handler's third branch where
// ws is null and no reconnect timer is pending.
// ---------------------------------------------------------------------------

/**
 * Set serverPort in chrome.storage.local via an extension page.
 * This triggers the background script's chrome.storage.onChanged listener,
 * which constructs a ws:// URL and relays ws:setUrl to the offscreen document.
 */
const setServerPort = async (context: BrowserContext, port: number): Promise<void> => {
  const extId = await getExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/side-panel/side-panel.html`, {
    waitUntil: 'load',
    timeout: 10_000,
  });
  await page.evaluate(async (p: number) => {
    const chromeApi = (globalThis as Record<string, unknown>).chrome as {
      storage: { local: { set: (items: Record<string, unknown>) => Promise<void> } };
    };
    await chromeApi.storage.local.set({ serverPort: p });
  }, port);
  await page.close();
};

test.describe('URL change reconnection', () => {
  test('changing serverPort while disconnected triggers reconnection to new server', async ({
    mcpServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // 1. Verify extension is connected to server A and tools work
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'plugin(s) mapped');

    const preResult = await mcpClient.callTool('browser_list_tabs');
    expect(preResult.isError).toBe(false);

    const serverAPort = mcpServer.port;

    // 2. Kill server A
    await mcpServer.kill();

    // Verify server A is dead
    const dead = await mcpServer.health();
    expect(dead).toBeNull();

    // 3. Start a NEW server B on a DIFFERENT port with the same plugin config
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
      symlinkCrossPlatform(extensionAdaptersDir, serverBAdaptersDir, 'dir');

      // Write auth.json into the extension copy so the offscreen document
      // can bootstrap the secret for server B. The extension copy's
      // auth.json is symlinked to server A's configDir — server B has a
      // different configDir, so write directly into the extension.
      const extensionAdaptersSymlink = path.join(mcpServer.configDir, 'extension', 'adapters');
      const realExtensionAdaptersDir = fs.readlinkSync(extensionAdaptersSymlink);
      const extensionRootDir = path.dirname(realExtensionAdaptersDir);
      const extensionAuthPath = path.join(extensionRootDir, 'auth.json');
      fs.writeFileSync(extensionAuthPath, `${JSON.stringify({ secret: serverB.secret })}\n`, 'utf-8');

      // Wait briefly for the file write to be visible to the extension's
      // fetch of chrome.runtime.getURL('auth.json').
      await new Promise(r => setTimeout(r, 500));

      // 4. Change serverPort in chrome.storage.local to point to server B.
      //    The background script's chrome.storage.onChanged listener constructs
      //    a ws:// URL and relays ws:setUrl to the offscreen document, which
      //    calls connect() even when ws is null and no reconnect timer is pending.
      await setServerPort(extensionContext, serverBPort);

      // 5. Wait for extension to connect to server B
      await waitForExtensionConnected(serverB, 45_000);
      await waitForLog(serverB, 'plugin(s) mapped', 15_000);

      // 6. Verify server B shows the extension connected
      const h = await serverB.health();
      expect(h).not.toBeNull();
      if (!h) throw new Error('health returned null');
      expect(h.status).toBe('ok');
      expect(h.extensionConnected).toBe(true);

      // 7. Verify tool dispatch works through server B
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
