/**
 * E2E tests for security protections: DNS rebinding (Host header validation),
 * CORS/Origin protection, concurrency limits, rate limiting, and more.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { test as base } from '@playwright/test';
import type { McpClient, McpServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createTestConfigDir,
  expect,
  fetchWsInfo,
  launchExtensionContext,
  readTestConfig,
  startMcpServer,
  symlinkCrossPlatform,
  test,
  writeTestConfig,
} from './fixtures.js';
import {
  openSidePanel,
  parseToolResult,
  setupAdapterSymlink,
  setupToolTest,
  unwrapSingleConnection,
  waitFor,
  waitForExtensionConnected,
  waitForExtensionDisconnected,
  waitForLog,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Helper: HTTP request with custom Host header
// ---------------------------------------------------------------------------

/**
 * Send an HTTP request using `node:http` so we can override the Host header.
 * Node.js `fetch` treats Host as a forbidden header and silently ignores it.
 */
function requestWithHost(
  port: number,
  pathname: string,
  hostHeader: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: 'GET',
        headers: { Host: hostHeader },
      },
      res => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(5_000, () => {
      req.destroy(new Error('Request timed out'));
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// US-001: DNS rebinding protection rejects non-localhost Host headers
// ---------------------------------------------------------------------------

test.describe('DNS rebinding protection — Host header validation', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('rejects requests with evil Host headers (403)', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const evilHosts = ['evil.com', 'localhost.evil.com', 'evil.com:8080'];

      for (const host of evilHosts) {
        const res = await requestWithHost(server.port, '/health', host);
        expect(res.status, `Host: ${host} should be rejected`).toBe(403);
        expect(res.body).toContain('invalid Host header');
      }
    } finally {
      await server.kill();
    }
  });

  test('accepts requests with valid localhost Host headers', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const validHosts = [
        'localhost',
        `localhost:${server.port}`,
        '127.0.0.1',
        `127.0.0.1:${server.port}`,
        `[::1]:${server.port}`,
      ];

      for (const host of validHosts) {
        const res = await requestWithHost(server.port, '/health', host);
        expect(res.status, `Host: ${host} should be accepted`).toBe(200);
      }
    } finally {
      await server.kill();
    }
  });

  test('rejects requests with IPv6-like malicious hosts', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      // Non-localhost IPv6 address — server handler rejects with 403
      const res1 = await requestWithHost(server.port, '/health', '[::2]:8080');
      expect(res1.status, 'Host: [::2]:8080 should be rejected').toBe(403);
      expect(res1.body).toContain('invalid Host header');

      // Malformed IPv6 bracket notation — may cause 403 from our handler or
      // 500 from the HTTP framework (Bun's parser rejects the malformed header
      // before the application handler runs). Either is a valid rejection.
      const res2 = await requestWithHost(server.port, '/health', '[evil');
      expect(res2.status, 'Host: [evil should be rejected (non-2xx)').toBeGreaterThanOrEqual(400);
    } finally {
      await server.kill();
    }
  });

  test('accepts IPv4-mapped IPv6 localhost address', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await requestWithHost(server.port, '/health', `[::ffff:127.0.0.1]:${server.port}`);
      expect(res.status).toBe(200);
    } finally {
      await server.kill();
    }
  });
});

// ---------------------------------------------------------------------------
// US-002: CORS protection rejects browser Origin headers
// ---------------------------------------------------------------------------

test.describe('CORS protection — Origin header validation', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('rejects requests with non-chrome-extension Origin headers (403)', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const evilOrigins = ['https://evil.com', 'http://localhost:3000', 'https://attacker.io', 'http://127.0.0.1:8080'];

      for (const origin of evilOrigins) {
        const res = await fetch(`http://localhost:${server.port}/health`, {
          headers: { Origin: origin },
        });
        expect(res.status, `Origin: ${origin} should be rejected`).toBe(403);
        expect(await res.text()).toContain('browser requests are not allowed');
      }
    } finally {
      await server.kill();
    }
  });

  test('accepts requests with chrome-extension:// Origin', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://localhost:${server.port}/health`, {
        headers: { Origin: 'chrome-extension://abcdefghijklmnop' },
      });
      expect(res.status).toBe(200);
    } finally {
      await server.kill();
    }
  });

  test('accepts requests with no Origin header (MCP clients)', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://localhost:${server.port}/health`);
      expect(res.status).toBe(200);
    } finally {
      await server.kill();
    }
  });
});

// ---------------------------------------------------------------------------
// US-003: Per-plugin concurrency limit rejects 26th concurrent dispatch
// ---------------------------------------------------------------------------

