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
import { registerStarTools } from './stars.js';
import { relay } from '../../websocket-relay.js';

const registeredTools: Map<string, { handler: (...args: unknown[]) => Promise<unknown> }> = new Map();

describe('Star Tools', () => {
  let mockServer: {
    registerTool: typeof mockRegisterTool;
  };

  beforeEach(() => {
    clearAllMocks();
    registeredTools.clear();

    mockServer = {
      registerTool: mockRegisterTool,
    };

    registerStarTools(mockServer as unknown as McpServer);
  });

  describe('slack_star_message', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_star_message',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should star a message via relay', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_star_message');
      const result = await tool?.handler({ channel: 'C123', timestamp: '1234567890.000001' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'stars.add',
          params: {
            channel: 'C123',
            timestamp: '1234567890.000001',
          },
          toolId: 'slack_star_message',
        },
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
      });
    });

    it('should handle already_starred error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('already_starred'));

      const tool = registeredTools.get('slack_star_message');
      const result = (await tool?.handler({ channel: 'C123', timestamp: '1234567890.000001' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle channel_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('channel_not_found'));

      const tool = registeredTools.get('slack_star_message');
      const result = (await tool?.handler({ channel: 'invalid', timestamp: '1234567890.000001' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Channel not found');
    });
  });

  describe('slack_star_file', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_star_file',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should star a file via relay', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_star_file');
      const result = await tool?.handler({ file: 'F123456789' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'stars.add',
          params: {
            file: 'F123456789',
          },
          toolId: 'slack_star_file',
        },
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
      });
    });

    it('should handle file_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('file_not_found'));

      const tool = registeredTools.get('slack_star_file');
      const result = (await tool?.handler({ file: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_unstar_message', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_unstar_message',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should unstar a message via relay', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_unstar_message');
      const result = await tool?.handler({ channel: 'C123', timestamp: '1234567890.000001' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'stars.remove',
          params: {
            channel: 'C123',
            timestamp: '1234567890.000001',
          },
          toolId: 'slack_unstar_message',
        },
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
      });
    });

    it('should handle not_starred error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('not_starred'));

      const tool = registeredTools.get('slack_unstar_message');
      const result = (await tool?.handler({ channel: 'C123', timestamp: '1234567890.000001' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_unstar_file', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_unstar_file',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should unstar a file via relay', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_unstar_file');
      const result = await tool?.handler({ file: 'F123456789' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'stars.remove',
          params: {
            file: 'F123456789',
          },
          toolId: 'slack_unstar_file',
        },
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
      });
    });

    it('should handle file_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('file_not_found'));

      const tool = registeredTools.get('slack_unstar_file');
      const result = (await tool?.handler({ file: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_list_stars', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_list_stars',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should list starred items', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
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
              name: 'document.pdf',
              permalink: 'https://slack.com/files/T123/F123/document.pdf',
            },
          },
        ],
        response_metadata: {
          next_cursor: 'cursor123',
        },
      });

      const tool = registeredTools.get('slack_list_stars');
      const result = (await tool?.handler({ count: 100 })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'stars.list',
          params: {
            count: 100,
            cursor: undefined,
          },
          toolId: 'slack_list_stars',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(2);
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[0].type).toBe('message');
      expect(parsed.items[0].message.text).toBe('Starred message');
      expect(parsed.items[0].message.permalink).toBe('https://slack.com/archives/C123/p1234567890000001');
      expect(parsed.items[1].type).toBe('file');
      expect(parsed.items[1].file.name).toBe('document.pdf');
      expect(parsed.next_cursor).toBe('cursor123');
    });

    it('should handle empty stars list', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ items: [] });

      const tool = registeredTools.get('slack_list_stars');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(0);
      expect(parsed.items).toEqual([]);
      expect(parsed.next_cursor).toBeNull();
    });

    it('should cap count at 1000', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ items: [] });

      const tool = registeredTools.get('slack_list_stars');
      await tool?.handler({ count: 5000 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'stars.list',
          params: expect.objectContaining({ count: 1000 }),
          toolId: 'slack_list_stars',
        },
        undefined,
      );
    });

    it('should pass pagination cursor', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ items: [] });

      const tool = registeredTools.get('slack_list_stars');
      await tool?.handler({ cursor: 'cursor123' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'stars.list',
          params: expect.objectContaining({ cursor: 'cursor123' }),
          toolId: 'slack_list_stars',
        },
        undefined,
      );
    });

    it('should handle missing message/file in items', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        items: [
          {
            type: 'channel',
            date_create: 1234567890,
          },
        ],
      });

      const tool = registeredTools.get('slack_list_stars');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.items[0].message).toBeUndefined();
      expect(parsed.items[0].file).toBeUndefined();
    });

    it('should handle API errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('invalid_auth'));

      const tool = registeredTools.get('slack_list_stars');
      const result = (await tool?.handler({})) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });
});
