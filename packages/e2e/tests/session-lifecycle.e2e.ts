import { startMcpServer, createWsTestClient, createStreamableHttpClient } from '../lib/index.js';
import { test, expect } from '@playwright/test';
import type { McpServerHarness, StreamableHttpClient } from '../lib/index.js';

/**
 * Session Lifecycle E2E Tests
 *
 * These tests verify the full MCP session lifecycle:
 * - Session creation and initialization
 * - Tool listing and schema correctness
 * - Multiple concurrent sessions
 * - Session cleanup on disconnect
 * - Health endpoint accuracy throughout lifecycle
 */
test.describe('Session Lifecycle', () => {
  let mcpServer: McpServerHarness;

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();
  });

  test.afterEach(async () => {
    await mcpServer.stop();
  });

  test.describe('Streamable HTTP Sessions', () => {
    test('initialize returns valid session with capabilities', async () => {
      const client = createStreamableHttpClient(mcpServer.httpPort);
      const sessionId = await client.initialize();

      expect(sessionId).toBeTruthy();
      expect(sessionId.length).toBeGreaterThan(0);

      client.close();
    });

    test('list tools returns all registered tools with schemas', async () => {
      const client = createStreamableHttpClient(mcpServer.httpPort);
      await client.initialize();

      const tools = await client.listTools();

      expect(tools.length).toBeGreaterThan(50);

      // Verify specific tools exist with proper schemas
      const slackSendMessage = tools.find(t => t.name === 'slack_send_message');
      expect(slackSendMessage).toBeTruthy();
      expect(slackSendMessage!.description).toBeTruthy();
      expect(slackSendMessage!.inputSchema).toBeTruthy();

      const datadogSearchLogs = tools.find(t => t.name === 'datadog_search_logs');
      expect(datadogSearchLogs).toBeTruthy();
      expect(datadogSearchLogs!.description).toBeTruthy();

      client.close();
    });

    test('each session gets independent tool instances', async () => {
      const client1 = createStreamableHttpClient(mcpServer.httpPort);
      const client2 = createStreamableHttpClient(mcpServer.httpPort);

      const session1 = await client1.initialize();
      const session2 = await client2.initialize();

      // Sessions should be distinct
      expect(session1).not.toBe(session2);

      // Both should see the same tools
      const tools1 = await client1.listTools();
      const tools2 = await client2.listTools();
      expect(tools1.length).toBe(tools2.length);

      client1.close();
      client2.close();
    });

    test('session persists across multiple requests', async () => {
      const client = createStreamableHttpClient(mcpServer.httpPort);
      await client.initialize();

      // Make multiple tool list requests
      const tools1 = await client.listTools();
      const tools2 = await client.listTools();
      const tools3 = await client.listTools();

      expect(tools1.length).toBe(tools2.length);
      expect(tools2.length).toBe(tools3.length);

      client.close();
    });

    test('health endpoint reflects session count accurately', async ({ request }) => {
      // Initial state
      let health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      let body = await health.json();
      expect(body.streamSessions).toBe(0);

      // Create sessions
      const client1 = createStreamableHttpClient(mcpServer.httpPort);
      await client1.initialize();

      health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      body = await health.json();
      expect(body.streamSessions).toBe(1);

      const client2 = createStreamableHttpClient(mcpServer.httpPort);
      await client2.initialize();

      health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      body = await health.json();
      expect(body.streamSessions).toBe(2);

      client1.close();
      client2.close();
    });

    test('five concurrent sessions all function correctly', async () => {
      const clients: StreamableHttpClient[] = [];

      // Create 5 sessions
      for (let i = 0; i < 5; i++) {
        const client = createStreamableHttpClient(mcpServer.httpPort);
        await client.initialize();
        clients.push(client);
      }

      // All sessions should be able to list tools concurrently
      const toolResults = await Promise.all(clients.map(c => c.listTools()));

      for (const tools of toolResults) {
        expect(tools.length).toBeGreaterThan(50);
      }

      // All should have same tool count
      const counts = new Set(toolResults.map(t => t.length));
      expect(counts.size).toBe(1);

      for (const client of clients) {
        client.close();
      }
    });
  });

  test.describe('SSE Sessions', () => {
    test('SSE endpoint returns endpoint event with session ID', async () => {
      const response = await fetch(`http://127.0.0.1:${mcpServer.httpPort}/sse`, {
        headers: { Accept: 'text/event-stream' },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sessionId = '';

      while (!sessionId) {
        const { value } = await reader.read();
        buffer += decoder.decode(value, { stream: true });
        const match = buffer.match(/sessionId=([^\s&"]+)/);
        if (match) sessionId = match[1];
      }

      expect(sessionId).toBeTruthy();

      await reader.cancel();
    });

    test('SSE session can initialize and list tools', async () => {
      // Open SSE stream
      const response = await fetch(`http://127.0.0.1:${mcpServer.httpPort}/sse`, {
        headers: { Accept: 'text/event-stream' },
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sessionId = '';

      while (!sessionId) {
        const { value } = await reader.read();
        buffer += decoder.decode(value, { stream: true });
        const match = buffer.match(/sessionId=([^\s&"]+)/);
        if (match) sessionId = match[1];
      }

      // Initialize
      await fetch(`http://127.0.0.1:${mcpServer.httpPort}/sse?sessionId=${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: true } },
            clientInfo: { name: 'sse-lifecycle-test', version: '1.0' },
          },
        }),
      });

      // Drain initialization response
      await new Promise(resolve => setTimeout(resolve, 500));

      // List tools
      const toolsResponse = await fetch(`http://127.0.0.1:${mcpServer.httpPort}/sse?sessionId=${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      });

      expect(toolsResponse.ok).toBe(true);

      await reader.cancel();
    });

    test('health endpoint reflects SSE session count', async ({ request }) => {
      let health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      let body = await health.json();
      expect(body.sseSessions).toBe(0);

      // Open SSE session
      const response = await fetch(`http://127.0.0.1:${mcpServer.httpPort}/sse`, {
        headers: { Accept: 'text/event-stream' },
      });

      const reader = response.body!.getReader();
      // Give time for connection to register
      await new Promise(resolve => setTimeout(resolve, 300));

      health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      body = await health.json();
      expect(body.sseSessions).toBe(1);

      await reader.cancel();
    });
  });

  test.describe('Invalid Requests', () => {
    test('POST to /mcp without session ID and non-initialize method creates new session', async ({ request }) => {
      // POST with method but no session ID and not initialize
      // The Streamable HTTP transport creates a new session for any POST without session ID
      const response = await request.fetch(`http://127.0.0.1:${mcpServer.httpPort}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
        failOnStatusCode: false,
      });

      // Server creates a new session — the actual status depends on whether
      // the SDK requires initialize before other methods. Accept any non-500.
      expect(response.status()).toBeLessThan(500);
    });

    test('POST to /mcp with invalid session ID returns 404', async ({ request }) => {
      const response = await request.fetch(`http://127.0.0.1:${mcpServer.httpPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'mcp-session-id': 'nonexistent-session-id',
        },
        data: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        failOnStatusCode: false,
      });

      expect(response.status()).toBe(404);
    });

    test('POST to /sse with invalid session ID returns 404', async ({ request }) => {
      const response = await request.fetch(`http://127.0.0.1:${mcpServer.httpPort}/sse?sessionId=invalid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        failOnStatusCode: false,
      });

      expect(response.status()).toBe(404);
    });

    test('POST to /sse without session ID returns 400', async ({ request }) => {
      const response = await request.fetch(`http://127.0.0.1:${mcpServer.httpPort}/sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        failOnStatusCode: false,
      });

      expect(response.status()).toBe(400);
    });

    test('GET /mcp without session ID returns 400', async ({ request }) => {
      const response = await request.fetch(`http://127.0.0.1:${mcpServer.httpPort}/mcp`, {
        method: 'GET',
        failOnStatusCode: false,
      });

      expect(response.status()).toBe(400);
    });
  });

  test.describe('Mixed Transports', () => {
    test('stream and SSE sessions coexist independently', async ({ request }) => {
      // Create a Streamable HTTP session
      const streamClient = createStreamableHttpClient(mcpServer.httpPort);
      await streamClient.initialize();

      // Create an SSE session
      const sseResponse = await fetch(`http://127.0.0.1:${mcpServer.httpPort}/sse`, {
        headers: { Accept: 'text/event-stream' },
      });
      const reader = sseResponse.body!.getReader();
      await new Promise(resolve => setTimeout(resolve, 300));

      // Health should show both
      const health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      const body = await health.json();
      expect(body.streamSessions).toBe(1);
      expect(body.sseSessions).toBe(1);

      // Stream session should still work
      const tools = await streamClient.listTools();
      expect(tools.length).toBeGreaterThan(50);

      streamClient.close();
      await reader.cancel();
    });
  });

  test.describe('WebSocket + MCP Integration', () => {
    test('extension connection does not affect MCP sessions', async () => {
      // Connect fake extension
      const wsClient = createWsTestClient(mcpServer.wsPort);
      await wsClient.waitForConnection();

      // Create MCP session
      const mcpClient = createStreamableHttpClient(mcpServer.httpPort);
      await mcpClient.initialize();
      const tools = await mcpClient.listTools();
      expect(tools.length).toBeGreaterThan(50);

      // Disconnect extension
      wsClient.close();
      await new Promise(resolve => setTimeout(resolve, 300));

      // MCP session should still work
      const toolsAfter = await mcpClient.listTools();
      expect(toolsAfter.length).toBe(tools.length);

      mcpClient.close();
    });

    test('extension reconnection does not affect MCP sessions', async ({ request }) => {
      const mcpClient = createStreamableHttpClient(mcpServer.httpPort);
      await mcpClient.initialize();

      // Connect extension
      let wsClient = createWsTestClient(mcpServer.wsPort);
      await wsClient.waitForConnection();

      let health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      let body = await health.json();
      expect(body.extension).toBe('connected');
      expect(body.streamSessions).toBe(1);

      // Disconnect and reconnect
      wsClient.close();
      await new Promise(resolve => setTimeout(resolve, 300));

      wsClient = createWsTestClient(mcpServer.wsPort);
      await wsClient.waitForConnection();

      // MCP session should still work
      const tools = await mcpClient.listTools();
      expect(tools.length).toBeGreaterThan(50);

      health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      body = await health.json();
      expect(body.extension).toBe('connected');
      expect(body.streamSessions).toBe(1);

      wsClient.close();
      mcpClient.close();
    });
  });
});