test.describe('Per-plugin concurrency limit', () => {
  test('rejects concurrent dispatch beyond limit with concurrency error', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // Multiple concurrent slow tool calls — mark as slow for extended timeout
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Fire 26 concurrent slow_with_progress calls (limit is 25 per plugin).
    // Each call sleeps for 10s with 2 progress steps — long enough to keep
    // all 25 dispatch slots occupied while the 26th is checked.
    const count = 26;
    const promises = Array.from({ length: count }, () =>
      mcpClient.callTool('e2e-test_slow_with_progress', { durationMs: 10_000, steps: 2 }, { timeout: 30_000 }),
    );
    const results = await Promise.all(promises);

    const successes = results.filter(r => !r.isError);
    const failures = results.filter(r => r.isError);

    // Exactly 25 should succeed and 1 should fail with the concurrency limit error
    expect(successes).toHaveLength(count - 1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.content).toContain('Too many concurrent dispatches');
    expect(failures[0]?.content).toContain('e2e-test');
    expect(failures[0]?.content).toContain('limit: 25');

    await page.close();
  });

  test('frees dispatch slot after tool completes, allowing new calls', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Fill all 25 slots with short-lived calls (2s each)
    const fillPromises = Array.from({ length: 25 }, () =>
      mcpClient.callTool('e2e-test_slow_with_progress', { durationMs: 2000, steps: 2 }, { timeout: 30_000 }),
    );

    // Wait for all 25 to complete — all slots are now free
    const fillResults = await Promise.all(fillPromises);
    for (const r of fillResults) {
      expect(r.isError).toBe(false);
      const output = parseToolResult(r.content);
      expect(output.completed).toBe(true);
    }

    // A new call should succeed (slots freed)
    const result = await mcpClient.callTool(
      'e2e-test_slow_with_progress',
      { durationMs: 1000, steps: 1 },
      { timeout: 30_000 },
    );
    expect(result.isError).toBe(false);
    const output = parseToolResult(result.content);
    expect(output.completed).toBe(true);

    await page.close();
  });

  test('25th concurrent dispatch succeeds, 26th is rejected immediately, and slots are freed after completion', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // This test occupies 25 slots for 10s each — mark as slow for extended timeout
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // --- Phase 1: Fire 25 slow calls, then fire the 26th while they're in-flight ---

    // Start 25 slow calls (10s each) — these occupy all dispatch slots
    const batch1Promises = Array.from({ length: 25 }, () =>
      mcpClient.callTool('e2e-test_slow_with_progress', { durationMs: 10_000, steps: 2 }, { timeout: 30_000 }),
    );

    // Give the 25 calls time to be dispatched and registered in activeDispatches
    await new Promise(r => setTimeout(r, 2_000));

    // Fire the 26th call — should be rejected immediately (not after 10s)
    const overflowStart = Date.now();
    const overflowResult = await mcpClient.callTool(
      'e2e-test_slow_with_progress',
      { durationMs: 10_000, steps: 2 },
      { timeout: 30_000 },
    );
    const overflowElapsed = Date.now() - overflowStart;

    // The 26th call must be rejected with the specific concurrency error
    expect(overflowResult.isError).toBe(true);
    expect(overflowResult.content).toContain('Too many concurrent dispatches');
    expect(overflowResult.content).toContain('e2e-test');
    expect(overflowResult.content).toContain('limit: 25');

    // The rejection must be immediate — well under the 10s duration of the in-flight calls
    expect(overflowElapsed).toBeLessThan(5_000);

    // Wait for all 25 in-flight calls to complete
    const batch1Results = await Promise.all(batch1Promises);
    for (const r of batch1Results) {
      expect(r.isError).toBe(false);
      const output = parseToolResult(r.content);
      expect(output.completed).toBe(true);
    }

    // --- Phase 2: Fire 25 new calls — all must succeed (proves slots were freed) ---

    const batch2Results = await Promise.all(
      Array.from({ length: 25 }, () =>
        mcpClient.callTool('e2e-test_slow_with_progress', { durationMs: 2_000, steps: 1 }, { timeout: 30_000 }),
      ),
    );

    for (const r of batch2Results) {
      expect(r.isError).toBe(false);
      const output = parseToolResult(r.content);
      expect(output.completed).toBe(true);
    }

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// US-004: Extension disconnect during pending ask confirmation
// ---------------------------------------------------------------------------

// Custom fixture: MCP server without skipPermissions so 'ask' is respected.
interface AskPermissionFixtures {
  mcpServer: McpServer;
  extensionContext: BrowserContext;
  mcpClient: McpClient;
}

const askTest = base.extend<AskPermissionFixtures>({
  mcpServer: async ({ browserName: _ }, use) => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true, undefined, {
      OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '',
    });
    try {
      await use(server);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  },

  extensionContext: async ({ mcpServer }, use) => {
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(mcpServer.port, mcpServer.secret);
    setupAdapterSymlink(mcpServer.configDir, extensionDir);

    const serverAuthJson = path.join(mcpServer.configDir, 'extension', 'auth.json');
    const extensionAuthJson = path.join(extensionDir, 'auth.json');
    fs.rmSync(extensionAuthJson, { force: true });
    symlinkCrossPlatform(serverAuthJson, extensionAuthJson, 'file');

    await use(context);
    await context.close();
    try {
      fs.rmSync(cleanupDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  },

  mcpClient: async ({ mcpServer }, use) => {
    const client = createMcpClient(mcpServer.port, mcpServer.secret);
    await client.initialize();
    await use(client);
    await client.close();
  },
});

// ---------------------------------------------------------------------------
// US-005 / US-003: POST /reload uses coalescing (no rate limiting)
// ---------------------------------------------------------------------------

test.describe('POST /reload coalescing', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('rapid sequential reloads all succeed (no 429)', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const url = `http://localhost:${server.port}/reload`;
      const headers: Record<string, string> = {};
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      const statuses: number[] = [];
      for (let i = 0; i < 15; i++) {
        const res = await fetch(url, { method: 'POST', headers });
        statuses.push(res.status);
      }

      // All requests should succeed — coalescing replaces rate limiting
      expect(statuses.every(s => s === 200)).toBe(true);
    } finally {
      await server.kill();
    }
  });

  test('concurrent reload requests all return 200', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const url = `http://localhost:${server.port}/reload`;
      const headers: Record<string, string> = {};
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      // Fire 5 concurrent requests
      const results = await Promise.all(
        Array.from({ length: 5 }, () => fetch(url, { method: 'POST', headers, signal: AbortSignal.timeout(30_000) })),
      );

      for (const res of results) {
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean };
        expect(body.ok).toBe(true);
      }
    } finally {
      await server.kill();
    }
  });
});

