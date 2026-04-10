/**
 * E2E tests for OAuth discovery probe compatibility.
 *
 * Simulates the full Claude Code MCP client connection flow: OAuth discovery
 * probes (well-known endpoints), fallback OAuth endpoints, and then successful
 * MCP connection via Streamable HTTP with Bearer auth.
 *
 * The MCP SDK's parseErrorResponse() calls JSON.parse() on all non-OK response
 * bodies. These tests verify that every 404 returns valid JSON matching the
 * OAuthErrorResponseSchema ({ error: string, error_description?: string }).
 */

import { cleanupTestConfigDir, createTestConfigDir, expect, startMcpServer, test } from './fixtures.js';

/**
 * Parse a Server-Sent Events response body and extract the first JSON-RPC
 * message from a `data:` line. The MCP Streamable HTTP transport returns SSE
 * when the client sends `Accept: text/event-stream`.
 */
async function parseSseJsonRpc<T>(res: Response): Promise<T> {
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6)) as T;
    }
  }
  throw new Error(`No data: line found in SSE response:\n${text}`);
}

// ---------------------------------------------------------------------------
// 1. Well-known endpoint responses
// ---------------------------------------------------------------------------

test.describe('OAuth discovery — well-known endpoint responses', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  const wellKnownPaths = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server/mcp',
    '/.well-known/openid-configuration/mcp',
  ];

  test('all well-known paths return 404 JSON with error field', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      for (const pathname of wellKnownPaths) {
        const res = await fetch(`http://127.0.0.1:${server.port}${pathname}`);
        expect(res.status, `${pathname} should return 404`).toBe(404);

        const contentType = res.headers.get('content-type') ?? '';
        expect(contentType, `${pathname} should return application/json`).toContain('application/json');

        const body = (await res.json()) as { error?: string; error_description?: string };
        expect(body.error, `${pathname} body should have an 'error' field`).toBe('not_found');
        expect(typeof body.error_description).toBe('string');
      }
    } finally {
      await server.kill();
    }
  });

  test('well-known endpoints do not require Bearer auth', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      // Requests without Authorization header should still get 404 JSON (not 401)
      for (const pathname of wellKnownPaths) {
        const res = await fetch(`http://127.0.0.1:${server.port}${pathname}`);
        expect(res.status, `${pathname} should return 404 without auth`).toBe(404);

        const body = (await res.json()) as { error?: string };
        expect(body.error).toBe('not_found');
      }
    } finally {
      await server.kill();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Fallback OAuth endpoints
// ---------------------------------------------------------------------------

test.describe('OAuth discovery — fallback OAuth endpoints', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('GET /authorize returns 404 JSON', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://127.0.0.1:${server.port}/authorize`);
      expect(res.status).toBe(404);

      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toContain('application/json');

      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe('not_found');
    } finally {
      await server.kill();
    }
  });

  test('POST /token returns 404 JSON', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://127.0.0.1:${server.port}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);

      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toContain('application/json');

      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe('not_found');
    } finally {
      await server.kill();
    }
  });

  test('POST /register returns 404 JSON', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://127.0.0.1:${server.port}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);

      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toContain('application/json');

      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe('not_found');
    } finally {
      await server.kill();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Full Claude Code connection simulation
// ---------------------------------------------------------------------------

test.describe('OAuth discovery — full Claude Code connection flow', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('probe well-known → get 404 JSON → POST /mcp initialize with Bearer auth → succeed', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      // Step 1: Probe /.well-known/oauth-protected-resource → 404 JSON
      const protectedRes = await fetch(`http://127.0.0.1:${server.port}/.well-known/oauth-protected-resource`);
      expect(protectedRes.status).toBe(404);
      const protectedBody = (await protectedRes.json()) as { error?: string };
      expect(protectedBody.error).toBe('not_found');

      // Step 2: Probe /.well-known/oauth-authorization-server → 404 JSON
      const authServerRes = await fetch(`http://127.0.0.1:${server.port}/.well-known/oauth-authorization-server`);
      expect(authServerRes.status).toBe(404);
      const authServerBody = (await authServerRes.json()) as { error?: string };
      expect(authServerBody.error).toBe('not_found');

      // Step 3: POST /mcp with initialize request and Bearer auth → 200 with session ID
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      const initRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      });

      expect(initRes.status).toBe(200);
      const sessionId = initRes.headers.get('mcp-session-id') ?? '';
      expect(sessionId, 'initialize should return mcp-session-id header').toBeTruthy();

      // The server returns SSE when Accept includes text/event-stream
      const initBody = await parseSseJsonRpc<{
        jsonrpc: string;
        id: number;
        result?: { protocolVersion?: string };
      }>(initRes);
      expect(initBody.result?.protocolVersion).toBeTruthy();

      // Step 4: Send initialized notification (required before tools/list)
      const notifRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: { ...headers, 'mcp-session-id': sessionId },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });
      expect(notifRes.status).toBe(202);

      // Step 5: Send tools/list request to verify MCP session works
      const toolsRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: { ...headers, 'mcp-session-id': sessionId },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        }),
      });
      expect(toolsRes.status).toBe(200);

      const toolsBody = await parseSseJsonRpc<{
        result?: { tools?: Array<{ name: string }> };
      }>(toolsRes);
      expect(Array.isArray(toolsBody.result?.tools)).toBe(true);
    } finally {
      await server.kill();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Catch-all 404 returns JSON
// ---------------------------------------------------------------------------

test.describe('OAuth discovery — catch-all 404 returns JSON', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('GET /nonexistent returns 404 JSON', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://127.0.0.1:${server.port}/nonexistent`);
      expect(res.status).toBe(404);

      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toContain('application/json');

      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe('not_found');
    } finally {
      await server.kill();
    }
  });

  test('POST /some/random/path returns 404 JSON', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://127.0.0.1:${server.port}/some/random/path`, {
        method: 'POST',
      });
      expect(res.status).toBe(404);

      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toContain('application/json');

      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe('not_found');
    } finally {
      await server.kill();
    }
  });

  test('404 body is valid JSON (JSON.parse does not throw)', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://127.0.0.1:${server.port}/unknown-path`);
      expect(res.status).toBe(404);

      const text = await res.text();
      expect(() => JSON.parse(text)).not.toThrow();
    } finally {
      await server.kill();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Existing routes unaffected
// ---------------------------------------------------------------------------

test.describe('OAuth discovery — existing routes unaffected', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('GET /health still returns 200 JSON with status ok', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { status?: string };
      expect(body.status).toBe('ok');
    } finally {
      await server.kill();
    }
  });

  test('POST /mcp with initialize request and Bearer auth still works', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('mcp-session-id')).toBeTruthy();
    } finally {
      await server.kill();
    }
  });

  test('GET /mcp without session returns 405', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const headers: Record<string, string> = {
        Accept: 'application/json, text/event-stream',
      };
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, { headers });
      expect(res.status).toBe(405);
    } finally {
      await server.kill();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. MCP auth hardening — 405 for GET/DELETE without session
// ---------------------------------------------------------------------------

test.describe('MCP auth hardening — 405 for sessionless GET/DELETE', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('GET /mcp with Bearer auth but no session ID returns 405', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'GET',
        headers,
      });
      expect(res.status).toBe(405);
    } finally {
      await server.kill();
    }
  });

  test('DELETE /mcp without session ID returns 405', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const headers: Record<string, string> = {};
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'DELETE',
        headers,
      });
      expect(res.status).toBe(405);
    } finally {
      await server.kill();
    }
  });

  test('GET /mcp with valid session ID still returns SSE stream', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      // POST initialize to get a session ID
      const initRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      });
      expect(initRes.status).toBe(200);
      const sessionId = initRes.headers.get('mcp-session-id') ?? '';
      expect(sessionId).toBeTruthy();

      // Consume the initialize response body
      await initRes.text();

      // GET /mcp with valid session should return 200 SSE.
      // Use AbortController to close the SSE stream after checking headers,
      // otherwise the open stream prevents the test from completing.
      const sseAbort = new AbortController();
      const getRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'GET',
        headers: { ...headers, 'mcp-session-id': sessionId },
        signal: sseAbort.signal,
      });
      expect(getRes.status).toBe(200);

      const contentType = getRes.headers.get('content-type') ?? '';
      expect(contentType).toContain('text/event-stream');
      sseAbort.abort();
    } finally {
      await server.kill();
    }
  });

  test('GET /mcp with invalid session ID returns 404 per MCP spec', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        'mcp-session-id': 'nonexistent-session-id',
      };
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'GET',
        headers,
      });
      expect(res.status).toBe(404);
    } finally {
      await server.kill();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. MCP auth hardening — WWW-Authenticate header on 401
// ---------------------------------------------------------------------------

test.describe('MCP auth hardening — WWW-Authenticate header on 401', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('401 response from POST /mcp includes WWW-Authenticate: Bearer', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong-token',
        },
        body: '{}',
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
    } finally {
      await server.kill();
    }
  });

  test('401 response from GET /mcp includes WWW-Authenticate: Bearer', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: 'Bearer wrong-token',
        },
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
    } finally {
      await server.kill();
    }
  });

  test('401 response from /audit includes WWW-Authenticate: Bearer', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://127.0.0.1:${server.port}/audit`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
    } finally {
      await server.kill();
    }
  });

  test('401 without any Authorization header includes WWW-Authenticate: Bearer', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
    } finally {
      await server.kill();
    }
  });
});

