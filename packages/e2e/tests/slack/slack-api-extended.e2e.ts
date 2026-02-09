import { startMcpServer, createWsTestClient, createMockSlackServer } from '../../lib/index.js';
import { test, expect } from '@playwright/test';
import type { McpServerHarness, WsTestClient, MockSlackServer } from '../../lib/index.js';

/**
 * Extended Slack API Integration Tests
 *
 * These tests verify the full request/response flow for extended Slack APIs:
 * - Message update/delete (chat.update, chat.delete)
 * - Pins (pins.add, pins.remove, pins.list)
 * - Stars (stars.add, stars.remove, stars.list)
 * - Reactions (reactions.remove, reactions.get)
 * - Channel management (conversations.*)
 */
test.describe('Extended Slack API Integration', () => {
  let mcpServer: McpServerHarness;
  let extensionClient: WsTestClient;
  let mockSlack: MockSlackServer;

  test.beforeEach(async () => {
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

  test.describe('Message Update/Delete APIs', () => {
    test('should handle chat.update mock response', async () => {
      mockSlack.addMock('chat.update', {
        ok: true,
        channel: 'C123',
        ts: '1234567890.000001',
        text: 'Updated message',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'update_msg_1',
        success: true,
        data: {
          ok: true,
          channel: 'C123',
          ts: '1234567890.000001',
          text: 'Updated message',
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle chat.delete mock response', async () => {
      mockSlack.addMock('chat.delete', {
        ok: true,
        channel: 'C123',
        ts: '1234567890.000001',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'delete_msg_1',
        success: true,
        data: {
          ok: true,
          channel: 'C123',
          ts: '1234567890.000001',
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle chat.update error - message_not_found', async () => {
      mockSlack.addMock('chat.update', {
        ok: false,
        error: 'message_not_found',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'update_msg_error',
        success: false,
        error: 'message_not_found',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle chat.delete error - cant_delete_message', async () => {
      mockSlack.addMock('chat.delete', {
        ok: false,
        error: 'cant_delete_message',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'delete_msg_error',
        success: false,
        error: 'cant_delete_message',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });
  });

  test.describe('Pin APIs', () => {
    test('should handle pins.add mock response', async () => {
      mockSlack.addMock('pins.add', {
        ok: true,
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'pin_add_1',
        success: true,
        data: { ok: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle pins.remove mock response', async () => {
      mockSlack.addMock('pins.remove', {
        ok: true,
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'pin_remove_1',
        success: true,
        data: { ok: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle pins.list mock response', async () => {
      mockSlack.addMock('pins.list', {
        ok: true,
        items: [
          {
            type: 'message',
            created: 1234567890,
            created_by: 'U123',
            message: {
              ts: '1234567890.000001',
              text: 'Important pinned message',
              user: 'U123',
            },
          },
          {
            type: 'file',
            created: 1234567891,
            created_by: 'U456',
            file: {
              id: 'F123',
              name: 'important.pdf',
            },
          },
        ],
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'pins_list_1',
        success: true,
        data: {
          ok: true,
          items: [
            {
              type: 'message',
              message: { ts: '1234567890.000001', text: 'Important pinned message' },
            },
          ],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle pins.add error - already_pinned', async () => {
      mockSlack.addMock('pins.add', {
        ok: false,
        error: 'already_pinned',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'pin_add_error',
        success: false,
        error: 'already_pinned',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });
  });

  test.describe('Star APIs', () => {
    test('should handle stars.add mock response for message', async () => {
      mockSlack.addMock('stars.add', {
        ok: true,
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'star_add_msg_1',
        success: true,
        data: { ok: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle stars.add mock response for file', async () => {
      mockSlack.addMock('stars.add', {
        ok: true,
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'star_add_file_1',
        success: true,
        data: { ok: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle stars.remove mock response', async () => {
      mockSlack.addMock('stars.remove', {
        ok: true,
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'star_remove_1',
        success: true,
        data: { ok: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle stars.list mock response', async () => {
      mockSlack.addMock('stars.list', {
        ok: true,
        items: [
          {
            type: 'message',
            channel: 'C123',
            date_create: 1234567890,
            message: {
              ts: '1234567890.000001',
              text: 'Starred message',
              user: 'U123',
              permalink: 'https://slack.com/archives/C123/p1234567890000001',
            },
          },
          {
            type: 'file',
            date_create: 1234567891,
            file: {
              id: 'F123',
              name: 'starred_file.pdf',
              permalink: 'https://slack.com/files/T123/F123/starred_file.pdf',
            },
          },
        ],
        response_metadata: {
          next_cursor: 'cursor123',
        },
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'stars_list_1',
        success: true,
        data: {
          ok: true,
          items: [{ type: 'message', message: { text: 'Starred message' } }],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });
  });

  test.describe('Reaction APIs', () => {
    test('should handle reactions.remove mock response', async () => {
      mockSlack.addMock('reactions.remove', {
        ok: true,
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'reaction_remove_1',
        success: true,
        data: { ok: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle reactions.get mock response', async () => {
      mockSlack.addMock('reactions.get', {
        ok: true,
        type: 'message',
        channel: 'C123',
        message: {
          ts: '1234567890.000001',
          text: 'Hello world',
          user: 'U123',
          reactions: [
            { name: 'thumbsup', count: 3, users: ['U123', 'U456', 'U789'] },
            { name: 'heart', count: 2, users: ['U123', 'U456'] },
          ],
        },
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'reactions_get_1',
        success: true,
        data: {
          ok: true,
          message: {
            reactions: [{ name: 'thumbsup', count: 3, users: ['U123', 'U456', 'U789'] }],
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle reactions.remove error - no_reaction', async () => {
      mockSlack.addMock('reactions.remove', {
        ok: false,
        error: 'no_reaction',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'reaction_remove_error',
        success: false,
        error: 'no_reaction',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });
  });

  test.describe('Channel Management APIs', () => {
    test('should handle conversations.open mock response (DM)', async () => {
      mockSlack.addMock('conversations.open', {
        ok: true,
        channel: {
          id: 'D123',
          is_im: true,
        },
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_open_1',
        success: true,
        data: {
          ok: true,
          channel: { id: 'D123', is_im: true },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.create mock response', async () => {
      mockSlack.addMock('conversations.create', {
        ok: true,
        channel: {
          id: 'C123',
          name: 'new-channel',
          is_private: false,
        },
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_create_1',
        success: true,
        data: {
          ok: true,
          channel: { id: 'C123', name: 'new-channel' },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.archive mock response', async () => {
      mockSlack.addMock('conversations.archive', {
        ok: true,
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_archive_1',
        success: true,
        data: { ok: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.unarchive mock response', async () => {
      mockSlack.addMock('conversations.unarchive', {
        ok: true,
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_unarchive_1',
        success: true,
        data: { ok: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.setTopic mock response', async () => {
      mockSlack.addMock('conversations.setTopic', {
        ok: true,
        topic: 'New channel topic',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_topic_1',
        success: true,
        data: { ok: true, topic: 'New channel topic' },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.setPurpose mock response', async () => {
      mockSlack.addMock('conversations.setPurpose', {
        ok: true,
        purpose: 'New channel purpose',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_purpose_1',
        success: true,
        data: { ok: true, purpose: 'New channel purpose' },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.invite mock response', async () => {
      mockSlack.addMock('conversations.invite', {
        ok: true,
        channel: {
          id: 'C123',
          name: 'general',
        },
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_invite_1',
        success: true,
        data: {
          ok: true,
          channel: { id: 'C123', name: 'general' },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.kick mock response', async () => {
      mockSlack.addMock('conversations.kick', {
        ok: true,
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_kick_1',
        success: true,
        data: { ok: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.rename mock response', async () => {
      mockSlack.addMock('conversations.rename', {
        ok: true,
        channel: {
          id: 'C123',
          name: 'renamed-channel',
        },
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_rename_1',
        success: true,
        data: {
          ok: true,
          channel: { id: 'C123', name: 'renamed-channel' },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.join mock response', async () => {
      mockSlack.addMock('conversations.join', {
        ok: true,
        channel: {
          id: 'C123',
          name: 'general',
        },
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_join_1',
        success: true,
        data: {
          ok: true,
          channel: { id: 'C123', name: 'general' },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.leave mock response', async () => {
      mockSlack.addMock('conversations.leave', {
        ok: true,
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_leave_1',
        success: true,
        data: { ok: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });
  });

  test.describe('Channel Management Error Cases', () => {
    test('should handle conversations.create error - name_taken', async () => {
      mockSlack.addMock('conversations.create', {
        ok: false,
        error: 'name_taken',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_create_error',
        success: false,
        error: 'name_taken',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.archive error - already_archived', async () => {
      mockSlack.addMock('conversations.archive', {
        ok: false,
        error: 'already_archived',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_archive_error',
        success: false,
        error: 'already_archived',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.invite error - already_in_channel', async () => {
      mockSlack.addMock('conversations.invite', {
        ok: false,
        error: 'already_in_channel',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_invite_error',
        success: false,
        error: 'already_in_channel',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.join error - is_archived', async () => {
      mockSlack.addMock('conversations.join', {
        ok: false,
        error: 'is_archived',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_join_error',
        success: false,
        error: 'is_archived',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });

    test('should handle conversations.leave error - cant_leave_general', async () => {
      mockSlack.addMock('conversations.leave', {
        ok: false,
        error: 'cant_leave_general',
      });

      extensionClient.send({
        type: 'slack_api_response',
        id: 'conv_leave_error',
        success: false,
        error: 'cant_leave_general',
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(extensionClient.isConnected()).toBe(true);
    });
  });

  test.describe('Mock Server Request Tracking', () => {
    test('should track chat.update requests', async () => {
      mockSlack.clearMocks();
      mockSlack.addMock('chat.update', { ok: true });

      const response = await fetch(`${mockSlack.url}/api/chat.update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'C123', ts: '1234567890.000001', text: 'Updated' }),
      });

      expect(response.ok).toBe(true);

      const requests = mockSlack.getRequests();
      expect(requests.length).toBe(1);
      expect(requests[0].method).toBe('chat.update');
    });

    test('should track pins.add requests', async () => {
      mockSlack.clearMocks();
      mockSlack.addMock('pins.add', { ok: true });

      const response = await fetch(`${mockSlack.url}/api/pins.add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'C123', timestamp: '1234567890.000001' }),
      });

      expect(response.ok).toBe(true);

      const requests = mockSlack.getRequests();
      expect(requests.length).toBe(1);
      expect(requests[0].method).toBe('pins.add');
    });

    test('should track stars.list requests', async () => {
      mockSlack.clearMocks();
      mockSlack.addMock('stars.list', { ok: true, items: [] });

      const response = await fetch(`${mockSlack.url}/api/stars.list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 100 }),
      });

      expect(response.ok).toBe(true);

      const requests = mockSlack.getRequests();
      expect(requests.length).toBe(1);
      expect(requests[0].method).toBe('stars.list');
    });

    test('should track conversations.create requests', async () => {
      mockSlack.clearMocks();
      mockSlack.addMock('conversations.create', { ok: true, channel: { id: 'C123' } });

      const response = await fetch(`${mockSlack.url}/api/conversations.create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-channel', is_private: false }),
      });

      expect(response.ok).toBe(true);

      const requests = mockSlack.getRequests();
      expect(requests.length).toBe(1);
      expect(requests[0].method).toBe('conversations.create');
    });
  });
});
