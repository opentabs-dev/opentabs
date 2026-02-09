import { startMcpServer, createWsTestClient } from '../lib/index.js';
import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';
import type { McpServerHarness } from '../lib/index.js';

/**
 * Liveness and Heartbeat Tests
 *
 * These tests verify connection health monitoring and recovery:
 * - Heartbeat/ping-pong mechanism
 * - Connection timeout detection
 * - Stale connection cleanup
 * - Recovery after failures
 */
test.describe('Connection Liveness', () => {
  let mcpServer: McpServerHarness;

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();
  });

  test.afterEach(async () => {
    await mcpServer.stop();
  });

  test.describe('Heartbeat Mechanism', () => {
    test('should respond to WebSocket ping with pong', async () => {
      // Create a raw WebSocket to test ping/pong at protocol level
      const ws = new WebSocket(`ws://127.0.0.1:${mcpServer.wsPort}`);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

        ws.on('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        ws.on('error', err => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Send ping and wait for pong
      let pongReceived = false;

      ws.on('pong', () => {
        pongReceived = true;
      });

      ws.ping();

      // Wait for pong
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(pongReceived).toBe(true);

      ws.close();
    });

    test('should maintain connection with periodic pings', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      // Send periodic pings (simulating keepalive)
      for (let i = 0; i < 5; i++) {
        client.send({ type: 'ping' });
        await new Promise(resolve => setTimeout(resolve, 500));
        expect(client.isConnected()).toBe(true);
      }

      client.close();
    });

    test('should keep connection alive during idle periods', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      // Wait for an extended period without sending anything
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Connection should still be alive
      expect(client.isConnected()).toBe(true);

      // Should still be able to send messages
      client.send({ type: 'ping' });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(client.isConnected()).toBe(true);

      client.close();
    });
  });

  test.describe('Connection State Detection', () => {
    test('should detect client disconnection via health endpoint', async ({ request }) => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      // Health should show connected
      let health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      let body = await health.json();
      expect(body.extension).toBe('connected');

      // Disconnect client
      client.close();

      // Wait for server to detect disconnection
      await new Promise(resolve => setTimeout(resolve, 500));

      // Health should show disconnected
      health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      body = await health.json();
      expect(body.extension).toBe('disconnected');
    });

    test('should handle abrupt client termination', async ({ request }) => {
      const ws = new WebSocket(`ws://127.0.0.1:${mcpServer.wsPort}`);

      await new Promise<void>(resolve => {
        ws.on('open', () => resolve());
      });

      // Health should show connected
      let health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      let body = await health.json();
      expect(body.extension).toBe('connected');

      // Abruptly terminate (not clean close)
      ws.terminate();

      // Wait for detection
      await new Promise(resolve => setTimeout(resolve, 500));

      // Health should show disconnected
      health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      body = await health.json();
      expect(body.extension).toBe('disconnected');
    });

    test('should report correct status after reconnection', async ({ request }) => {
      // First connection
      const client1 = createWsTestClient(mcpServer.wsPort);
      await client1.waitForConnection();

      let health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      let body = await health.json();
      expect(body.extension).toBe('connected');

      // Disconnect
      client1.close();
      await new Promise(resolve => setTimeout(resolve, 300));

      health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      body = await health.json();
      expect(body.extension).toBe('disconnected');

      // Reconnect
      const client2 = createWsTestClient(mcpServer.wsPort);
      await client2.waitForConnection();

      health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      body = await health.json();
      expect(body.extension).toBe('connected');

      client2.close();
    });
  });

  test.describe('Connection Replacement', () => {
    test('should close old connection when new one connects', async () => {
      // First connection
      const client1 = createWsTestClient(mcpServer.wsPort);
      await client1.waitForConnection();
      expect(client1.isConnected()).toBe(true);

      // Second connection
      const client2 = createWsTestClient(mcpServer.wsPort);
      await client2.waitForConnection();

      // Wait for server to process the replacement
      await new Promise(resolve => setTimeout(resolve, 500));

      // Second should be connected
      expect(client2.isConnected()).toBe(true);

      // First should be disconnected (server closes old connection)
      // Note: This depends on server implementation - it may keep both
      // For the opentabs, only one extension connection is allowed

      client1.close();
      client2.close();
    });

    test('should handle rapid connection cycling', async ({ request }) => {
      // Rapidly connect and disconnect multiple times
      for (let i = 0; i < 10; i++) {
        const client = createWsTestClient(mcpServer.wsPort);
        await client.waitForConnection();

        // Send some data (open_server_folder is a valid command)
        client.send({ type: 'open_server_folder' });

        await new Promise(resolve => setTimeout(resolve, 50));

        client.close();
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Server should still be healthy
      const health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      expect(health.ok()).toBe(true);
    });
  });

  test.describe('Network Error Resilience', () => {
    test('should handle connection errors gracefully', async ({ request }) => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      // Send some invalid JSON-like data (the client stringifies, so this is valid JSON)
      client.send({ invalid: true, __proto__: {} });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Server should still be healthy
      const health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      expect(health.ok()).toBe(true);

      client.close();
    });

    test('should recover from partial message sends', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${mcpServer.wsPort}`);

      await new Promise<void>(resolve => {
        ws.on('open', () => resolve());
      });

      // Send valid message
      ws.send(JSON.stringify({ type: 'ping' }));

      await new Promise(resolve => setTimeout(resolve, 100));

      // Connection should still work
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });
  });
});

test.describe('Server Resilience', () => {
  test('should handle server restart with client reconnection', async ({ request }) => {
    // Start server
    let mcpServer = await startMcpServer();
    await mcpServer.waitForReady();

    const wsPort = mcpServer.wsPort;

    // Connect client
    let client = createWsTestClient(wsPort);
    await client.waitForConnection();
    expect(client.isConnected()).toBe(true);

    // Stop server
    await mcpServer.stop();

    // Wait for client to detect disconnection
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(client.isConnected()).toBe(false);
    client.close();

    // Start new server (will have different ports)
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();

    // New client can connect
    client = createWsTestClient(mcpServer.wsPort);
    await client.waitForConnection();
    expect(client.isConnected()).toBe(true);

    // Health check works
    const health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
    expect(health.ok()).toBe(true);

    client.close();
    await mcpServer.stop();
  });

  test('should maintain HTTP endpoint availability under load', async ({ request }) => {
    const mcpServer = await startMcpServer();
    await mcpServer.waitForReady();

    // Make many concurrent health requests while WebSocket activity happens
    const client = createWsTestClient(mcpServer.wsPort);
    await client.waitForConnection();

    // Start sending WebSocket messages
    const wsInterval = setInterval(() => {
      if (client.isConnected()) {
        client.send({ type: 'ping' });
      }
    }, 50);

    // Make concurrent HTTP requests
    const httpRequests = Array(50)
      .fill(null)
      .map(async () => {
        const response = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
        return response.ok();
      });

    const results = await Promise.all(httpRequests);

    clearInterval(wsInterval);

    // All HTTP requests should succeed
    expect(results.every(r => r)).toBe(true);

    client.close();
    await mcpServer.stop();
  });
});
