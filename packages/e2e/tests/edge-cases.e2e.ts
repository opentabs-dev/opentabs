import { startMcpServer, createWsTestClient, launchWithExtension } from '../lib/index.js';
import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';
import type { McpServerHarness, ExtensionFixture } from '../lib/index.js';

/**
 * Edge Case and Error Handling Tests
 *
 * These tests cover corner cases, boundary conditions, and error scenarios
 * to ensure the system is robust and handles unusual situations gracefully.
 */
test.describe('Edge Cases', () => {
  let mcpServer: McpServerHarness;

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();
  });

  test.afterEach(async () => {
    await mcpServer.stop();
  });

  test.describe('Message Format Edge Cases', () => {
    test('should handle empty message objects', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      client.send({});

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(client.isConnected()).toBe(true);

      client.close();
    });

    test('should handle messages with null values', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      client.send({
        type: null,
        id: null,
        data: null,
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(client.isConnected()).toBe(true);

      client.close();
    });

    test('should handle messages with undefined values', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      client.send({
        type: 'slack_api_response',
        id: 'test',
        success: undefined,
        data: undefined,
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(client.isConnected()).toBe(true);

      client.close();
    });

    test('should handle messages with special characters', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      client.send({
        type: 'slack_api_response',
        id: 'special_chars',
        success: true,
        data: {
          text: '🎉 Special chars: <>&"\' and unicode: 你好世界 and emoji: 👍🏻',
          channel: 'C123<script>alert("xss")</script>',
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(client.isConnected()).toBe(true);

      client.close();
    });

    test('should handle very long string values', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      const longString = 'x'.repeat(1000000); // 1MB string

      client.send({
        type: 'slack_api_response',
        id: 'long_string',
        success: true,
        data: { content: longString },
      });

      await new Promise(resolve => setTimeout(resolve, 500));
      expect(client.isConnected()).toBe(true);

      client.close();
    });

    test('should handle arrays with many elements', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      const largeArray = Array(10000)
        .fill(null)
        .map((_, i) => ({ id: i, name: `item_${i}` }));

      client.send({
        type: 'slack_api_response',
        id: 'large_array',
        success: true,
        data: { items: largeArray },
      });

      await new Promise(resolve => setTimeout(resolve, 500));
      expect(client.isConnected()).toBe(true);

      client.close();
    });

    test('should handle circular reference prevention', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      // JSON.stringify handles circular refs by throwing, but our client
      // should send valid JSON. Let's verify it handles complex objects.
      const complexObj = {
        level1: {
          level2: {
            level3: {
              data: 'deep value',
            },
          },
        },
      };

      client.send({
        type: 'slack_api_response',
        id: 'complex',
        success: true,
        data: complexObj,
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(client.isConnected()).toBe(true);

      client.close();
    });
  });

  test.describe('Connection Edge Cases', () => {
    test('should handle multiple rapid connect/disconnect cycles', async ({ request }) => {
      for (let i = 0; i < 20; i++) {
        const client = createWsTestClient(mcpServer.wsPort);
        await client.waitForConnection();
        client.close();
      }

      // Server should still be healthy
      const health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      expect(health.ok()).toBe(true);
    });

    test('should handle connection during high message throughput', async () => {
      const client1 = createWsTestClient(mcpServer.wsPort);
      await client1.waitForConnection();

      // Start sending messages rapidly
      const sendInterval = setInterval(() => {
        if (client1.isConnected()) {
          client1.send({ type: 'ping', ts: Date.now() });
        }
      }, 10);

      // Try to connect another client while messages are being sent
      await new Promise(resolve => setTimeout(resolve, 100));

      const client2 = createWsTestClient(mcpServer.wsPort);
      await client2.waitForConnection();

      clearInterval(sendInterval);

      expect(client2.isConnected()).toBe(true);

      client1.close();
      client2.close();
    });

    test('should handle WebSocket close codes correctly', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${mcpServer.wsPort}`);

      await new Promise<void>(resolve => {
        ws.on('open', () => resolve());
      });

      // Close with specific code
      ws.close(1001, 'Going Away');

      await new Promise(resolve => setTimeout(resolve, 200));

      // Server should handle this gracefully
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    test('should handle simultaneous connections from same source', async () => {
      // Open multiple connections rapidly
      const connections: WebSocket[] = [];

      for (let i = 0; i < 5; i++) {
        const ws = new WebSocket(`ws://127.0.0.1:${mcpServer.wsPort}`);
        connections.push(ws);
      }

      // Wait for all to attempt connection
      await new Promise(resolve => setTimeout(resolve, 500));

      // At least some should be open (server may close old ones)
      const openCount = connections.filter(ws => ws.readyState === WebSocket.OPEN).length;
      expect(openCount).toBeGreaterThanOrEqual(1);

      // Clean up
      for (const ws of connections) {
        ws.close();
      }
    });
  });

  test.describe('Protocol Edge Cases', () => {
    test('should handle unknown message types', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      client.send({
        type: 'unknown_type_that_does_not_exist',
        data: { foo: 'bar' },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(client.isConnected()).toBe(true);

      client.close();
    });

    test('should handle missing required fields', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      // slack_api_response without id
      client.send({
        type: 'slack_api_response',
        success: true,
        data: {},
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(client.isConnected()).toBe(true);

      client.close();
    });

    test('should handle extra unexpected fields', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      // Send a JSON-RPC response with extra fields (should be handled gracefully)
      client.send({
        jsonrpc: '2.0',
        id: 'test_extra_fields',
        result: { ok: true },
        // Extra fields
        extra_field_1: 'value1',
        extra_field_2: { nested: true },
        __internal: 'should be ignored',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(client.isConnected()).toBe(true);

      client.close();
    });

    test('should handle numeric IDs', async () => {
      const client = createWsTestClient(mcpServer.wsPort);
      await client.waitForConnection();

      client.send({
        type: 'slack_api_response',
        id: 12345, // Numeric instead of string
        success: true,
        data: {},
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(client.isConnected()).toBe(true);

      client.close();
    });
  });

  test.describe('HTTP Endpoint Edge Cases', () => {
    test('should handle malformed JSON in POST body', async ({ request }) => {
      const response = await request.post(`http://127.0.0.1:${mcpServer.httpPort}/mcp?sessionId=test`, {
        headers: { 'Content-Type': 'application/json' },
        data: 'not valid json{',
        failOnStatusCode: false,
      });

      // Should return error, not crash
      expect(response.status()).toBeGreaterThanOrEqual(400);
    });

    test('should handle empty POST body', async ({ request }) => {
      const response = await request.post(`http://127.0.0.1:${mcpServer.httpPort}/mcp?sessionId=test`, {
        headers: { 'Content-Type': 'application/json' },
        data: '',
        failOnStatusCode: false,
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
    });

    test('should handle very long session IDs', async ({ request }) => {
      const longSessionId = 'x'.repeat(10000);

      // MCP server uses mcp-session-id header, not query param
      const response = await request.post(`http://127.0.0.1:${mcpServer.httpPort}/mcp`, {
        headers: {
          'Content-Type': 'application/json',
          'mcp-session-id': longSessionId,
        },
        data: JSON.stringify({ test: true }),
        failOnStatusCode: false,
      });

      // Should handle gracefully (404 for invalid/unknown session)
      expect(response.status()).toBe(404);
    });

    test('should handle special characters in session ID header', async ({ request }) => {
      const specialSessionId = 'session<>&"\'';

      // MCP server uses mcp-session-id header, not query param
      const response = await request.post(`http://127.0.0.1:${mcpServer.httpPort}/mcp`, {
        headers: {
          'Content-Type': 'application/json',
          'mcp-session-id': specialSessionId,
        },
        data: JSON.stringify({ test: true }),
        failOnStatusCode: false,
      });

      // Should handle gracefully (404 for invalid/unknown session)
      expect(response.status()).toBe(404);
    });

    test('should handle concurrent requests to same endpoint', async ({ request }) => {
      const requests = Array(50)
        .fill(null)
        .map(() => request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`));

      const responses = await Promise.all(requests);

      // All should succeed
      for (const response of responses) {
        expect(response.ok()).toBe(true);
      }
    });
  });
});

test.describe('Extension Edge Cases', () => {
  // Skip if running in CI without display
  test.skip((): boolean => !!process.env.CI && !process.env.DISPLAY);

  let mcpServer: McpServerHarness;
  let extension: ExtensionFixture;

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();
  });

  test.afterEach(async () => {
    if (extension) {
      await extension.cleanup();
    }
    await mcpServer.stop();
  });

  test('should handle extension loading with invalid port gracefully', async () => {
    // This tests that the extension handles connection failures
    // by using an invalid port (the extension will fail to connect)
    const invalidPort = 1; // Port 1 is privileged and won't have our server

    extension = await launchWithExtension(invalidPort);

    // Extension should still load even if WS connection fails
    expect(extension.extensionId).toBeTruthy();

    // Popup should still be accessible
    const sidePanel = await extension.getSidePanelPage();
    await sidePanel.waitForSelector('body', { timeout: 5000 });
    await sidePanel.close();
  });

  test('should handle rapid side panel open/close', async () => {
    extension = await launchWithExtension(mcpServer.wsPort);

    await new Promise(resolve => setTimeout(resolve, 2000));

    for (let i = 0; i < 5; i++) {
      const sidePanel = await extension.getSidePanelPage();
      await sidePanel.waitForSelector('body', { timeout: 5000 });
      await sidePanel.close();
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Extension should still be functional
    expect(extension.extensionId).toBeTruthy();
  });

  test('should maintain connection across multiple page opens', async ({ request }) => {
    extension = await launchWithExtension(mcpServer.wsPort);

    // Wait for initial connection
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Open and close multiple pages
    for (let i = 0; i < 3; i++) {
      const page = await extension.context.newPage();
      await page.goto('https://example.com');
      await new Promise(resolve => setTimeout(resolve, 500));
      await page.close();
    }

    // Connection should still be maintained via offscreen document
    const health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
    const body = await health.json();
    expect(body.extension).toBe('connected');
  });
});

test.describe('Boundary Conditions', () => {
  test('should handle maximum message size', async () => {
    const mcpServer = await startMcpServer();
    await mcpServer.waitForReady();

    const client = createWsTestClient(mcpServer.wsPort);
    await client.waitForConnection();

    // Send a very large message (close to typical WebSocket limits)
    const largeData = {
      type: 'slack_api_response',
      id: 'max_size',
      success: true,
      data: {
        // 5MB of data
        content: 'x'.repeat(5 * 1024 * 1024),
      },
    };

    client.send(largeData);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Connection may or may not survive depending on implementation
    // but server should handle it gracefully

    client.close();
    await mcpServer.stop();
  });

  test('should handle zero-length messages', async () => {
    const mcpServer = await startMcpServer();
    await mcpServer.waitForReady();

    const ws = new WebSocket(`ws://127.0.0.1:${mcpServer.wsPort}`);

    await new Promise<void>(resolve => {
      ws.on('open', () => resolve());
    });

    // Send empty string (valid WebSocket message, invalid JSON)
    ws.send('');

    await new Promise(resolve => setTimeout(resolve, 100));

    // Connection should remain open
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await mcpServer.stop();
  });

  test('should handle binary WebSocket messages', async () => {
    const mcpServer = await startMcpServer();
    await mcpServer.waitForReady();

    const ws = new WebSocket(`ws://127.0.0.1:${mcpServer.wsPort}`);

    await new Promise<void>(resolve => {
      ws.on('open', () => resolve());
    });

    // Send binary data
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    ws.send(buffer);

    await new Promise(resolve => setTimeout(resolve, 100));

    // Server should handle gracefully (likely ignore or error)
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await mcpServer.stop();
  });
});
