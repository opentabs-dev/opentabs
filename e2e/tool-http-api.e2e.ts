/**
 * E2E tests for the HTTP tool API endpoints:
 *   - GET /tools — tool discovery with plugin annotation and filtering
 *   - POST /tools/:name/call — tool invocation via HTTP
 *
 * These tests exercise the full stack: HTTP endpoint → MCP server → extension
 * → injected adapter → test web server. All tests use dynamic ports and are
 * safe for parallel execution.
 */

import { expect, test } from './fixtures.js';
import { setupToolTest } from './helpers.js';

// ---------------------------------------------------------------------------
// Helper: authenticated fetch against the MCP server
// ---------------------------------------------------------------------------

const fetchWithAuth = (
  port: number,
  secret: string | undefined,
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return fetch(`http://localhost:${port}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(10_000),
  });
};

// ---------------------------------------------------------------------------
// GET /tools — tool discovery
// ---------------------------------------------------------------------------

test.describe('HTTP API — GET /tools', () => {
  test('returns tools from the e2e-test plugin with correct annotation', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const res = await fetchWithAuth(mcpServer.port, mcpServer.secret, '/tools');
    expect(res.status).toBe(200);

    const tools = (await res.json()) as Array<{
      name: string;
      description: string;
      plugin: string;
      inputSchema: unknown;
    }>;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    // e2e-test plugin tools should be present and annotated correctly
    const e2eTools = tools.filter(t => t.plugin === 'e2e-test');
    expect(e2eTools.length).toBeGreaterThan(0);
    expect(e2eTools.some(t => t.name === 'e2e-test_get_status')).toBe(true);
    expect(e2eTools.some(t => t.name === 'e2e-test_echo')).toBe(true);

    // Each tool has the expected shape
    for (const tool of e2eTools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.plugin).toBe('string');
      expect(tool.inputSchema).toBeDefined();
    }

    // Browser tools should be present and annotated as 'browser'
    const browserTools = tools.filter(t => t.plugin === 'browser');
    expect(browserTools.length).toBeGreaterThan(0);

    // Platform tools should be present
    const platformTools = tools.filter(t => t.plugin === 'platform');
    expect(platformTools.length).toBeGreaterThan(0);
  });

  test('plugin filter returns only matching tools', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Filter by e2e-test plugin
    const res = await fetchWithAuth(mcpServer.port, mcpServer.secret, '/tools?plugin=e2e-test');
    expect(res.status).toBe(200);

    const tools = (await res.json()) as Array<{ name: string; plugin: string }>;
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.plugin).toBe('e2e-test');
    }

    // Filter by browser
    const browserRes = await fetchWithAuth(mcpServer.port, mcpServer.secret, '/tools?plugin=browser');
    const browserTools = (await browserRes.json()) as Array<{ name: string; plugin: string }>;
    expect(browserTools.length).toBeGreaterThan(0);
    for (const tool of browserTools) {
      expect(tool.plugin).toBe('browser');
    }

    // Nonexistent plugin returns empty
    const emptyRes = await fetchWithAuth(mcpServer.port, mcpServer.secret, '/tools?plugin=nonexistent');
    const emptyTools = (await emptyRes.json()) as Array<unknown>;
    expect(emptyTools).toEqual([]);
  });

  test('returns 401 without auth', async ({ mcpServer }) => {
    await mcpServer.waitForHealth(h => h.status === 'ok');
    const res = await fetch(`http://localhost:${mcpServer.port}/tools`, {
      signal: AbortSignal.timeout(5_000),
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /tools/:name/call — tool invocation
// ---------------------------------------------------------------------------

test.describe('HTTP API — POST /tools/:name/call', () => {
  test('dispatches e2e-test_get_status and returns result', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const res = await fetchWithAuth(mcpServer.port, mcpServer.secret, '/tools/e2e-test_get_status/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arguments: {} }),
    });
    expect(res.status).toBe(200);

    const result = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).not.toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);

    // Parse the tool output
    const text = result.content.map(c => c.text).join('');
    const output = JSON.parse(text) as Record<string, unknown>;
    expect(output.ok).toBe(true);
    expect(output.version).toBe('1.0.0-test');
  });

  test('dispatches e2e-test_echo with arguments', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const res = await fetchWithAuth(mcpServer.port, mcpServer.secret, '/tools/e2e-test_echo/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arguments: { message: 'http-api-test' } }),
    });
    expect(res.status).toBe(200);

    const result = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).not.toBe(true);

    const text = result.content.map(c => c.text).join('');
    const output = JSON.parse(text) as Record<string, unknown>;
    expect(output.ok).toBe(true);
    expect(output.message).toBe('http-api-test');
  });

  test('returns 404 for unknown tool', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const res = await fetchWithAuth(mcpServer.port, mcpServer.secret, '/tools/nonexistent_tool/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arguments: {} }),
    });
    // Unknown tools return 404 with error content
    expect(res.status).toBe(404);

    const result = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
  });

  test('returns 401 without auth', async ({ mcpServer }) => {
    await mcpServer.waitForHealth(h => h.status === 'ok');
    const res = await fetch(`http://localhost:${mcpServer.port}/tools/e2e-test_get_status/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arguments: {} }),
      signal: AbortSignal.timeout(5_000),
    });
    expect(res.status).toBe(401);
  });
});