// ---------------------------------------------------------------------------
// 8. MCP auth hardening — full connection flow
// ---------------------------------------------------------------------------

test.describe('MCP auth hardening — full MCP connection flow', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('POST initialize → POST notification → GET SSE with session → all succeed', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      // Step 1: POST initialize
      const initRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      });
      expect(initRes.status).toBe(200);
      const sessionId = initRes.headers.get('mcp-session-id') ?? '';
      expect(sessionId).toBeTruthy();

      const initBody = await parseSseJsonRpc<{
        jsonrpc: string;
        id: number;
        result?: { protocolVersion?: string };
      }>(initRes);
      expect(initBody.result?.protocolVersion).toBeTruthy();

      // Step 2: POST initialized notification
      const notifRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: { ...headers, 'mcp-session-id': sessionId },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });
      expect(notifRes.status).toBe(202);

      // Step 3: GET SSE with valid session.
      // Use AbortController to close the SSE stream after checking headers.
      const sseAbort = new AbortController();
      const getRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'GET',
        headers: { ...headers, 'mcp-session-id': sessionId },
        signal: sseAbort.signal,
      });
      expect(getRes.status).toBe(200);
      const contentType = getRes.headers.get('content-type') ?? '';
      expect(contentType).toContain('text/event-stream');
      sseAbort.abort();
    } finally {
      await server.kill();
    }
  });

  test('GET /mcp without session does NOT trigger error in realistic client flow', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const headers: Record<string, string> = {};
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      // Simulate SDK probe: GET /mcp without session → 405 (SDK silently proceeds)
      const probeRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'GET',
        headers: { ...headers, Accept: 'text/event-stream' },
      });
      expect(probeRes.status).toBe(405);

      // Subsequent POST initialize should still work
      const initHeaders: Record<string, string> = {
        ...headers,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      const initRes = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: initHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      });
      expect(initRes.status).toBe(200);
      expect(initRes.headers.get('mcp-session-id')).toBeTruthy();
    } finally {
      await server.kill();
    }
  });
});
