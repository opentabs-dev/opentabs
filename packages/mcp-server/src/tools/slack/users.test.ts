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
import { registerUserTools } from './users.js';
import { relay } from '../../websocket-relay.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('User Tools', () => {
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

    registerUserTools(mockServer as unknown as McpServer);
  });

  describe('slack_get_user_info', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_get_user_info',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get user info and format response', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        user: {
          id: 'U123',
          name: 'alice',
          real_name: 'Alice Smith',
          is_bot: false,
          is_admin: true,
          profile: {
            display_name: 'Alice',
            email: 'alice@example.com',
          },
        },
      });

      const tool = registeredTools.get('slack_get_user_info');
      const result = (await tool?.handler({ user: 'U123' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'users.info',
          params: { user: 'U123' },
          toolId: 'slack_get_user_info',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({
        id: 'U123',
        name: 'alice',
        real_name: 'Alice Smith',
        display_name: 'Alice',
        email: 'alice@example.com',
        is_bot: false,
        is_admin: true,
      });
    });

    it('should fallback to profile.real_name', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        user: {
          id: 'U123',
          name: 'alice',
          profile: {
            real_name: 'Alice from Profile',
          },
        },
      });

      const tool = registeredTools.get('slack_get_user_info');
      const result = (await tool?.handler({ user: 'U123' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.real_name).toBe('Alice from Profile');
    });

    it('should handle user not found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('user_not_found'));

      const tool = registeredTools.get('slack_get_user_info');
      const result = (await tool?.handler({ user: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
    });
  });

  describe('slack_list_users', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_list_users',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should list users via Edge API when available', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({
        ok: true,
        results: [
          { id: 'U123', name: 'alice', is_bot: false, profile: {} },
          { id: 'U456', name: 'slackbot', is_bot: true, profile: {} },
          { id: 'U789', name: 'bob', is_bot: false, profile: {} },
        ],
      });

      const tool = registeredTools.get('slack_list_users');
      const result = (await tool?.handler({ limit: 100, include_bots: false })) as {
        content: Array<{ text: string }>;
      };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed.every((u: { is_bot: boolean }) => !u.is_bot)).toBe(true);
    });

    it('should fall back to standard API when Edge API fails', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest).mockResolvedValue({
        members: [
          { id: 'U123', name: 'alice', is_bot: false, profile: {} },
          { id: 'U456', name: 'slackbot', is_bot: true, profile: {} },
          { id: 'U789', name: 'bob', is_bot: false, profile: {} },
        ],
      });

      const tool = registeredTools.get('slack_list_users');
      const result = (await tool?.handler({ limit: 100, include_bots: false })) as {
        content: Array<{ text: string }>;
      };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed.every((u: { is_bot: boolean }) => !u.is_bot)).toBe(true);
    });

    it('should include bots when requested', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({
        ok: true,
        results: [
          { id: 'U123', name: 'alice', is_bot: false, profile: {} },
          { id: 'U456', name: 'slackbot', is_bot: true, profile: {} },
        ],
      });

      const tool = registeredTools.get('slack_list_users');
      const result = (await tool?.handler({ limit: 100, include_bots: true })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
    });

    it('should respect limit parameter', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({
        ok: true,
        results: Array.from({ length: 50 }, (_, i) => ({
          id: `U${i}`,
          name: `user${i}`,
          is_bot: false,
          profile: {},
        })),
      });

      const tool = registeredTools.get('slack_list_users');
      const result = (await tool?.handler({ limit: 10, include_bots: false })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(10);
    });

    it('should handle empty members list', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest).mockResolvedValue({ members: [] });

      const tool = registeredTools.get('slack_list_users');
      const result = (await tool?.handler({ limit: 100, include_bots: false })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual([]);
    });
  });

  describe('slack_get_my_profile', () => {
    it('should register the tool with empty schema', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_get_my_profile',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get current user profile', async () => {
      mocked(relay.sendServiceRequest)
        .mockResolvedValueOnce({
          user_id: 'U123',
          user: 'alice',
          team: 'My Team',
          team_id: 'T123',
        })
        .mockResolvedValueOnce({
          user: {
            id: 'U123',
            name: 'alice',
            real_name: 'Alice Smith',
            is_admin: true,
            profile: {
              display_name: 'Alice',
              email: 'alice@example.com',
            },
          },
        });

      const tool = registeredTools.get('slack_get_my_profile');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'auth.test',
          params: {},
          toolId: 'slack_get_my_profile',
        },
        undefined,
      );
      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'users.info',
          params: { user: 'U123' },
          toolId: 'slack_get_my_profile',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({
        user_id: 'U123',
        username: 'alice',
        team: 'My Team',
        team_id: 'T123',
        real_name: 'Alice Smith',
        display_name: 'Alice',
        email: 'alice@example.com',
        is_admin: true,
      });
    });

    it('should handle auth error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('not_authed'));

      const tool = registeredTools.get('slack_get_my_profile');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Authentication failed');
    });
  });
});
