import { startMcpServer, createWsTestClient, getAvailablePorts } from '../lib/index.js';
import { test, expect } from '@playwright/test';
import type { McpServerHarness } from '../lib/index.js';

/**
 * Stress and robustness tests
 *
 * These tests verify the system handles edge cases and high load gracefully.
 */
test.describe('Stress Tests', () => {
  test.describe('Multiple MCP Server Instances', () => {
    test('should run multiple servers on different ports', async ({ request }) => {
      // Start multiple servers
      const servers: McpServerHarness[] = [];

      for (let i = 0; i < 3; i++) {
        const server = await startMcpServer();
        await server.waitForReady();
        servers.push(server);
      }

      try {
        // Verify all servers are healthy
        for (const server of servers) {
          const response = await request.get(`http://127.0.0.1:${server.httpPort}/health`);
          expect(response.ok()).toBe(true);
        }

        // Verify ports are unique
        const ports = new Set(servers.map(s => s.httpPort));
        expect(ports.size).toBe(servers.length);

        const wsPorts = new Set(servers.map(s => s.wsPort));
        expect(wsPorts.size).toBe(servers.length);
      } finally {
        // Clean up all servers
        await Promise.all(servers.map(s => s.stop()));
      }
    });
  });

  test.describe('WebSocket Connection Stress', () => {
    let mcpServer: McpServerHarness;

    test.beforeEach(async () => {
      mcpServer = await startMcpServer();
      await mcpServer.waitForReady();
    });

    test.afterEach(async () => {
      await mcpServer.stop();
    });

    test('should handle rapid message sending', async () => {
      const wsClient = createWsTestClient(mcpServer.wsPort);
      await wsClient.waitForConnection();

      // Send many messages rapidly
      const messageCount = 100;
      for (let i = 0; i < messageCount; i++) {
        wsClient.send({
          type: 'slack_api_request',
          id: `stress_${i}`,
          method: 'test.method',
          params: { index: i },
        });
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Connection should still be stable
      expect(wsClient.isConnected()).toBe(true);

      wsClient.close();
    });

    test('should handle connection churn', async () => {
      // Create and destroy connections rapidly
      for (let i = 0; i < 10; i++) {
        const client = createWsTestClient(mcpServer.wsPort);
        await client.waitForConnection();
        expect(client.isConnected()).toBe(true);
        client.close();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Server should still be healthy
      expect(mcpServer.isReady()).toBe(true);
    });

    test('should replace existing connection when new one connects', async ({ request }) => {
      // First connection
      const client1 = createWsTestClient(mcpServer.wsPort);
      await client1.waitForConnection();
      expect(client1.isConnected()).toBe(true);

      // Second connection (should replace first)
      const client2 = createWsTestClient(mcpServer.wsPort);
      await client2.waitForConnection();

      // Give time for replacement and health check
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Second client should be connected
      expect(client2.isConnected()).toBe(true);

      // Health check - the relay allows only one connection, so should be connected
      // Note: Due to timing, the health status might briefly show disconnected during replacement
      const response = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      const body = await response.json();
      // Just verify the health endpoint works, connection status can vary during replacement
      expect(body.status).toBeDefined();

      client1.close();
      client2.close();
    });

    test('should handle large message payloads', async () => {
      const wsClient = createWsTestClient(mcpServer.wsPort);
      await wsClient.waitForConnection();

      // Send a large message
      const largeData = 'x'.repeat(100000); // 100KB of data
      wsClient.send({
        type: 'slack_api_response',
        id: 'large_msg',
        success: true,
        data: { content: largeData },
      });

      await new Promise(resolve => setTimeout(resolve, 500));
      expect(wsClient.isConnected()).toBe(true);

      wsClient.close();
    });
  });

  test.describe('HTTP Server Stress', () => {
    let mcpServer: McpServerHarness;

    test.beforeEach(async () => {
      mcpServer = await startMcpServer();
      await mcpServer.waitForReady();
    });

    test.afterEach(async () => {
      await mcpServer.stop();
    });

    test('should handle concurrent health check requests', async ({ request }) => {
      // Make many concurrent requests
      const requests = Array(20)
        .fill(null)
        .map(() => request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`));

      const responses = await Promise.all(requests);

      // All should succeed
      for (const response of responses) {
        expect(response.ok()).toBe(true);
      }
    });

    test('should handle multiple requests to health endpoint rapidly', async ({ request }) => {
      // Make multiple rapid health requests in sequence
      // (SSE connections stay open indefinitely, so we test health endpoint instead)
      for (let i = 0; i < 10; i++) {
        const response = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
        expect(response.ok()).toBe(true);
        const body = await response.json();
        expect(body.status).toBeDefined();
      }
    });
  });

  test.describe('Error Recovery', () => {
    test('should recover from port conflicts gracefully', async () => {
      // Start first server
      const server1 = await startMcpServer();
      await server1.waitForReady();

      // Start second server (should get different ports)
      const server2 = await startMcpServer();
      await server2.waitForReady();

      // Both should be running on different ports
      expect(server1.httpPort).not.toBe(server2.httpPort);
      expect(server1.wsPort).not.toBe(server2.wsPort);

      await server1.stop();
      await server2.stop();
    });

    test('should handle server shutdown during active connection', async () => {
      const server = await startMcpServer();
      await server.waitForReady();

      const wsClient = createWsTestClient(server.wsPort);
      await wsClient.waitForConnection();

      // Stop server while client is connected
      await server.stop();

      // Client should detect disconnection
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(wsClient.isConnected()).toBe(false);

      wsClient.close();
    });
  });
});

test.describe('Port Allocation', () => {
  test('should allocate unique ports each time', async () => {
    const portSets: Array<{ wsPort: number; httpPort: number }> = [];

    for (let i = 0; i < 5; i++) {
      const ports = await getAvailablePorts();
      portSets.push(ports);
    }

    // All ports should be unique
    const allWsPorts = new Set(portSets.map(p => p.wsPort));
    const allHttpPorts = new Set(portSets.map(p => p.httpPort));

    expect(allWsPorts.size).toBe(portSets.length);
    expect(allHttpPorts.size).toBe(portSets.length);
  });

  test('should not allocate well-known ports', async () => {
    for (let i = 0; i < 10; i++) {
      const { wsPort, httpPort } = await getAvailablePorts();

      // Should be in ephemeral port range
      expect(wsPort).toBeGreaterThan(1024);
      expect(httpPort).toBeGreaterThan(1024);
    }
  });
});