// ---------------------------------------------------------------------------
// US-004: Extension disconnect during pending ask confirmation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// US-006: Unauthenticated /health returns minimal response
// ---------------------------------------------------------------------------

test.describe('/health endpoint: authenticated vs unauthenticated response', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('unauthenticated /health returns 200 with minimal { status: "ok" }', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      // Request without any auth header
      const res = await fetch(`http://localhost:${server.port}/health`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe('ok');

      // Minimal response must NOT include detailed fields
      expect(body.plugins).toBeUndefined();
      expect(body.pluginDetails).toBeUndefined();
      expect(body.auditSummary).toBeUndefined();
      expect(body.extensionConnected).toBeUndefined();
      expect(body.toolCount).toBeUndefined();

      // Version header is present on both authenticated and unauthenticated responses
      expect(res.headers.get('x-opentabs-version')).toBeTruthy();
    } finally {
      await server.kill();
    }
  });

  test('authenticated /health returns 200 with full response including plugins', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://localhost:${server.port}/health`, {
        headers: { Authorization: `Bearer ${server.secret}` },
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe('ok');

      // Full response includes detailed fields
      expect(typeof body.plugins).toBe('number');
      expect(Array.isArray(body.pluginDetails)).toBe(true);
      expect(body.auditSummary).toBeDefined();
      expect(typeof body.extensionConnected).toBe('boolean');
      expect(typeof body.toolCount).toBe('number');

      // Version header is present
      expect(res.headers.get('x-opentabs-version')).toBeTruthy();
    } finally {
      await server.kill();
    }
  });

  test('invalid Bearer token returns minimal response (same as unauthenticated)', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://localhost:${server.port}/health`, {
        headers: { Authorization: 'Bearer wrong-secret-value' },
      });
      // /health does not return 401 — it returns the minimal 200 response
      // for any request that fails auth (matching unauthenticated behavior)
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe('ok');
      expect(body.plugins).toBeUndefined();
      expect(body.pluginDetails).toBeUndefined();
      expect(body.auditSummary).toBeUndefined();
    } finally {
      await server.kill();
    }
  });
});

// ---------------------------------------------------------------------------
// US-007: Network capture cleanup when tab closes
// ---------------------------------------------------------------------------

