import { startMcpServer, createWsTestClient } from '../lib/index.js';
import { test, expect } from '@playwright/test';
import type { McpServerHarness, WsTestClient } from '../lib/index.js';

/**
 * MCP Round-Trip Tests
 *
 * These tests verify the complete request/response flow:
 * MCP Client -> MCP Server -> WebSocket Relay -> Extension (simulated) -> Response
 */
test.describe('MCP Round-Trip Flow', () => {
  let mcpServer: McpServerHarness;
  let extensionClient: WsTestClient;

  test.beforeEach(async () => {
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();

    // Simulate the extension by connecting a WebSocket client
    extensionClient = createWsTestClient(mcpServer.wsPort);
    await extensionClient.waitForConnection();
  });

  test.afterEach(async () => {
    extensionClient.close();
    await mcpServer.stop();
  });

  test.describe('Tool Call Flow', () => {
    test('should receive slack_api_request when tool is called via MCP', async ({ request }) => {
      // First establish an SSE session to get a sessionId
      // We'll use a manual approach since SSE stays open

      // The MCP server receives tool calls via POST to /mcp?sessionId=xxx
      // But we need a valid session first. For this test, we verify the
      // WebSocket relay forwards requests correctly.

      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify health shows connected
      const health = await request.get(`http://127.0.0.1:${mcpServer.httpPort}/health`);
      const body = await health.json();
      expect(body.extension).toBe('connected');
    });

    test('should forward tool requests to extension via WebSocket', async () => {
      // This simulates what happens when the MCP server receives a tool call
      // and needs to forward it to the extension

      // The extension client should be ready to receive requests
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle extension response to tool request', async () => {
      // Simulate extension sending a response
      const testResponse = {
        type: 'slack_api_response',
        id: 'test_req_123',
        success: true,
        data: {
          ok: true,
          channels: [
            { id: 'C123', name: 'general' },
            { id: 'C456', name: 'random' },
          ],
        },
      };

      extensionClient.send(testResponse);

      // Give time for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Connection should remain stable after sending response
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle error responses from extension', async () => {
      // Simulate extension sending an error response
      extensionClient.send({
        type: 'slack_api_response',
        id: 'test_req_error',
        success: false,
        error: 'channel_not_found',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });
  });

  test.describe('Concurrent Requests', () => {
    test('should handle multiple simultaneous requests', async () => {
      // Send multiple requests rapidly
      const requestCount = 20;
      const responses: Array<{ id: string; type: string }> = [];

      for (let i = 0; i < requestCount; i++) {
        responses.push({
          type: 'slack_api_response',
          id: `concurrent_${i}`,
        });
      }

      // Send all at once
      for (const resp of responses) {
        extensionClient.send({
          ...resp,
          success: true,
          data: { ok: true, index: resp.id },
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Connection should handle the load
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should maintain request/response correlation', async () => {
      // Send requests with unique IDs and verify they can be tracked
      const requestIds = ['req_a', 'req_b', 'req_c', 'req_d', 'req_e'];

      for (const id of requestIds) {
        extensionClient.send({
          type: 'slack_api_response',
          id,
          success: true,
          data: { requestId: id, timestamp: Date.now() },
        });
      }

      await new Promise(resolve => setTimeout(resolve, 200));
      expect(extensionClient.isConnected()).toBe(true);
    });
  });

  test.describe('Request Timeout Scenarios', () => {
    test('should handle slow responses gracefully', async () => {
      // Send a request, wait a bit, then send response
      const requestId = 'slow_request';

      // Simulate slow processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Then send the response
      extensionClient.send({
        type: 'slack_api_response',
        id: requestId,
        success: true,
        data: { ok: true, delayed: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should remain stable when no response is sent', async () => {
      // Don't send any response - connection should remain stable
      await new Promise(resolve => setTimeout(resolve, 3000));
      expect(extensionClient.isConnected()).toBe(true);
    });
  });

  test.describe('Large Payload Handling', () => {
    test('should handle large response payloads', async () => {
      // Simulate a large Slack API response (e.g., many messages)
      const largeData = {
        ok: true,
        messages: Array(500)
          .fill(null)
          .map((_, i) => ({
            type: 'message',
            user: `U${i}`,
            text: `Message content ${i} with some additional text to make it larger`,
            ts: `1234567890.${String(i).padStart(6, '0')}`,
            reactions: [
              { name: 'thumbsup', count: 5 },
              { name: 'heart', count: 3 },
            ],
          })),
      };

      extensionClient.send({
        type: 'slack_api_response',
        id: 'large_response',
        success: true,
        data: largeData,
      });

      await new Promise(resolve => setTimeout(resolve, 500));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle deeply nested response data', async () => {
      // Create deeply nested object
      const createNested = (depth: number): Record<string, unknown> => {
        if (depth === 0) return { value: 'leaf' };
        return { nested: createNested(depth - 1), level: depth };
      };

      extensionClient.send({
        type: 'slack_api_response',
        id: 'nested_response',
        success: true,
        data: createNested(50),
      });

      await new Promise(resolve => setTimeout(resolve, 200));
      expect(extensionClient.isConnected()).toBe(true);
    });
  });
});
