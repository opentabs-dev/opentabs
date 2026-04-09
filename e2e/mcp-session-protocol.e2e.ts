/**
 * MCP session protocol compliance E2E tests — verifies the correct HTTP status
 * codes for stale, missing, and valid session scenarios per MCP spec (2025-03-26).
 *
 * The MCP spec section 3 states:
 * - "The server MAY terminate the session at any time, after which it MUST
 *    respond to requests containing that session ID with HTTP 404 Not Found."
 * - "When a client receives HTTP 404 in response to a request containing an
 *    Mcp-Session-Id, it MUST start a new session by sending a new
 *    InitializeRequest without a session ID attached."
 *
 * These tests exercise the production server (not dev proxy) to verify the
 * actual session management behavior that MCP clients experience.
 */

import { randomUUID } from 'node:crypto';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createTestConfigDir,
  expect,
  startMcpServer,
  test,
} from './fixtures.js';

/**
 * Make a raw HTTP request to the MCP server. Uses fetch() directly so we can
 * inspect the exact status code, bypassing the MCP client's error handling.
 */
const rawRequest = async (
  port: number,
  endpoint: string,
  opts: {
    method: 'POST' | 'GET' | 'DELETE';
    sessionId?: string;
    secret?: string;
    body?: unknown;
  },
): Promise<{ status: number; body: string }> => {
  const headers: Record<string, string> = {};

  if (opts.method === 'POST') {
    headers['Content-Type'] = 'application/json';
    headers.Accept = 'application/json, text/event-stream';
  }
  if (opts.method === 'GET') {
    headers.Accept = 'text/event-stream';
  }
  if (opts.sessionId) {
    headers['mcp-session-id'] = opts.sessionId;
  }
  if (opts.secret) {
    headers.Authorization = `Bearer ${opts.secret}`;
  }

  const fetchOpts: RequestInit = {
    method: opts.method,
    headers,
    signal: AbortSignal.timeout(10_000),
  };
  if (opts.body !== undefined) {
    fetchOpts.body = JSON.stringify(opts.body);
  }

  const res = await fetch(`http://localhost:${port}${endpoint}`, fetchOpts);
  const text = await res.text();
  return { status: res.status, body: text };
};

/** JSON-RPC tools/list request body (a non-initialize request). */
const toolsListBody = { jsonrpc: '2.0', method: 'tools/list', params: {}, id: 1 };

/**
 * Helper: start a production-mode server, initialize a session, and return the
 * session ID along with the server handle. Uses production mode (not dev proxy)
 * so that requests hit handleMcp/handleGatewayMcp directly.
 */
const setupSession = async () => {
  const configDir = createTestConfigDir();
  const server = await startMcpServer(configDir, false);
  const client = createMcpClient(server.port, server.secret);
  await client.initialize();
  const sessionId = client.sessionId;
  expect(sessionId).toBeTruthy();
  return { configDir, server, client, sessionId: sessionId as string };
};

// ---------------------------------------------------------------------------
// /mcp endpoint tests
// ---------------------------------------------------------------------------

