/**
 * MCP session persistence E2E tests — verifies that MCP client connections
 * survive dev proxy hot reloads without requiring client-side re-initialization.
 *
 * The dev proxy assigns stable proxy session IDs to MCP clients and
 * transparently re-initializes sessions with new workers on hot reload.
 * These tests verify that the proxy session bridging works end-to-end:
 * tools remain callable, session IDs remain stable, and multi-client
 * scenarios work correctly after one or more hot reloads.
 */

import { request as httpRequest } from 'node:http';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createTestConfigDir,
  expect,
  readPluginToolNames,
  startMcpServer,
  test,
} from './fixtures.js';
import { parseToolResult, setupToolTest, waitForExtensionConnected, waitForLog, waitForToolResult } from './helpers.js';

/**
 * Open a GET /mcp SSE stream via node:http, hold it open briefly,
 * then destroy the connection to simulate the SSE stream closing.
 * Does not wait for a response — the proxy writes 200 headers, but
 * node:http may not surface them before we destroy the socket.
 */
const openAndCloseSseStream = async (port: number, sessionId: string, secret?: string): Promise<void> => {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'mcp-session-id': sessionId,
  };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  await new Promise<void>(resolve => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: '/mcp', method: 'GET', headers }, res => {
      // Consume data so the socket doesn't stall
      res.resume();
    });
    req.on('error', () => {
      // ECONNRESET expected after destroy
    });
    req.end();

    // Hold the stream open briefly so the proxy registers it, then destroy
    setTimeout(() => {
      req.destroy();
      // Wait for the close event to propagate through the proxy
      setTimeout(resolve, 500);
    }, 500);
  });
};

/**
 * Open a GET /mcp SSE stream that stays open until the returned `destroy`
 * function is called. Returns a promise that resolves once the proxy has
 * had time to register the stream (500ms delay, matching openAndCloseSseStream).
 */
const openPersistentSseStream = async (
  port: number,
  sessionId: string,
  secret?: string,
): Promise<{ destroy: () => void }> => {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'mcp-session-id': sessionId,
  };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const req = httpRequest({ hostname: '127.0.0.1', port, path: '/mcp', method: 'GET', headers }, res => {
    res.resume();
  });
  req.on('error', () => {
    // ECONNRESET expected after destroy
  });
  req.end();

  // Give the proxy time to receive the GET, register the stream in sseStreams,
  // and open the upstream SSE connection to the worker.
  await new Promise<void>(r => setTimeout(r, 500));

  return { destroy: () => req.destroy() };
};

