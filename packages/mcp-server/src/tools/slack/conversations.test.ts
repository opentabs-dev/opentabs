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
import { registerConversationTools } from './conversations.js';
import { relay } from '../../websocket-relay.js';

const registeredTools: Map<string, { handler: (...args: unknown[]) => Promise<unknown> }> = new Map();

describe('Conversation Tools', () => {
  let mockServer: {
    registerTool: typeof mockRegisterTool;
  };

  beforeEach(() => {
    clearAllMocks();
    registeredTools.clear();

    mockServer = {
      registerTool: mockRegisterTool,
    };

    registerConversationTools(mockServer as unknown as McpServer);
  });

  describe('slack_open_dm', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_open_dm',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should open DM with user', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        channel: { id: 'D123', is_im: true },
      });

      const tool = registeredTools.get('slack_open_dm');
      const result = (await tool?.handler({ user: 'U123' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.open',
          params: { users: 'U123' },
          toolId: 'slack_open_dm',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.channel_id).toBe('D123');
      expect(parsed.is_im).toBe(true);
    });

    it('should handle user_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('user_not_found'));

      const tool = registeredTools.get('slack_open_dm');
      const result = (await tool?.handler({ user: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('User not found');
    });

    it('should handle cannot_dm_bot error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('cannot_dm_bot'));

      const tool = registeredTools.get('slack_open_dm');
      const result = (await tool?.handler({ user: 'UBOT123' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_create_channel', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_create_channel',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should create public channel with workspace team_id', async () => {
      mocked(relay.sendServiceRequest)
        // First call: client.userBoot to get workspace team_id
        .mockResolvedValueOnce({ ok: true, default_workspace: 'T123' })
        // Second call: conversations.create
        .mockResolvedValueOnce({
          channel: { id: 'C123', name: 'new-channel', is_private: false },
        });

      const tool = registeredTools.get('slack_create_channel');
      const result = (await tool?.handler({ name: 'new-channel', is_private: false })) as {
        content: Array<{ text: string }>;
      };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'client.userBoot',
          params: {},
          toolId: 'slack_create_channel',
        },
        undefined,
      );
      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.create',
          params: {
            name: 'new-channel',
            is_private: false,
            team_id: 'T123',
            validate_name: 'true',
          },
          toolId: 'slack_create_channel',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('C123');
      expect(parsed.name).toBe('new-channel');
      expect(parsed.is_private).toBe(false);
    });

    it('should create private channel', async () => {
      mocked(relay.sendServiceRequest)
        .mockResolvedValueOnce({ ok: true, default_workspace: 'T123' })
        .mockResolvedValueOnce({
          channel: { id: 'G123', name: 'secret-channel', is_private: true },
        });

      const tool = registeredTools.get('slack_create_channel');
      const result = (await tool?.handler({ name: 'secret-channel', is_private: true })) as {
        content: Array<{ text: string }>;
      };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.is_private).toBe(true);
    });

    it('should handle name_taken error', async () => {
      mocked(relay.sendServiceRequest)
        .mockResolvedValueOnce({ ok: true, default_workspace: 'T123' })
        .mockRejectedValueOnce(new Error('name_taken'));

      const tool = registeredTools.get('slack_create_channel');
      const result = (await tool?.handler({ name: 'existing-channel' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle invalid_name_specials error', async () => {
      mocked(relay.sendServiceRequest)
        .mockResolvedValueOnce({ ok: true, default_workspace: 'T123' })
        .mockRejectedValueOnce(new Error('invalid_name_specials'));

      const tool = registeredTools.get('slack_create_channel');
      const result = (await tool?.handler({ name: 'Invalid Channel Name!' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_archive_channel', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_archive_channel',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should archive channel', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_archive_channel');
      const result = await tool?.handler({ channel: 'C123' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.archive',
          params: { channel: 'C123' },
          toolId: 'slack_archive_channel',
        },
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
      });
    });

    it('should handle already_archived error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('already_archived'));

      const tool = registeredTools.get('slack_archive_channel');
      const result = (await tool?.handler({ channel: 'C123' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle cant_archive_general error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('cant_archive_general'));

      const tool = registeredTools.get('slack_archive_channel');
      const result = (await tool?.handler({ channel: 'C123' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_unarchive_channel', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_unarchive_channel',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should unarchive channel', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_unarchive_channel');
      const result = await tool?.handler({ channel: 'C123' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.unarchive',
          params: { channel: 'C123' },
          toolId: 'slack_unarchive_channel',
        },
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
      });
    });

    it('should handle not_archived error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('not_archived'));

      const tool = registeredTools.get('slack_unarchive_channel');
      const result = (await tool?.handler({ channel: 'C123' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_set_channel_topic', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_set_channel_topic',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should set channel topic', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ topic: 'New topic' });

      const tool = registeredTools.get('slack_set_channel_topic');
      const result = (await tool?.handler({ channel: 'C123', topic: 'New topic' })) as {
        content: Array<{ text: string }>;
      };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.setTopic',
          params: {
            channel: 'C123',
            topic: 'New topic',
          },
          toolId: 'slack_set_channel_topic',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.channel).toBe('C123');
      expect(parsed.topic).toBe('New topic');
    });

    it('should handle too_long error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('too_long'));

      const tool = registeredTools.get('slack_set_channel_topic');
      const result = (await tool?.handler({ channel: 'C123', topic: 'x'.repeat(300) })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle channel_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('channel_not_found'));

      const tool = registeredTools.get('slack_set_channel_topic');
      const result = (await tool?.handler({ channel: 'invalid', topic: 'Test' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Channel not found');
    });
  });

  describe('slack_set_channel_purpose', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_set_channel_purpose',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should set channel purpose', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ purpose: 'New purpose' });

      const tool = registeredTools.get('slack_set_channel_purpose');
      const result = (await tool?.handler({ channel: 'C123', purpose: 'New purpose' })) as {
        content: Array<{ text: string }>;
      };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.setPurpose',
          params: {
            channel: 'C123',
            purpose: 'New purpose',
          },
          toolId: 'slack_set_channel_purpose',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.channel).toBe('C123');
      expect(parsed.purpose).toBe('New purpose');
    });

    it('should handle too_long error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('too_long'));

      const tool = registeredTools.get('slack_set_channel_purpose');
      const result = (await tool?.handler({ channel: 'C123', purpose: 'x'.repeat(300) })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_invite_to_channel', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_invite_to_channel',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should invite user to channel', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        channel: { id: 'C123', name: 'general' },
      });

      const tool = registeredTools.get('slack_invite_to_channel');
      const result = (await tool?.handler({ channel: 'C123', users: 'U456' })) as {
        content: Array<{ text: string }>;
      };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.invite',
          params: {
            channel: 'C123',
            users: 'U456',
          },
          toolId: 'slack_invite_to_channel',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.channel_id).toBe('C123');
      expect(parsed.channel_name).toBe('general');
    });

    it('should invite multiple users', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        channel: { id: 'C123', name: 'general' },
      });

      const tool = registeredTools.get('slack_invite_to_channel');
      await tool?.handler({ channel: 'C123', users: 'U456,U789' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.invite',
          params: {
            channel: 'C123',
            users: 'U456,U789',
          },
          toolId: 'slack_invite_to_channel',
        },
        undefined,
      );
    });

    it('should handle already_in_channel error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('already_in_channel'));

      const tool = registeredTools.get('slack_invite_to_channel');
      const result = (await tool?.handler({ channel: 'C123', users: 'U456' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle user_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('user_not_found'));

      const tool = registeredTools.get('slack_invite_to_channel');
      const result = (await tool?.handler({ channel: 'C123', users: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('User not found');
    });
  });

  describe('slack_kick_from_channel', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_kick_from_channel',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should kick user from channel', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_kick_from_channel');
      const result = await tool?.handler({ channel: 'C123', user: 'U456' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.kick',
          params: {
            channel: 'C123',
            user: 'U456',
          },
          toolId: 'slack_kick_from_channel',
        },
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
      });
    });

    it('should handle not_in_channel error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('not_in_channel'));

      const tool = registeredTools.get('slack_kick_from_channel');
      const result = (await tool?.handler({ channel: 'C123', user: 'U456' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle cant_kick_self error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('cant_kick_self'));

      const tool = registeredTools.get('slack_kick_from_channel');
      const result = (await tool?.handler({ channel: 'C123', user: 'U123' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_rename_channel', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_rename_channel',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should rename channel', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        channel: { id: 'C123', name: 'new-name' },
      });

      const tool = registeredTools.get('slack_rename_channel');
      const result = (await tool?.handler({ channel: 'C123', name: 'new-name' })) as {
        content: Array<{ text: string }>;
      };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.rename',
          params: {
            channel: 'C123',
            name: 'new-name',
          },
          toolId: 'slack_rename_channel',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('C123');
      expect(parsed.name).toBe('new-name');
    });

    it('should handle name_taken error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('name_taken'));

      const tool = registeredTools.get('slack_rename_channel');
      const result = (await tool?.handler({ channel: 'C123', name: 'existing-name' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle invalid_name error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('invalid_name'));

      const tool = registeredTools.get('slack_rename_channel');
      const result = (await tool?.handler({ channel: 'C123', name: 'Invalid Name!' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_join_channel', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_join_channel',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should join channel', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        channel: { id: 'C123', name: 'general' },
      });

      const tool = registeredTools.get('slack_join_channel');
      const result = (await tool?.handler({ channel: 'C123' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.join',
          params: { channel: 'C123' },
          toolId: 'slack_join_channel',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('C123');
      expect(parsed.name).toBe('general');
      expect(parsed.is_member).toBe(true);
    });

    it('should handle channel_not_found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('channel_not_found'));

      const tool = registeredTools.get('slack_join_channel');
      const result = (await tool?.handler({ channel: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Channel not found');
    });

    it('should handle is_archived error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('is_archived'));

      const tool = registeredTools.get('slack_join_channel');
      const result = (await tool?.handler({ channel: 'C123' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle method_not_supported_for_channel_type error for private channel', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('method_not_supported_for_channel_type'));

      const tool = registeredTools.get('slack_join_channel');
      const result = (await tool?.handler({ channel: 'G123' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_leave_channel', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_leave_channel',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should leave channel', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ ok: true });

      const tool = registeredTools.get('slack_leave_channel');
      const result = await tool?.handler({ channel: 'C123' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'conversations.leave',
          params: { channel: 'C123' },
          toolId: 'slack_leave_channel',
        },
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ ok: true }, null, 2) }],
      });
    });

    it('should handle not_in_channel error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('not_in_channel'));

      const tool = registeredTools.get('slack_leave_channel');
      const result = (await tool?.handler({ channel: 'C123' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });

    it('should handle cant_leave_general error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('cant_leave_general'));

      const tool = registeredTools.get('slack_leave_channel');
      const result = (await tool?.handler({ channel: 'C123' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });
});