test.describe('MCP session protocol compliance — /mcp endpoint', () => {
  test('POST with stale session ID returns 404', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      const staleSessionId = randomUUID();
      const res = await rawRequest(server.port, '/mcp', {
        method: 'POST',
        sessionId: staleSessionId,
        secret: server.secret,
        body: toolsListBody,
      });
      expect(res.status).toBe(404);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('POST without session ID and non-initialize body returns 400', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      const res = await rawRequest(server.port, '/mcp', {
        method: 'POST',
        secret: server.secret,
        body: toolsListBody,
      });
      expect(res.status).toBe(400);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('GET with stale session ID returns 404', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      const staleSessionId = randomUUID();
      const res = await rawRequest(server.port, '/mcp', {
        method: 'GET',
        sessionId: staleSessionId,
        secret: server.secret,
      });
      expect(res.status).toBe(404);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('GET without session ID returns 405', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      const res = await rawRequest(server.port, '/mcp', {
        method: 'GET',
        secret: server.secret,
      });
      expect(res.status).toBe(405);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('DELETE with stale session ID returns 404', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      const staleSessionId = randomUUID();
      const res = await rawRequest(server.port, '/mcp', {
        method: 'DELETE',
        sessionId: staleSessionId,
        secret: server.secret,
      });
      expect(res.status).toBe(404);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('DELETE without session ID returns 405', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      const res = await rawRequest(server.port, '/mcp', {
        method: 'DELETE',
        secret: server.secret,
      });
      expect(res.status).toBe(405);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('valid session unaffected when stale session gets 404', async () => {
    const { configDir, server, client } = await setupSession();

    try {
      // A fabricated session ID should get 404
      const staleRes = await rawRequest(server.port, '/mcp', {
        method: 'POST',
        sessionId: randomUUID(),
        secret: server.secret,
        body: toolsListBody,
      });
      expect(staleRes.status).toBe(404);

      // The valid session should still work
      const tools = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);

      await client.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// /mcp/gateway endpoint tests
// ---------------------------------------------------------------------------

test.describe('MCP session protocol compliance — /mcp/gateway endpoint', () => {
  test('POST with stale session ID returns 404', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      const staleSessionId = randomUUID();
      const res = await rawRequest(server.port, '/mcp/gateway', {
        method: 'POST',
        sessionId: staleSessionId,
        secret: server.secret,
        body: toolsListBody,
      });
      expect(res.status).toBe(404);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('POST without session ID and non-initialize body returns 400', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      const res = await rawRequest(server.port, '/mcp/gateway', {
        method: 'POST',
        secret: server.secret,
        body: toolsListBody,
      });
      expect(res.status).toBe(400);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('GET with stale session ID returns 404', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      const staleSessionId = randomUUID();
      const res = await rawRequest(server.port, '/mcp/gateway', {
        method: 'GET',
        sessionId: staleSessionId,
        secret: server.secret,
      });
      expect(res.status).toBe(404);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('GET without session ID returns 405', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      const res = await rawRequest(server.port, '/mcp/gateway', {
        method: 'GET',
        secret: server.secret,
      });
      expect(res.status).toBe(405);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('DELETE with stale session ID returns 404', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      const staleSessionId = randomUUID();
      const res = await rawRequest(server.port, '/mcp/gateway', {
        method: 'DELETE',
        sessionId: staleSessionId,
        secret: server.secret,
      });
      expect(res.status).toBe(404);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('DELETE without session ID returns 405', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      const res = await rawRequest(server.port, '/mcp/gateway', {
        method: 'DELETE',
        secret: server.secret,
      });
      expect(res.status).toBe(405);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });

  test('valid session unaffected when stale session gets 404', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      // Initialize a session on the gateway endpoint via fetch (not rawRequest)
      // so we can read the mcp-session-id response header.
      const initFetch = await fetch(`http://localhost:${server.port}/mcp/gateway`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${server.secret}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'e2e-test-client', version: '0.0.1' },
          },
          id: 1,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      expect(initFetch.status).toBe(200);
      const gatewaySessionId = initFetch.headers.get('mcp-session-id');
      expect(gatewaySessionId).toBeTruthy();

      // Send initialized notification
      await fetch(`http://localhost:${server.port}/mcp/gateway`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${server.secret}`,
          'mcp-session-id': gatewaySessionId as string,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
        signal: AbortSignal.timeout(10_000),
      });

      // A fabricated session ID should get 404
      const staleRes = await rawRequest(server.port, '/mcp/gateway', {
        method: 'POST',
        sessionId: randomUUID(),
        secret: server.secret,
        body: toolsListBody,
      });
      expect(staleRes.status).toBe(404);

      // The valid gateway session should still work — list tools
      const toolsRes = await fetch(`http://localhost:${server.port}/mcp/gateway`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${server.secret}`,
          'mcp-session-id': gatewaySessionId as string,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 2 }),
        signal: AbortSignal.timeout(10_000),
      });
      expect(toolsRes.status).toBe(200);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});
