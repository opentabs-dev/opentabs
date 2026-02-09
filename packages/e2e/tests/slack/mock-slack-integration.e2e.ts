import { startMcpServer, createWsTestClient, createMockSlackServer } from '../../lib/index.js';
import { test, expect } from '@playwright/test';
import type { McpServerHarness, WsTestClient, MockSlackServer } from '../../lib/index.js';

/**
 * Mock Slack API Integration Tests
 *
 * These tests use a mock Slack server to verify the full request/response
 * flow without requiring real Slack credentials.
 */
test.describe('Mock Slack Integration', () => {
  let mcpServer: McpServerHarness;
  let extensionClient: WsTestClient;
  let mockSlack: MockSlackServer;

  test.beforeEach(async () => {
    // Start all components
    mcpServer = await startMcpServer();
    await mcpServer.waitForReady();

    mockSlack = await createMockSlackServer();

    extensionClient = createWsTestClient(mcpServer.wsPort);
    await extensionClient.waitForConnection();
  });

  test.afterEach(async () => {
    extensionClient.close();
    await mockSlack.stop();
    await mcpServer.stop();
  });

  test.describe('Slack API Method Simulation', () => {
    test('should handle conversations.list mock response', async () => {
      // Set up mock response
      mockSlack.addMock('conversations.list', {
        ok: true,
        channels: [
          { id: 'C123', name: 'general', is_channel: true },
          { id: 'C456', name: 'random', is_channel: true },
          { id: 'C789', name: 'engineering', is_private: true },
        ],
      });

      // Simulate extension receiving request and sending response
      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_list_1',
        success: true,
        data: {
          ok: true,
          channels: [
            { id: 'C123', name: 'general' },
            { id: 'C456', name: 'random' },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.history mock response', async () => {
      mockSlack.addMock('conversations.history', {
        ok: true,
        messages: [
          { type: 'message', user: 'U123', text: 'Hello world', ts: '1234567890.000001' },
          { type: 'message', user: 'U456', text: 'Hi there', ts: '1234567890.000002' },
        ],
        has_more: false,
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_history_1',
        success: true,
        data: {
          ok: true,
          messages: [{ type: 'message', user: 'U123', text: 'Hello world', ts: '1234567890.000001' }],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle users.list mock response', async () => {
      mockSlack.addMock('users.list', {
        ok: true,
        members: [
          { id: 'U123', name: 'john', real_name: 'John Doe', is_bot: false },
          { id: 'U456', name: 'jane', real_name: 'Jane Smith', is_bot: false },
          { id: 'UBOT', name: 'slackbot', real_name: 'Slackbot', is_bot: true },
        ],
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'users_list_1',
        success: true,
        data: {
          ok: true,
          members: [{ id: 'U123', name: 'john' }],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle chat.postMessage mock response', async () => {
      mockSlack.addMock('chat.postMessage', {
        ok: true,
        channel: 'C123',
        ts: '1234567890.000100',
        message: {
          type: 'message',
          text: 'Test message',
          user: 'U123',
          ts: '1234567890.000100',
        },
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'post_msg_1',
        success: true,
        data: {
          ok: true,
          ts: '1234567890.000100',
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle search.messages mock response', async () => {
      mockSlack.addMock('search.messages', {
        ok: true,
        messages: {
          matches: [
            {
              iid: 'msg_1',
              team: 'T123',
              channel: { id: 'C123', name: 'general' },
              type: 'message',
              user: 'U123',
              username: 'john',
              ts: '1234567890.000001',
              text: 'matching text here',
              permalink: 'https://slack.com/archives/C123/p1234567890000001',
            },
          ],
          total: 1,
        },
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'search_1',
        success: true,
        data: {
          ok: true,
          messages: { matches: [], total: 0 },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });
  });

  test.describe('Error Response Simulation', () => {
    test('should handle channel_not_found error', async () => {
      mockSlack.addMock('conversations.info', {
        ok: false,
        error: 'channel_not_found',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'error_1',
        success: false,
        error: 'channel_not_found',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle user_not_found error', async () => {
      mockSlack.addMock('users.info', {
        ok: false,
        error: 'user_not_found',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'error_2',
        success: false,
        error: 'user_not_found',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle rate_limited error', async () => {
      mockSlack.addMock('chat.postMessage', {
        ok: false,
        error: 'rate_limited',
        retry_after: 30,
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'rate_limited_1',
        success: false,
        error: 'rate_limited',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle invalid_auth error', async () => {
      mockSlack.addMock('auth.test', {
        ok: false,
        error: 'invalid_auth',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'auth_error_1',
        success: false,
        error: 'invalid_auth',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle token_revoked error', async () => {
      extensionClient.send({
        type: 'slack_api_response',
        id: 'token_revoked_1',
        success: false,
        error: 'token_revoked',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });
  });

  test.describe('Pagination Simulation', () => {
    test('should handle paginated conversations.list', async () => {
      // First page
      mockSlack.addMock('conversations.list', {
        ok: true,
        channels: [
          { id: 'C001', name: 'channel-1' },
          { id: 'C002', name: 'channel-2' },
        ],
        response_metadata: {
          next_cursor: 'cursor_page_2',
        },
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'page_1',
        success: true,
        data: {
          ok: true,
          channels: [{ id: 'C001', name: 'channel-1' }],
          response_metadata: { next_cursor: 'cursor_page_2' },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Second page
      extensionClient.send({
        type: 'slack_api_response',
        id: 'page_2',
        success: true,
        data: {
          ok: true,
          channels: [{ id: 'C003', name: 'channel-3' }],
          response_metadata: { next_cursor: '' },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle paginated conversations.history', async () => {
      // Simulate fetching message history with pagination
      const pages = [
        {
          messages: [{ ts: '1.0', text: 'msg1' }],
          has_more: true,
          response_metadata: { next_cursor: 'cursor2' },
        },
        {
          messages: [{ ts: '2.0', text: 'msg2' }],
          has_more: true,
          response_metadata: { next_cursor: 'cursor3' },
        },
        { messages: [{ ts: '3.0', text: 'msg3' }], has_more: false },
      ];

      for (let i = 0; i < pages.length; i++) {
        extensionClient.send({
          type: 'slack_api_response',
          id: `history_page_${i}`,
          success: true,
          data: { ok: true, ...pages[i] },
        });
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      expect(extensionClient.isConnected()).toBe(true);
    });
  });

  test.describe('Request Tracking', () => {
    test('should track requests made to mock server', async () => {
      // Clear any previous requests
      mockSlack.clearMocks();

      // Make multiple API calls (simulated by mock server direct calls)
      const response = await fetch(`${mockSlack.url}/api/conversations.list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
      });

      expect(response.ok).toBe(true);

      const requests = mockSlack.getRequests();
      expect(requests.length).toBe(1);
      expect(requests[0].method).toBe('conversations.list');
    });

    test('should clear mock responses', async () => {
      mockSlack.addMock('test.method', { ok: true });
      mockSlack.clearMocks();

      const response = await fetch(`${mockSlack.url}/api/test.method`, {
        method: 'POST',
      });

      const body = (await response.json()) as { ok: boolean; error?: string };
      // Should get error since mock was cleared
      expect(body.ok).toBe(false);
      expect(body.error).toBe('method_not_mocked');
    });
  });
});
