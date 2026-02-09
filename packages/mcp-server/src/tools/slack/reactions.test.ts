import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { mocked, clearAllMocks, trackMock } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Create mock functions before module mock
const mockSendServiceRequest = trackMock(mock(() => {}));
const mockRegisterTool = trackMock(
  mock((name: string, _config: { description?: string; inputSchema?: unknown }, handler: () => Promise<unknown>) => {
    registeredTools.set(name, { handler });
  }),
);

// Mock the websocket relay - must be before importing the module that uses it
mock.module('../../websocket-relay', () => ({
  relay: {
    sendServiceRequest: mockSendServiceRequest,
  },
}));

// Import after mock.module
import { registerReactionTools } from './reactions.js';
import { relay } from '../../websocket-relay.js';

const registeredTools: Map<string, { handler: (...args: unknown[]) => Promise<unknown> }> = new Map();

describe('Reaction Tools', () => {
  let mockServer: {
    registerTool: typeof mockRegisterTool;
  };

  beforeEach(() => {
    clearAllMocks();
    registeredTools.clear();

    mockServer = {
      registerTool: mockRegisterTool,
    };

    registerReactionTools(mockServer as unknown as McpServer);
  });

  describe('slack_remove_reaction', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_remove_reaction',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should remove reaction via relay', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_remove_reaction');
      const result = await tool?.handler({ channel: 'C123', timestamp: '1234567890.000001', emoji: 'thumbsup' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'reactions.remove',
          params: {
            channel: 'C123',
            timestamp: '1234567890.000001',
            name: 'thumbsup',
          },
          toolId: 'slack_remove_reaction',
        },
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
      });
    });

    it('should handle no_reaction error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('no_reaction'));

      const tool = registeredTools.get('slack_remove_reaction');
      const result = (await tool?.handler({ channel: 'C123', timestamp: '1234567890.000001', emoji: 'thumbsup' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle channel_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('channel_not_found'));

      const tool = registeredTools.get('slack_remove_reaction');
      const result = (await tool?.handler({
        channel: 'invalid',
        timestamp: '1234567890.000001',
        emoji: 'thumbsup',
      })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Channel not found');
    });

    it('should handle message_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('message_not_found'));

      const tool = registeredTools.get('slack_remove_reaction');
      const result = (await tool?.handler({ channel: 'C123', timestamp: 'invalid', emoji: 'thumbsup' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('message_not_found');
    });

    it('should handle invalid_name error for bad emoji', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('invalid_name'));

      const tool = registeredTools.get('slack_remove_reaction');
      const result = (await tool?.handler({
        channel: 'C123',
        timestamp: '1234567890.000001',
        emoji: 'not_an_emoji',
      })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_get_reactions', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_get_reactions',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get reactions for a message', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
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

      const tool = registeredTools.get('slack_get_reactions');
      const result = (await tool?.handler({
        channel: 'C123',
        timestamp: '1234567890.000001',
        full: true,
      })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'reactions.get',
          params: {
            channel: 'C123',
            timestamp: '1234567890.000001',
            full: true,
          },
          toolId: 'slack_get_reactions',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.channel).toBe('C123');
      expect(parsed.timestamp).toBe('1234567890.000001');
      expect(parsed.reactions).toHaveLength(2);
      expect(parsed.reactions[0].emoji).toBe('thumbsup');
      expect(parsed.reactions[0].count).toBe(3);
      expect(parsed.reactions[0].users).toEqual(['U123', 'U456', 'U789']);
      expect(parsed.total_reactions).toBe(5);
    });

    it('should handle message with no reactions', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        message: {
          ts: '1234567890.000001',
          text: 'Hello world',
          user: 'U123',
          reactions: [],
        },
      });

      const tool = registeredTools.get('slack_get_reactions');
      const result = (await tool?.handler({
        channel: 'C123',
        timestamp: '1234567890.000001',
      })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.reactions).toEqual([]);
      expect(parsed.total_reactions).toBe(0);
    });

    it('should handle null reactions', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        message: {
          ts: '1234567890.000001',
          text: 'Hello world',
          user: 'U123',
        },
      });

      const tool = registeredTools.get('slack_get_reactions');
      const result = (await tool?.handler({
        channel: 'C123',
        timestamp: '1234567890.000001',
      })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.reactions).toEqual([]);
      expect(parsed.total_reactions).toBe(0);
    });

    it('should pass full parameter when provided', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        message: { reactions: [] },
      });

      const tool = registeredTools.get('slack_get_reactions');
      await tool?.handler({
        channel: 'C123',
        timestamp: '1234567890.000001',
        full: true,
      });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'reactions.get',
          params: {
            channel: 'C123',
            timestamp: '1234567890.000001',
            full: true,
          },
          toolId: 'slack_get_reactions',
        },
        undefined,
      );
    });

    it('should handle channel_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('channel_not_found'));

      const tool = registeredTools.get('slack_get_reactions');
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

    it('should handle message_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('message_not_found'));

      const tool = registeredTools.get('slack_get_reactions');
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
  });
});
