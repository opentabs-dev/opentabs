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
import { registerSearchTools } from './search.js';
import { relay } from '../../websocket-relay.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('Search Tools', () => {
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

    registerSearchTools(mockServer as unknown as McpServer);
  });

  describe('slack_search_messages', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_search_messages',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should search messages and format results', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        messages: {
          total: 2,
          matches: [
            {
              channel: { id: 'C123', name: 'general' },
              username: 'alice',
              text: 'Hello world',
              ts: '123.456',
              permalink: 'https://slack.com/archives/C123/p123456',
            },
            {
              channel: { id: 'C456', name: 'random' },
              username: 'bob',
              text: 'World hello',
              ts: '123.457',
              permalink: 'https://slack.com/archives/C456/p123457',
            },
          ],
        },
      });

      const tool = registeredTools.get('slack_search_messages');
      const result = (await tool?.handler({ query: 'hello', count: 20, sort: 'score', sort_dir: 'desc' })) as {
        content: Array<{ text: string }>;
      };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'search.messages',
          params: {
            query: 'hello',
            count: 20,
            sort: 'score',
            sort_dir: 'desc',
          },
          toolId: 'slack_search_messages',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBe(2);
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0]).toEqual({
        channel: 'general',
        user: 'alice',
        text: 'Hello world',
        ts: '123.456',
        permalink: 'https://slack.com/archives/C123/p123456',
      });
    });

    it('should cap count at 100', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ messages: { total: 0, matches: [] } });

      const tool = registeredTools.get('slack_search_messages');
      await tool?.handler({ query: 'test', count: 500 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'search.messages',
          params: expect.objectContaining({ count: 100 }),
          toolId: 'slack_search_messages',
        },
        undefined,
      );
    });

    it('should handle empty results', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ messages: null });

      const tool = registeredTools.get('slack_search_messages');
      const result = (await tool?.handler({ query: 'nonexistent' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBe(0);
      expect(parsed.messages).toEqual([]);
    });
  });

  describe('slack_search_files', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_search_files',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should search files and format results', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        files: {
          total: 1,
          matches: [
            {
              id: 'F123',
              name: 'document.pdf',
              title: 'Important Document',
              filetype: 'pdf',
              size: 1024,
              permalink: 'https://slack.com/files/F123',
            },
          ],
        },
      });

      const tool = registeredTools.get('slack_search_files');
      const result = (await tool?.handler({ query: 'document', count: 20 })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'search.files',
          params: {
            query: 'document',
            count: 20,
          },
          toolId: 'slack_search_files',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBe(1);
      expect(parsed.files[0]).toEqual({
        id: 'F123',
        name: 'document.pdf',
        title: 'Important Document',
        filetype: 'pdf',
        size: 1024,
        permalink: 'https://slack.com/files/F123',
      });
    });

    it('should cap count at 100', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ files: { total: 0, matches: [] } });

      const tool = registeredTools.get('slack_search_files');
      await tool?.handler({ query: 'test', count: 500 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'search.files',
          params: expect.objectContaining({ count: 100 }),
          toolId: 'slack_search_files',
        },
        undefined,
      );
    });
  });

  describe('slack_search_users', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_search_users',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should search users via Edge API when available', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({
        ok: true,
        results: [
          { id: 'U123', name: 'alice', real_name: 'Alice Smith', is_bot: false, profile: {} },
          { id: 'U789', name: 'alicia', real_name: 'Alicia Garcia', is_bot: false, profile: {} },
        ],
      });

      const tool = registeredTools.get('slack_search_users');
      const result = (await tool?.handler({ query: 'ali' })) as { content: Array<{ text: string }> };

      expect(relay.sendSlackEdgeRequest).toHaveBeenCalledWith(
        'users/search',
        { query: 'ali', count: 20 },
        'slack_search_users',
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed.map((u: { name: string }) => u.name)).toContain('alice');
      expect(parsed.map((u: { name: string }) => u.name)).toContain('alicia');
    });

    it('should fall back to users.list when Edge API returns no results', async () => {
      // Edge API returns empty results
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: true, results: [] });

      // Fallback to users.list
      mocked(relay.sendServiceRequest).mockResolvedValue({
        members: [
          { id: 'U123', name: 'alice', real_name: 'Alice Smith', is_bot: false, profile: {} },
          { id: 'U456', name: 'bob', real_name: 'Bob Jones', is_bot: false, profile: {} },
          { id: 'U789', name: 'alicia', real_name: 'Alicia Garcia', is_bot: false, profile: {} },
        ],
      });

      const tool = registeredTools.get('slack_search_users');
      const result = (await tool?.handler({ query: 'ali' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed.map((u: { name: string }) => u.name)).toContain('alice');
      expect(parsed.map((u: { name: string }) => u.name)).toContain('alicia');
    });

    it('should search users by real_name in fallback', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest).mockResolvedValue({
        members: [
          { id: 'U123', name: 'alice', real_name: 'Alice Smith', is_bot: false, profile: {} },
          { id: 'U456', name: 'bob', real_name: 'Bob Smith', is_bot: false, profile: {} },
        ],
      });

      const tool = registeredTools.get('slack_search_users');
      const result = (await tool?.handler({ query: 'smith' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
    });

    it('should search users by display_name in fallback', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest).mockResolvedValue({
        members: [{ id: 'U123', name: 'alice', is_bot: false, profile: { display_name: 'AliceTheGreat' } }],
      });

      const tool = registeredTools.get('slack_search_users');
      const result = (await tool?.handler({ query: 'great' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
    });

    it('should search users by email in fallback', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest).mockResolvedValue({
        members: [{ id: 'U123', name: 'alice', is_bot: false, profile: { email: 'alice@company.com' } }],
      });

      const tool = registeredTools.get('slack_search_users');
      const result = (await tool?.handler({ query: 'company.com' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
    });

    it('should be case insensitive in fallback', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest).mockResolvedValue({
        members: [{ id: 'U123', name: 'ALICE', real_name: 'Alice Smith', is_bot: false, profile: {} }],
      });

      const tool = registeredTools.get('slack_search_users');
      const result = (await tool?.handler({ query: 'alice' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
    });

    it('should limit results to 20', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest).mockResolvedValue({
        members: Array.from({ length: 50 }, (_, i) => ({
          id: `U${i}`,
          name: `user_alice_${i}`,
          is_bot: false,
          profile: {},
        })),
      });

      const tool = registeredTools.get('slack_search_users');
      const result = (await tool?.handler({ query: 'alice' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(20);
    });

    it('should return empty array when no matches', async () => {
      mocked(relay.sendSlackEdgeRequest).mockResolvedValue({ ok: false });
      mocked(relay.sendServiceRequest).mockResolvedValue({
        members: [{ id: 'U123', name: 'bob', is_bot: false, profile: {} }],
      });

      const tool = registeredTools.get('slack_search_users');
      const result = (await tool?.handler({ query: 'alice' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual([]);
    });
  });
});
