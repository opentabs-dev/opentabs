import { startMcpServer, createWsTestClient } from '../lib/index.js';
import { test, expect } from '@playwright/test';
import type { McpServerHarness, WsTestClient } from '../lib/index.js';

test.describe('MCP Server', () => {
  let mcpServer: McpServerHarness;

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();
  });

  test.afterEach(async () => {
    await mcpServer.stop();
  });

  test('should start on dynamically allocated ports', async () => {
    expect(mcpServer.wsPort).toBeGreaterThan(0);
    expect(mcpServer.httpPort).toBeGreaterThan(0);
    expect(mcpServer.wsPort).not.toBe(mcpServer.httpPort);
    expect(mcpServer.isReady()).toBe(true);
  });

  test('should respond to health check', async ({ request }) => {
    const response = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);

    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.status).toBeDefined();
    // Extension not connected in this test, so status should be degraded
    expect(body.extension).toBe('disconnected');
    expect(body.sseSessions).toBe(0);
    expect(body.streamSessions).toBe(0);
  });

  test('should accept WebSocket connections', async () => {
    const wsClient = createWsTestClient(mcpServer.wsPort);

    await wsClient.waitForConnection();
    expect(wsClient.isConnected()).toBe(true);

    wsClient.close();
  });
});

test.describe('WebSocket Relay', () => {
  let mcpServer: McpServerHarness;
  let wsClient: WsTestClient;

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();
    wsClient = createWsTestClient(mcpServer.wsPort);
    await wsClient.waitForConnection();
  });

  test.afterEach(async () => {
    wsClient.close();
    await mcpServer.stop();
  });

  test('should update health status when extension connects', async ({ request }) => {
    // Initial health check - extension connected via wsClient
    const response = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);

    expect(response.ok()).toBe(true);

    const body = await response.json();
    // wsClient simulates the extension connection
    expect(body.extension).toBe('connected');
  });

  test('should handle reconnection gracefully', async () => {
    // Close the first connection
    wsClient.close();

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 500));

    // Create a new connection
    const newClient = createWsTestClient(mcpServer.wsPort);
    await newClient.waitForConnection();

    expect(newClient.isConnected()).toBe(true);

    newClient.close();
  });

  test('should send server_info message with serverPath on connection', async () => {
    // Close existing connection and create a fresh one to capture the server_info message
    wsClient.close();

    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 200));

    // Create new connection
    const newClient = createWsTestClient(mcpServer.wsPort);
    await newClient.waitForConnection();

    // Wait for the server_info message (sent immediately on connection)
    const serverInfoMessage = (await newClient.waitForMessage(3000)) as {
      type: string;
      serverPath: string;
    };

    expect(serverInfoMessage.type).toBe('server_info');
    expect(serverInfoMessage.serverPath).toBeTruthy();
    expect(typeof serverInfoMessage.serverPath).toBe('string');
    // serverPath should be an absolute path
    expect(serverInfoMessage.serverPath.startsWith('/')).toBe(true);

    newClient.close();
  });
});
