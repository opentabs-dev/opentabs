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
import { registerPinTools } from './pins.js';
import { relay } from '../../websocket-relay.js';

const registeredTools: Map<string, { handler: (...args: unknown[]) => Promise<unknown> }> = new Map();

describe('Pin Tools', () => {
  let mockServer: {
    registerTool: typeof mockRegisterTool;
  };

  beforeEach(() => {
    clearAllMocks();
    registeredTools.clear();

    mockServer = {
      registerTool: mockRegisterTool,
    };

    registerPinTools(mockServer as unknown as McpServer);
  });

  describe('slack_pin_message', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_pin_message',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should pin a message via relay', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_pin_message');
      const result = await tool?.handler({ channel: 'C123', timestamp: '1234567890.000001' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'pins.add',
          params: {
            channel: 'C123',
            timestamp: '1234567890.000001',
          },
          toolId: 'slack_pin_message',
        },
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
      });
    });

    it('should handle already_pinned error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('already_pinned'));

      const tool = registeredTools.get('slack_pin_message');
      const result = (await tool?.handler({ channel: 'C123', timestamp: '1234567890.000001' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error:');
    });

    it('should handle channel_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('channel_not_found'));

      const tool = registeredTools.get('slack_pin_message');
      const result = (await tool?.handler({ channel: 'invalid', timestamp: '1234567890.000001' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Channel not found');
    });

    it('should handle message_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('message_not_found'));

      const tool = registeredTools.get('slack_pin_message');
      const result = (await tool?.handler({ channel: 'C123', timestamp: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('message_not_found');
    });
  });

  describe('slack_unpin_message', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_unpin_message',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should unpin a message via relay', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_unpin_message');
      const result = await tool?.handler({ channel: 'C123', timestamp: '1234567890.000001' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'pins.remove',
          params: {
            channel: 'C123',
            timestamp: '1234567890.000001',
          },
          toolId: 'slack_unpin_message',
        },
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
      });
    });

    it('should handle no_pin error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('no_pin'));

      const tool = registeredTools.get('slack_unpin_message');
      const result = (await tool?.handler({ channel: 'C123', timestamp: '1234567890.000001' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle permission_denied error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('not_authorized'));

      const tool = registeredTools.get('slack_unpin_message');
      const result = (await tool?.handler({ channel: 'C123', timestamp: '1234567890.000001' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_list_pins', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_list_pins',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should list pinned items', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        items: [
          {
            type: 'message',
            created: 1234567890,
            created_by: 'U123',
            message: {
              ts: '1234567890.000001',
              text: 'Important message',
              user: 'U123',
            },
          },
          {
            type: 'file',
            created: 1234567891,
            created_by: 'U456',
            file: {
              id: 'F123',
              name: 'document.pdf',
            },
          },
        ],
      });

      const tool = registeredTools.get('slack_list_pins');
      const result = (await tool?.handler({ channel: 'C123' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'pins.list',
          params: { channel: 'C123' },
          toolId: 'slack_list_pins',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.channel).toBe('C123');
      expect(parsed.count).toBe(2);
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[0].type).toBe('message');
      expect(parsed.items[0].message.text).toBe('Important message');
      expect(parsed.items[1].type).toBe('file');
      expect(parsed.items[1].file.name).toBe('document.pdf');
    });

    it('should handle empty pins list', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ items: [] });

      const tool = registeredTools.get('slack_list_pins');
      const result = (await tool?.handler({ channel: 'C123' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(0);
      expect(parsed.items).toEqual([]);
    });

    it('should handle null items response', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ items: null });

      const tool = registeredTools.get('slack_list_pins');
      const result = (await tool?.handler({ channel: 'C123' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(0);
    });

    it('should handle missing message/file in items', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        items: [
          {
            type: 'message',
            created: 1234567890,
          },
        ],
      });

      const tool = registeredTools.get('slack_list_pins');
      const result = (await tool?.handler({ channel: 'C123' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.items[0].message).toBeUndefined();
      expect(parsed.items[0].file).toBeUndefined();
    });

    it('should handle channel_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('channel_not_found'));

      const tool = registeredTools.get('slack_list_pins');
      const result = (await tool?.handler({ channel: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Channel not found');
    });
  });
});