test.describe('MCP session persistence — upstream SSE fan-out', () => {
  test('multiple concurrent SSE GET streams share one upstream without 409 errors', async () => {
    // Regression test: the dev proxy used to open one upstream SSE GET to the
    // worker per client GET request. The MCP SDK enforces exactly one GET SSE
    // stream per session — opening a second returns 409 Conflict. The proxy
    // now maintains a single upstream SSE stream and fans out data to all
    // client responses.
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();

      const sid = client.sessionId;
      expect(sid).toBeTruthy();

      server.logs.length = 0;

      // Open two concurrent SSE GET streams for the same session.
      // The proxy must open only one upstream GET to the worker.
      const stream1 = await openPersistentSseStream(server.port, sid as string, server.secret);
      const stream2 = await openPersistentSseStream(server.port, sid as string, server.secret);

      // Give the proxy time to attempt upstream connections
      await new Promise(r => setTimeout(r, 1_000));

      // The server logs must NOT contain any 409 rejection
      const has409 = server.logs.some(l => l.includes('status 409'));
      expect(has409).toBe(false);

      // Session must still function — list tools via POST
      const tools = await client.listTools();
      const expectedToolNames = readPluginToolNames();
      for (const name of expectedToolNames) {
        expect(tools.some(t => t.name === name)).toBe(true);
      }

      stream1.destroy();
      stream2.destroy();
      await client.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('hot reload with active SSE streams reconnects without 409 errors', async () => {
    // Regression test: reinitializeSessions used to loop over sseStreams and
    // call connectUpstreamSse for each client response. With >1 entry, the
    // first succeeded but subsequent ones got 409 from the worker. The proxy
    // now disconnects the old upstream and opens exactly one new connection.
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();

      const sid = client.sessionId;
      expect(sid).toBeTruthy();

      // Open two SSE streams before the hot reload
      const stream1 = await openPersistentSseStream(server.port, sid as string, server.secret);
      const stream2 = await openPersistentSseStream(server.port, sid as string, server.secret);

      // Clear logs, trigger hot reload
      server.logs.length = 0;
      server.triggerHotReload();
      await waitForLog(server, 'Hot reload complete', 15_000);

      // Wait for the proxy to reconnect the upstream SSE
      await new Promise(r => setTimeout(r, 1_000));

      // No 409 errors should appear in the logs
      const has409 = server.logs.some(l => l.includes('status 409'));
      expect(has409).toBe(false);

      // Session must still work
      const tools = await client.listTools();
      const expectedToolNames = readPluginToolNames();
      for (const name of expectedToolNames) {
        expect(tools.some(t => t.name === name)).toBe(true);
      }

      stream1.destroy();
      stream2.destroy();
      await client.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('SSE stream replacement after disconnect does not produce 409', async () => {
    // Verifies that when a client disconnects its SSE stream and opens a new
    // one, the proxy tears down the upstream connection (since no client
    // streams remain) so the new GET succeeds without 409.
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();

      const sid = client.sessionId;
      expect(sid).toBeTruthy();

      // Open an SSE stream
      const stream1 = await openPersistentSseStream(server.port, sid as string, server.secret);

      // Destroy it — this removes the last client SSE stream, which triggers
      // disconnectUpstreamSse in the proxy.
      stream1.destroy();
      // Wait for the close to propagate through the proxy and upstream
      await new Promise(r => setTimeout(r, 1_000));

      server.logs.length = 0;

      // Open a new SSE stream — proxy must open a fresh upstream GET
      const stream2 = await openPersistentSseStream(server.port, sid as string, server.secret);

      // Give time for upstream connection attempt
      await new Promise(r => setTimeout(r, 1_000));

      // No 409 errors
      const has409 = server.logs.some(l => l.includes('status 409'));
      expect(has409).toBe(false);

      // Session still works
      const tools = await client.listTools();
      const expectedToolNames = readPluginToolNames();
      for (const name of expectedToolNames) {
        expect(tools.some(t => t.name === name)).toBe(true);
      }

      stream2.destroy();
      await client.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('MCP session persistence — SSE stream lifecycle', () => {
  test('session survives after SSE GET stream closes', async () => {
    // Regression test: the dev proxy used to delete the entire session when
    // all SSE streams closed, causing subsequent POST requests to fail with
    // "missing session" because the proxy no longer recognized the session ID.
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Verify tools are available
      const expectedToolNames = readPluginToolNames();
      const toolsBefore = await client.listTools();
      for (const name of expectedToolNames) {
        expect(toolsBefore.some(t => t.name === name)).toBe(true);
      }

      // Open a GET /mcp SSE stream then close it
      const sid = client.sessionId;
      expect(sid).toBeTruthy();
      await openAndCloseSseStream(server.port, sid as string, server.secret);

      // The session must still work — list tools via POST should succeed
      // without the client needing to re-initialize.
      const toolsAfter = await client.listTools();
      for (const name of expectedToolNames) {
        expect(toolsAfter.some(t => t.name === name)).toBe(true);
      }

      await client.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('session survives SSE stream close followed by hot reload', async () => {
    // Verifies the combined scenario: SSE stream closes (e.g., network hiccup),
    // then a hot reload occurs. The proxy must still have the session so it can
    // re-initialize it with the new worker.
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();

      const expectedToolNames = readPluginToolNames();

      // Open and close an SSE stream
      const sid = client.sessionId;
      expect(sid).toBeTruthy();
      await openAndCloseSseStream(server.port, sid as string, server.secret);

      // Now trigger a hot reload — the proxy must still know about the session
      // to re-initialize it with the new worker.
      server.logs.length = 0;
      server.triggerHotReload();
      await waitForLog(server, 'Hot reload complete', 15_000);

      // Verify the proxy re-initialized the session
      expect(server.logs.join('\n')).toContain('Re-initializing');

      // Tools must still work
      const tools = await client.listTools();
      for (const name of expectedToolNames) {
        expect(tools.some(t => t.name === name)).toBe(true);
      }

      await client.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('MCP session persistence across hot reload', () => {
  test('MCP client retains tool access after a single hot reload without re-initialization', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      // Initialize an MCP client session
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Verify tools are available before the reload
      const toolsBefore = await client.listTools();
      const expectedToolNames = readPluginToolNames();
      for (const name of expectedToolNames) {
        expect(toolsBefore.some(t => t.name === name)).toBe(true);
      }

      // Clear logs to isolate hot-reload output
      server.logs.length = 0;

      // Trigger hot reload — the proxy kills the old worker and starts a new one.
      // The proxy should re-initialize the MCP session transparently.
      server.triggerHotReload();

      // Wait for the reload to complete
      await waitForLog(server, 'Hot reload complete', 15_000);

      // Verify the proxy re-initialized the session with the new worker
      expect(server.logs.join('\n')).toContain('Re-initializing');

      // List tools again — should succeed without client-side re-initialization.
      // The proxy mapped the stable session ID to the new worker's session ID.
      const toolsAfter = await client.listTools();
      for (const name of expectedToolNames) {
        expect(toolsAfter.some(t => t.name === name)).toBe(true);
      }

      await client.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('MCP client survives multiple sequential hot reloads', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Verify baseline tool access
      const expectedToolNames = readPluginToolNames();
      const toolsBefore = await client.listTools();
      for (const name of expectedToolNames) {
        expect(toolsBefore.some(t => t.name === name)).toBe(true);
      }

      // Perform 3 sequential hot reloads, verifying tool access after each
      for (let i = 1; i <= 3; i++) {
        server.logs.length = 0;
        server.triggerHotReload();
        await waitForLog(server, 'Hot reload complete', 15_000);

        // Verify tools are still accessible after each reload
        const tools = await client.listTools();
        for (const name of expectedToolNames) {
          expect(tools.some(t => t.name === name)).toBe(true);
        }
      }

      await client.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('session ID survives 5 rapid hot reloads without re-initialization', async () => {
    test.slow();

    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();

      const originalSessionId = client.sessionId;
      expect(originalSessionId).toBeTruthy();

      // Verify baseline tool access
      const expectedToolNames = readPluginToolNames();
      const toolsBefore = await client.listTools();
      for (const name of expectedToolNames) {
        expect(toolsBefore.some(t => t.name === name)).toBe(true);
      }

      // Clear logs and fire 5 hot reloads with 1500ms spacing to avoid coalescing on slow CI
      server.logs.length = 0;
      for (let i = 0; i < 5; i++) {
        server.triggerHotReload();
        if (i < 4) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      // Wait for at least 3 reloads to complete — some may coalesce on CI
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const count = server.logs.filter(l => l.includes('Hot reload complete')).length;
        if (count >= 3) break;
        await new Promise(r => setTimeout(r, 200));
      }
      const reloadCount = server.logs.filter(l => l.includes('Hot reload complete')).length;
      expect(reloadCount).toBeGreaterThanOrEqual(3);

      // Session ID must be identical — the proxy maintains a stable ID
      expect(client.sessionId).toBe(originalSessionId);

      // listTools must work without re-initialization
      const toolsAfter = await client.listTools();
      for (const name of expectedToolNames) {
        expect(toolsAfter.some(t => t.name === name)).toBe(true);
      }

      await client.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('multiple MCP clients each retain tool access after hot reload', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      // Create two independent MCP client sessions
      const client1 = createMcpClient(server.port, server.secret);
      const client2 = createMcpClient(server.port, server.secret);
      await client1.initialize();
      await client2.initialize();

      const expectedToolNames = readPluginToolNames();

      // Verify both clients have tool access before reload
      const tools1Before = await client1.listTools();
      const tools2Before = await client2.listTools();
      for (const name of expectedToolNames) {
        expect(tools1Before.some(t => t.name === name)).toBe(true);
        expect(tools2Before.some(t => t.name === name)).toBe(true);
      }

      // Trigger hot reload
      server.logs.length = 0;
      server.triggerHotReload();
      await waitForLog(server, 'Hot reload complete', 15_000);

      // Verify the proxy re-initialized both sessions
      const reinitLog = server.logs.find(l => l.includes('Re-initializing'));
      expect(reinitLog).toBeDefined();
      expect(reinitLog).toContain('2 MCP session');

      // Both clients should retain tool access
      const tools1After = await client1.listTools();
      const tools2After = await client2.listTools();
      for (const name of expectedToolNames) {
        expect(tools1After.some(t => t.name === name)).toBe(true);
        expect(tools2After.some(t => t.name === name)).toBe(true);
      }

      await client1.close();
      await client2.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe
  .serial('MCP session persistence with extension and tool dispatch', () => {
    test('end-to-end tool dispatch works after hot reload via persistent session', async ({
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    }) => {
      test.slow();

      const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

      try {
        // Verify end-to-end tool dispatch works before reload
        const beforeResult = await mcpClient.callTool('e2e-test_echo', {
          message: 'before-reload',
        });
        expect(beforeResult.isError).toBe(false);
        expect(parseToolResult(beforeResult.content).message).toBe('before-reload');

        // Trigger hot reload
        mcpServer.logs.length = 0;
        mcpServer.triggerHotReload();

        // Wait for reload to complete and extension to reconnect
        await waitForLog(mcpServer, 'Hot reload complete', 20_000);
        await waitForExtensionConnected(mcpServer, 30_000);
        await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);

        // Poll until the tool is callable through the extension (tab state = ready)
        await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'poll-check' }, { isError: false }, 20_000);

        // Verify full end-to-end tool dispatch: MCP client → proxy → worker → extension → adapter
        const afterResult = await mcpClient.callTool('e2e-test_echo', {
          message: 'after-reload',
        });
        expect(afterResult.isError).toBe(false);
        expect(parseToolResult(afterResult.content).message).toBe('after-reload');
      } finally {
        await page.close();
      }
    });

    test('tool call in-flight during hot reload recovers and subsequent calls succeed', async ({
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    }) => {
      test.slow();

      const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

      try {
        // Verify baseline tool dispatch
        const baseline = await mcpClient.callTool('e2e-test_echo', {
          message: 'baseline',
        });
        expect(baseline.isError).toBe(false);

        // Start a slow tool call and trigger hot reload while it's in-flight
        const slowCallPromise = mcpClient.callToolWithProgress(
          'e2e-test_slow_with_progress',
          { durationMs: 5_000, steps: 10 },
          { timeout: 30_000 },
        );

        // Wait for the tool call to reach the worker, then trigger reload
        await new Promise(r => setTimeout(r, 1_000));
        mcpServer.logs.length = 0;
        mcpServer.triggerHotReload();

        // The in-flight call may complete, error, or be interrupted — all acceptable
        try {
          const slowResult = await slowCallPromise;
          if (!slowResult.isError) {
            const output = parseToolResult(slowResult.content);
            expect(output.completed).toBe(true);
          }
        } catch {
          // Expected: 502, connection reset, or partial response during worker restart
        }

        // Wait for the system to stabilize after reload
        await waitForLog(mcpServer, 'Hot reload complete', 20_000);
        await waitForExtensionConnected(mcpServer, 30_000);
        await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);

        // Poll until the tool is callable again
        await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'poll-check' }, { isError: false }, 20_000);

        // Verify subsequent tool calls succeed after the interrupted call
        const afterResult = await mcpClient.callTool('e2e-test_echo', {
          message: 'after-inflight-reload',
        });
        expect(afterResult.isError).toBe(false);
        expect(parseToolResult(afterResult.content).message).toBe('after-inflight-reload');
      } finally {
        await page.close();
      }
    });
  });
