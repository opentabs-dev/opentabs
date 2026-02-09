import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { clearAllMocks, trackMock } from './test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Create mock functions before module mock
const mockIsConnected = trackMock(mock(() => true));

// Mock the websocket relay before importing http-server
mock.module('./websocket-relay', () => ({
  relay: {
    isConnected: mockIsConnected,
  },
}));

// Import after mocking
import { startHttpServer } from './http-server.js';
import { getHotState, registerSession } from './hot-reload.js';
import type { TransportHandle } from './hot-reload.js';

describe('HTTP Server', () => {
  let serverClose: (() => Promise<void>) | null = null;

  // Create a mock MCP server factory that registers sessions in hot state
  const createMockMcpServer = (sessionId?: string, transport?: TransportHandle, type?: 'sse' | 'stream'): McpServer => {
    const server = {
      tool: mock(() => {}),
      connect: mock(() => Promise.resolve(undefined)),
      close: mock(() => Promise.resolve(undefined)),
      isConnected: () => true,
    } as unknown as McpServer;

    if (sessionId && transport && type) {
      registerSession(sessionId, { server, transport, type, tools: new Map() });
    }

    return server;
  };

  beforeEach(() => {
    clearAllMocks();
    // Reset hot state for each test
    const state = getHotState();
    state.sessions.clear();
    state.httpServer = null;
    state.lastReload = null;
    state.reloadCount = 0;
  });

  afterEach(async () => {
    if (serverClose) {
      await serverClose();
      serverClose = null;
    }
    // Clean up hot state
    const state = getHotState();
    state.httpServer = null;
    state.sessions.clear();
  });

  describe('startHttpServer', () => {
    it('should start server and return close function', async () => {
      const { close } = await startHttpServer(createMockMcpServer, {
        port: 0, // Use random available port
        host: '127.0.0.1',
      });
      serverClose = close;

      expect(typeof close).toBe('function');
    });
  });

  describe('Health endpoint', () => {
    it('should return health status with hot reload info', async () => {
      const testPort = 13579;
      const { close } = await startHttpServer(createMockMcpServer, {
        port: testPort,
        host: '127.0.0.1',
      });
      serverClose = close;

      const response = await fetch(`http://127.0.0.1:${testPort}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('sseSessions');
      expect(data).toHaveProperty('streamSessions');
      expect(data).toHaveProperty('extension');
      expect(data).toHaveProperty('hotReload');
      expect(data.hotReload).toHaveProperty('reloadCount');
      expect(data.hotReload.reloadCount).toBe(0);
    });

    it('should report hot reload state after reloads', async () => {
      const testPort = 13579;
      const state = getHotState();
      state.reloadCount = 3;
      state.lastReload = {
        success: true,
        timestamp: Date.now(),
        patchedSessions: 2,
        toolCount: 120,
      };

      const { close } = await startHttpServer(createMockMcpServer, {
        port: testPort,
        host: '127.0.0.1',
      });
      serverClose = close;

      const response = await fetch(`http://127.0.0.1:${testPort}/health`);
      const data = await response.json();

      expect(data.hotReload.reloadCount).toBe(3);
      expect(data.hotReload.lastReload.success).toBe(true);
      expect(data.hotReload.lastReload.patchedSessions).toBe(2);
      expect(data.hotReload.lastReload.toolCount).toBe(120);
    });
  });

  describe('SSE endpoint (/sse)', () => {
    const testPort = 13580;

    beforeEach(async () => {
      const { close } = await startHttpServer(createMockMcpServer, {
        port: testPort,
        host: '127.0.0.1',
      });
      serverClose = close;
    });

    it('should handle GET requests for SSE connection', async () => {
      const http = await import('node:http');

      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: testPort,
            path: '/sse',
            method: 'GET',
            timeout: 500,
          },
          res => {
            expect(res.statusCode).toBe(200);
            res.destroy();
            resolve();
          },
        );

        req.on('timeout', () => {
          req.destroy();
          resolve();
        });

        req.on('error', err => {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ECONNRESET' || code === 'EPIPE') {
            resolve();
          } else {
            reject(err);
          }
        });

        req.end();
      });
    });

    it('should reject POST without sessionId', async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Missing sessionId parameter');
    });

    it('should reject POST with invalid sessionId', async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/sse?sessionId=invalid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Session not found');
    });
  });

  describe('Streamable HTTP endpoint (/mcp)', () => {
    const testPort = 13581;

    beforeEach(async () => {
      const { close } = await startHttpServer(createMockMcpServer, {
        port: testPort,
        host: '127.0.0.1',
      });
      serverClose = close;
    });

    it('should accept POST requests for initialization', async () => {
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      };

      const response = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(initRequest),
      });

      if (![200, 202].includes(response.status)) {
        const text = await response.text();
        console.error(`Unexpected response ${response.status}: ${text}`);
      }

      expect([200, 202]).toContain(response.status);

      const sessionId = response.headers.get('mcp-session-id');
      expect(sessionId).toBeTruthy();
    });

    it('should reject GET without session ID', async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
        method: 'GET',
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Session ID required for GET requests');
    });

    it('should reject requests with invalid session ID', async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
        method: 'GET',
        headers: { 'mcp-session-id': 'invalid-session-id' },
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Session not found');
    });

    it('should handle full request-response cycle', async () => {
      // Step 1: Initialize and get session ID
      const initResponse = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      });

      expect([200, 202]).toContain(initResponse.status);
      const sessionId = initResponse.headers.get('mcp-session-id');
      expect(sessionId).toBeTruthy();

      // Step 2: Send initialized notification
      const notifyResponse = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId!,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      });

      expect([200, 202, 204]).toContain(notifyResponse.status);

      // Step 3: List tools
      const toolsResponse = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId!,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      });

      expect([200, 202]).toContain(toolsResponse.status);
    });
  });

  describe('Server shutdown', () => {
    it('should close all connections on shutdown', async () => {
      const testPort = 13582;
      const { close } = await startHttpServer(createMockMcpServer, {
        port: testPort,
        host: '127.0.0.1',
      });

      // Verify server is running
      const healthResponse = await fetch(`http://127.0.0.1:${testPort}/health`);
      expect(healthResponse.status).toBe(200);

      // Close server
      await close();
      serverClose = null; // Already closed

      // Verify server is closed
      await expect(fetch(`http://127.0.0.1:${testPort}/health`)).rejects.toThrow();
    });
  });
});
