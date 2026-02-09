import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { mocked, clearAllMocks, trackMock } from '../../test-utils.js';

// Create mock function before module mock
const mockSendServiceRequest = trackMock(mock(() => {}));

// Mock the websocket relay - must be before importing the module that uses it
mock.module('../../websocket-relay', () => ({
  relay: {
    sendServiceRequest: mockSendServiceRequest,
  },
}));

// Import after mock.module
import { registerMessageTools } from './messages.js';
import { relay } from '../../websocket-relay.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('Message Tools', () => {
  let mockServer: {
    registerTool: ReturnType<typeof mock>;
  };
  const registeredTools: Map<string, { handler: (...args: unknown[]) => Promise<unknown> }> = new Map();

  beforeEach(() => {
    clearAllMocks();

    mockServer = {
      registerTool: mock(
        (name: string, _config: { description?: string; inputSchema?: unknown }, handler: () => Promise<unknown>) => {
          registeredTools.set(name, { handler });
        },
      ),
    };

    registerMessageTools(mockServer as unknown as McpServer);
  });

  describe('slack_send_message', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_send_message',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should send message via relay', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true, ts: '123.456' });

      const tool = registeredTools.get('slack_send_message');
      const result = await tool?.handler({ channel: '#general', text: 'Hello' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'chat.postMessage',
          params: {
            channel: '#general',
            text: 'Hello',
          },
          toolId: 'slack_send_message',
        },
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ ok: true, ts: '123.456' }, null, 2) }],
      });
    });

    it('should auto-open DM when channel is a user ID', async () => {
      mocked(relay.sendServiceRequest)
        // First call: conversations.open to get DM channel
        .mockResolvedValueOnce({ channel: { id: 'D999' } })
        // Second call: chat.postMessage with resolved DM channel
        .mockResolvedValueOnce({ ok: true, ts: '123.456' });

      const tool = registeredTools.get('slack_send_message');
      await tool?.handler({ channel: 'U123ABC', text: 'Hello' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.open',
          params: { users: 'U123ABC' },
          toolId: 'slack_send_message',
        },
        undefined,
      );
      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'chat.postMessage',
          params: { channel: 'D999', text: 'Hello' },
          toolId: 'slack_send_message',
        },
        undefined,
      );
    });

    it('should handle errors gracefully', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('channel_not_found'));

      const tool = registeredTools.get('slack_send_message');
      const result = (await tool?.handler({ channel: '#invalid', text: 'Hello' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error:');
    });
  });

  describe('slack_read_messages', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_read_messages',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should read messages and format response', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        messages: [
          { user: 'U123', text: 'Hello', ts: '123.456', thread_ts: null, reactions: [] },
          { user: 'U456', text: 'World', ts: '123.457', thread_ts: '123.456', reactions: [{ name: 'thumbsup' }] },
        ],
      });

      const tool = registeredTools.get('slack_read_messages');
      const result = (await tool?.handler({ channel: '#general', limit: 10 })) as {
        content: Array<{ text: string }>;
      };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.history',
          params: {
            channel: '#general',
            limit: 10,
            oldest: undefined,
            latest: undefined,
          },
          toolId: 'slack_read_messages',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toHaveProperty('user', 'U123');
      expect(parsed[0]).toHaveProperty('text', 'Hello');
    });

    it('should cap limit at 100', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ messages: [] });

      const tool = registeredTools.get('slack_read_messages');
      await tool?.handler({ channel: '#general', limit: 500 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.history',
          params: expect.objectContaining({ limit: 100 }),
          toolId: 'slack_read_messages',
        },
        undefined,
      );
    });

    it('should handle empty messages array', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ messages: null });

      const tool = registeredTools.get('slack_read_messages');
      const result = (await tool?.handler({ channel: '#general' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual([]);
    });
  });

  describe('slack_read_thread', () => {
    it('should read thread replies', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        messages: [
          { user: 'U123', text: 'Parent', ts: '123.456' },
          { user: 'U456', text: 'Reply', ts: '123.457' },
        ],
      });

      const tool = registeredTools.get('slack_read_thread');
      const result = (await tool?.handler({ channel: 'C123', thread_ts: '123.456', limit: 50 })) as {
        content: Array<{ text: string }>;
      };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.replies',
          params: {
            channel: 'C123',
            ts: '123.456',
            limit: 50,
          },
          toolId: 'slack_read_thread',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
    });

    it('should cap limit at 200', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ messages: [] });

      const tool = registeredTools.get('slack_read_thread');
      await tool?.handler({ channel: 'C123', thread_ts: '123.456', limit: 500 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.replies',
          params: expect.objectContaining({ limit: 200 }),
          toolId: 'slack_read_thread',
        },
        undefined,
      );
    });
  });

  describe('slack_reply_to_thread', () => {
    it('should send reply with thread_ts', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_reply_to_thread');
      await tool?.handler({ channel: 'C123', thread_ts: '123.456', text: 'Reply text' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'chat.postMessage',
          params: {
            channel: 'C123',
            text: 'Reply text',
            thread_ts: '123.456',
          },
          toolId: 'slack_reply_to_thread',
        },
        undefined,
      );
    });
  });

  describe('slack_react_to_message', () => {
    it('should add reaction to message', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_react_to_message');
      await tool?.handler({ channel: 'C123', timestamp: '123.456', emoji: 'thumbsup' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'reactions.add',
          params: {
            channel: 'C123',
            timestamp: '123.456',
            name: 'thumbsup',
          },
          toolId: 'slack_react_to_message',
        },
        undefined,
      );
    });
  });

  describe('slack_update_message', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_update_message',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should update message via relay', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        ok: true,
        ts: '1234567890.000001',
        text: 'Updated message',
        channel: 'C123',
      });

      const tool = registeredTools.get('slack_update_message');
      const result = (await tool?.handler({
        channel: 'C123',
        timestamp: '1234567890.000001',
        text: 'Updated message',
      })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'chat.update',
          params: {
            channel: 'C123',
            ts: '1234567890.000001',
            text: 'Updated message',
          },
          toolId: 'slack_update_message',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
      expect(parsed.text).toBe('Updated message');
      expect(parsed.channel).toBe('C123');
    });

    it('should handle message_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('message_not_found'));

      const tool = registeredTools.get('slack_update_message');
      const result = (await tool?.handler({
        channel: 'C123',
        timestamp: 'invalid',
        text: 'Updated',
      })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('message_not_found');
    });

    it('should handle cant_update_message error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('cant_update_message'));

      const tool = registeredTools.get('slack_update_message');
      const result = (await tool?.handler({
        channel: 'C123',
        timestamp: '1234567890.000001',
        text: 'Updated',
      })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle edit_window_closed error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('edit_window_closed'));

      const tool = registeredTools.get('slack_update_message');
      const result = (await tool?.handler({
        channel: 'C123',
        timestamp: '1234567890.000001',
        text: 'Updated',
      })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle channel_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('channel_not_found'));

      const tool = registeredTools.get('slack_update_message');
      const result = (await tool?.handler({
        channel: 'invalid',
        timestamp: '1234567890.000001',
        text: 'Updated',
      })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Channel not found');
    });
  });

  describe('slack_delete_message', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_delete_message',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should delete message via relay', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        ok: true,
        ts: '1234567890.000001',
        channel: 'C123',
      });

      const tool = registeredTools.get('slack_delete_message');
      const result = (await tool?.handler({
        channel: 'C123',
        timestamp: '1234567890.000001',
      })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'chat.delete',
          params: {
            channel: 'C123',
            ts: '1234567890.000001',
          },
          toolId: 'slack_delete_message',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
      expect(parsed.channel).toBe('C123');
    });

    it('should handle message_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('message_not_found'));

      const tool = registeredTools.get('slack_delete_message');
      const result = (await tool?.handler({
        channel: 'C123',
        timestamp: 'invalid',
      })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('message_not_found');
    });

    it('should handle cant_delete_message error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('cant_delete_message'));

      const tool = registeredTools.get('slack_delete_message');
      const result = (await tool?.handler({
        channel: 'C123',
        timestamp: '1234567890.000001',
      })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle compliance_exports_prevent_deletion error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('compliance_exports_prevent_deletion'));

      const tool = registeredTools.get('slack_delete_message');
      const result = (await tool?.handler({
        channel: 'C123',
        timestamp: '1234567890.000001',
      })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle channel_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('channel_not_found'));

      const tool = registeredTools.get('slack_delete_message');
      const result = (await tool?.handler({
        channel: 'invalid',
        timestamp: '1234567890.000001',
      })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Channel not found');
    });
  });
});
