import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { mocked, clearAllMocks, trackMock } from '../../test-utils.js';

// Create mock functions before module mock
const mockSendServiceRequest = trackMock(mock(() => {}));
const mockSendSlackEdgeRequest = trackMock(mock(() => {}));
// Mock the websocket relay - must be before importing the module that uses it
mock.module('../../websocket-relay', () => ({
  relay: {
    sendServiceRequest: mockSendServiceRequest,
    sendSlackEdgeRequest: mockSendSlackEdgeRequest,
  },
}));

// Import after mock.module
import { registerChannelTools } from './channels.js';
import { relay } from '../../websocket-relay.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('Channel Tools', () => {
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

    registerChannelTools(mockServer as unknown as McpServer);
  });

  describe('slack_get_channel_info', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_get_channel_info',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get channel info and format response', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        channel: {
          id: 'C123',
          name: 'general',
          is_channel: true,
          is_group: false,
          is_private: false,
          is_archived: false,
          is_member: true,
          num_members: 50,
          topic: { value: 'General discussion' },
          purpose: { value: 'Team communication' },
        },
      });

      const tool = registeredTools.get('slack_get_channel_info');
      const result = (await tool?.handler({ channel: 'C123' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.info',
          params: { channel: 'C123' },
          toolId: 'slack_get_channel_info',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({
        id: 'C123',
        name: 'general',
        is_channel: true,
        is_group: false,
        is_private: false,
        is_archived: false,
        is_member: true,
        num_members: 50,
        topic: 'General discussion',
        purpose: 'Team communication',
      });
    });

    it('should handle missing topic and purpose', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        channel: {
          id: 'C123',
          name: 'general',
          is_channel: true,
        },
      });

      const tool = registeredTools.get('slack_get_channel_info');
      const result = (await tool?.handler({ channel: 'C123' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.topic).toBeUndefined();
      expect(parsed.purpose).toBeUndefined();
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('channel_not_found'));

      const tool = registeredTools.get('slack_get_channel_info');
      const result = (await tool?.handler({ channel: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Channel not found');
    });
  });

  describe('slack_list_channel_members', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_list_channel_members',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should list channel members via Edge API when available', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({
        ok: true,
        results: [
          { id: 'U123', name: 'alice', real_name: 'Alice Smith', is_bot: false, is_admin: true, profile: {} },
          {
            id: 'U456',
            name: 'bob',
            profile: { display_name: 'Bobby', real_name: 'Bob Jones' },
            is_bot: false,
            is_admin: false,
          },
        ],
      });

      const tool = registeredTools.get('slack_list_channel_members');
      const result = (await tool?.handler({ channel: 'C123', limit: 100 })) as { content: Array<{ text: string }> };

      expect(relay.sendSlackEdgeRequest).toHaveBeenCalledWith(
        'users/list',
        expect.objectContaining({ channels: ['C123'] }),
        'slack_list_channel_members',
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.channel).toBe('C123');
      expect(parsed.member_count).toBe(2);
      expect(parsed.members).toHaveLength(2);
      expect(parsed.members[0]).toEqual({
        id: 'U123',
        name: 'alice',
        real_name: 'Alice Smith',
        display_name: undefined,
        is_bot: false,
        is_admin: true,
      });
    });

    it('should fall back to standard API when Edge API fails', async () => {
      // Edge API returns error
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false, error: 'not_available' });

      // Standard API calls
      mocked(relay.sendServiceRequest)
        .mockResolvedValueOnce({ members: ['U123', 'U456'] })
        .mockResolvedValueOnce({
          members: [
            { id: 'U123', name: 'alice', real_name: 'Alice Smith', is_bot: false, is_admin: true, profile: {} },
            {
              id: 'U456',
              name: 'bob',
              profile: { display_name: 'Bobby', real_name: 'Bob Jones' },
              is_bot: false,
              is_admin: false,
            },
            { id: 'U789', name: 'charlie', is_bot: true },
          ],
        });

      const tool = registeredTools.get('slack_list_channel_members');
      const result = (await tool?.handler({ channel: 'C123', limit: 100 })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.members',
          params: { channel: 'C123', limit: 100 },
          toolId: 'slack_list_channel_members',
        },
        undefined,
      );
      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'users.list',
          params: {},
          toolId: 'slack_list_channel_members',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.channel).toBe('C123');
      expect(parsed.member_count).toBe(2);
      expect(parsed.members).toHaveLength(2);
    });

    it('should handle empty members list', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest).mockResolvedValueOnce({ members: [] }).mockResolvedValueOnce({ members: [] });

      const tool = registeredTools.get('slack_list_channel_members');
      const result = (await tool?.handler({ channel: 'C123' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.member_count).toBe(0);
      expect(parsed.members).toEqual([]);
    });

    it('should handle null members response', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest)
        .mockResolvedValueOnce({ members: null })
        .mockResolvedValueOnce({ members: null });

      const tool = registeredTools.get('slack_list_channel_members');
      const result = (await tool?.handler({ channel: 'C123' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.member_count).toBe(0);
    });
  });

  describe('slack_list_channels', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_list_channels',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should list channels via Edge API when available', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({
        ok: true,
        results: [
          {
            id: 'C123',
            name: 'general',
            is_private: false,
            is_archived: false,
            is_member: true,
            num_members: 50,
            topic: { value: 'General discussion' },
            purpose: { value: 'Team communication' },
          },
          {
            id: 'G456',
            name: 'private-channel',
            is_private: true,
            is_archived: false,
            is_member: true,
            num_members: 5,
          },
        ],
        next_cursor: 'cursor123',
      });

      const tool = registeredTools.get('slack_list_channels');
      const result = (await tool?.handler({
        types: 'public_channel,private_channel',
        limit: 100,
        exclude_archived: true,
      })) as { content: Array<{ text: string }> };

      expect(relay.sendSlackEdgeRequest).toHaveBeenCalledWith(
        'channels/list',
        expect.objectContaining({
          types: 'public_channel,private_channel',
          count: 100,
          exclude_archived: true,
        }),
        'slack_list_channels',
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(2);
      expect(parsed.channels).toHaveLength(2);
      expect(parsed.channels[0].name).toBe('general');
      expect(parsed.channels[0].topic).toBe('General discussion');
      expect(parsed.channels[1].name).toBe('private-channel');
      expect(parsed.channels[1].is_private).toBe(true);
      expect(parsed.next_cursor).toBe('cursor123');
    });

    it('should fall back to standard API when Edge API fails', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest).mockResolvedValue({
        channels: [
          {
            id: 'C123',
            name: 'general',
            is_private: false,
            is_archived: false,
            is_member: true,
            num_members: 50,
            topic: { value: 'General discussion' },
            purpose: { value: 'Team communication' },
          },
        ],
        response_metadata: { next_cursor: 'cursor123' },
      });

      const tool = registeredTools.get('slack_list_channels');
      const result = (await tool?.handler({
        types: 'public_channel,private_channel',
        limit: 100,
        exclude_archived: true,
      })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.list',
          params: expect.objectContaining({
            types: 'public_channel,private_channel',
            limit: 100,
            exclude_archived: true,
          }),
          toolId: 'slack_list_channels',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
      expect(parsed.channels[0].name).toBe('general');
      expect(parsed.next_cursor).toBe('cursor123');
    });

    it('should handle empty channels list', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest).mockResolvedValue({ channels: [] });

      const tool = registeredTools.get('slack_list_channels');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(0);
      expect(parsed.channels).toEqual([]);
      expect(parsed.next_cursor).toBeNull();
    });

    it('should cap limit at 1000', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest).mockResolvedValue({ channels: [] });

      const tool = registeredTools.get('slack_list_channels');
      await tool?.handler({ limit: 5000 });

      expect(relay.sendSlackEdgeRequest).toHaveBeenCalledWith(
        'channels/list',
        expect.objectContaining({ count: 1000 }),
        'slack_list_channels',
      );
    });

    it('should handle missing topic/purpose', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({
        ok: true,
        results: [{ id: 'C123', name: 'test' }],
      });

      const tool = registeredTools.get('slack_list_channels');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.channels[0].topic).toBeUndefined();
      expect(parsed.channels[0].purpose).toBeUndefined();
    });
  });
});