test.describe('Network capture cleanup when tab closes', () => {
  test('closing a tab with active capture cleans up capture state', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'plugin(s) mapped');
    await mcpClient.listTools();

    // 1. Open a tab
    const openResult = await mcpClient.callTool('browser_open_tab', { url: testServer.url });
    expect(openResult.isError).toBe(false);
    const tabInfo = parseToolResult(openResult.content);
    const tabId = tabInfo.id as number;

    // 2. Enable network capture on the tab
    const enableResult = await mcpClient.callTool('browser_enable_network_capture', { tabId });
    expect(enableResult.isError).toBe(false);
    const enableData = parseToolResult(enableResult.content);
    expect(enableData.enabled).toBe(true);

    // 3. Verify capture is active via extension_get_state
    const stateResult1 = await mcpClient.callTool('extension_get_state');
    expect(stateResult1.isError).toBe(false);
    const state1 = unwrapSingleConnection(parseToolResult(stateResult1.content));
    const captures1 = state1.networkCaptures as Array<{ tabId: number; isCapturing: boolean }>;
    const activeCapture = captures1.find(c => c.tabId === tabId);
    expect(activeCapture).toBeDefined();
    expect(activeCapture?.isCapturing).toBe(true);

    // 4. Close the tab
    const closeResult = await mcpClient.callTool('browser_close_tab', { tabId });
    expect(closeResult.isError).toBe(false);

    // 5. Wait for capture state to be cleaned up (chrome.tabs.onRemoved fires async)
    await waitFor(
      async () => {
        const stateResult = await mcpClient.callTool('extension_get_state');
        if (stateResult.isError) return false;
        const state = unwrapSingleConnection(parseToolResult(stateResult.content));
        const captures = state.networkCaptures as Array<{ tabId: number }>;
        return !captures.some(c => c.tabId === tabId);
      },
      10_000,
      500,
      'capture cleaned up after tab close',
    );

    // 6. Open a new tab and enable capture — should succeed (not blocked by stale state)
    const openResult2 = await mcpClient.callTool('browser_open_tab', { url: testServer.url });
    expect(openResult2.isError).toBe(false);
    const tabInfo2 = parseToolResult(openResult2.content);
    const tabId2 = tabInfo2.id as number;

    const enableResult2 = await mcpClient.callTool('browser_enable_network_capture', { tabId: tabId2 });
    expect(enableResult2.isError).toBe(false);
    const enableData2 = parseToolResult(enableResult2.content);
    expect(enableData2.enabled).toBe(true);

    // Cleanup
    await mcpClient.callTool('browser_disable_network_capture', { tabId: tabId2 });
    await mcpClient.callTool('browser_close_tab', { tabId: tabId2 });
  });
});

// ---------------------------------------------------------------------------
// US-008: Config mutex serializes concurrent permission writes
// ---------------------------------------------------------------------------

test.describe('Config mutex serializes concurrent permission writes', () => {
  test('10 concurrent setToolPermission calls all persist without data loss', async () => {
    const configDir = createTestConfigDir();
    const config = readTestConfig(configDir);
    config.permissions = { 'e2e-test': { permission: 'off' } };
    writeTestConfig(configDir, config);

    const server = await startMcpServer(configDir, true, undefined, {
      OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: '',
    });

    try {
      await server.waitForHealth(h => h.status === 'ok');

      // Connect a WebSocket client (same pattern as plugin-management.e2e.ts)
      const { wsUrl, wsSecret } = await fetchWsInfo(server.port, server.secret);
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

      // Pending response resolvers keyed by request id
      const pending = new Map<string, (resp: Record<string, unknown>) => void>();
      ws.onmessage = event => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : '') as Record<string, unknown>;
          const id = msg.id;
          if (id !== undefined && typeof id === 'string') {
            const resolver = pending.get(id);
            if (resolver) {
              pending.delete(id);
              resolver(msg);
            }
          }
        } catch {
          // ignore non-JSON messages
        }
      };

      const sendRequest = (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
        const id = crypto.randomUUID();
        return new Promise<Record<string, unknown>>((resolve, reject) => {
          const timeout = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`JSON-RPC request timed out: ${method}`));
          }, 10_000);
          pending.set(id, resp => {
            clearTimeout(timeout);
            resolve(resp);
          });
          ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
        });
      };

      // 10 different e2e-test tools — enough contention to expose read-modify-write races
      const toolPermissions: Array<{ tool: string; permission: string }> = [
        { tool: 'echo', permission: 'auto' },
        { tool: 'greet', permission: 'ask' },
        { tool: 'list_items', permission: 'auto' },
        { tool: 'create_item', permission: 'ask' },
        { tool: 'slow_with_progress', permission: 'auto' },
        { tool: 'failing_tool', permission: 'ask' },
        { tool: 'get_status', permission: 'auto' },
        { tool: 'error_auth', permission: 'ask' },
        { tool: 'error_timeout', permission: 'auto' },
        { tool: 'log_levels', permission: 'ask' },
      ];

      // Fire all 10 concurrently
      const results = await Promise.all(
        toolPermissions.map(({ tool, permission }) =>
          sendRequest('config.setToolPermission', { plugin: 'e2e-test', tool, permission }),
        ),
      );

      // All 10 must return ok:true
      for (const r of results) {
        expect(r.error).toBeUndefined();
        expect((r.result as { ok: boolean }).ok).toBe(true);
      }

      // Persistence is async (fire-and-forget via configWriteMutex).
      // Poll config.json until all 10 tool overrides appear.
      await waitFor(
        () => {
          const savedConfig = readTestConfig(configDir);
          const tools = savedConfig.permissions?.['e2e-test']?.tools;
          if (!tools) return false;
          return toolPermissions.every(({ tool, permission }) => tools[tool] === permission);
        },
        10_000,
        200,
        'all 10 tool permissions persisted to config.json',
      );

      // Final verification: read once more and assert each value explicitly
      const finalConfig = readTestConfig(configDir);
      const finalTools = finalConfig.permissions?.['e2e-test']?.tools;
      expect(finalTools).toBeDefined();
      for (const { tool, permission } of toolPermissions) {
        expect(finalTools?.[tool], `tool '${tool}' should be '${permission}'`).toBe(permission);
      }

      // Base plugin permission should still be 'off' (concurrent tool writes must not clobber it)
      expect(finalConfig.permissions?.['e2e-test']?.permission).toBe('off');

      // No JSON parse errors in server logs
      const jsonParseErrors = server.logs.filter(l => l.includes('JSON') && l.includes('parse'));
      expect(jsonParseErrors, 'no JSON parse errors in server logs').toHaveLength(0);

      ws.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

askTest.describe('Extension disconnect during pending ask confirmation', () => {
  askTest(
    'disconnecting extension while confirmation is pending returns error quickly',
    async ({ mcpServer, extensionContext, mcpClient }) => {
      // Set browser tools to 'ask' permission and reload
      const config = readTestConfig(mcpServer.configDir);
      config.permissions = { browser: { permission: 'ask' } };
      writeTestConfig(mcpServer.configDir, config);

      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();
      await waitForLog(mcpServer, 'Hot reload complete', 20_000);

      await waitForExtensionConnected(mcpServer);
      await waitForLog(mcpServer, 'plugin(s) mapped');

      // Open the side panel so the confirmation dialog can appear
      const sidePanel = await openSidePanel(extensionContext);

      // Start the tool call (triggers confirmation dialog) and concurrently
      // disconnect the extension before responding to the dialog.
      const start = Date.now();
      const [result] = await Promise.all([
        mcpClient.callTool('browser_list_tabs', {}, { timeout: 35_000 }),
        (async () => {
          // Wait for the confirmation dialog to appear in the side panel —
          // this confirms the server has registered a pending confirmation.
          await sidePanel.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 15_000 });

          // Disconnect the extension by stealing its WebSocket slot with a fake client.
          // This triggers rejectAllPendingConfirmations on the server.
          mcpServer.logs.length = 0;
          const { wsUrl, wsSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
          const protocols = ['opentabs'];
          if (wsSecret) protocols.push(wsSecret);
          const fakeWs = protocols.length > 1 ? new WebSocket(wsUrl, protocols) : new WebSocket(wsUrl);
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5_000);
            fakeWs.onopen = () => {
              clearTimeout(timer);
              resolve();
            };
            fakeWs.onerror = () => {
              clearTimeout(timer);
              reject(new Error('WebSocket connect failed'));
            };
          });

          // Wait for server to recognize the replacement, then close the fake WS
          try {
            await waitForLog(mcpServer, 'Closing previous extension WebSocket', 5_000);
          } finally {
            fakeWs.close();
          }
          await waitForExtensionDisconnected(mcpServer, 5_000);
        })(),
      ]);
      const elapsed = Date.now() - start;

      // The MCP client should receive an error about the extension not being connected
      expect(result.isError).toBe(true);
      expect(result.content).toContain('requires approval but the extension is not connected');

      // The error should arrive quickly — well under the 30s dispatch timeout
      expect(elapsed).toBeLessThan(15_000);

      // Wait for the real extension to reconnect for clean teardown
      await waitForExtensionConnected(mcpServer, 45_000);
    },
  );
});
