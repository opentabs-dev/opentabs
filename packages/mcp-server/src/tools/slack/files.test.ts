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
import { registerFileTools } from './files.js';
import { relay } from '../../websocket-relay.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('File Tools', () => {
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

    registerFileTools(mockServer as unknown as McpServer);
  });

  describe('slack_get_file_info', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_get_file_info',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get file info and format response', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        file: {
          id: 'F123',
          name: 'document.pdf',
          title: 'Important Document',
          mimetype: 'application/pdf',
          filetype: 'pdf',
          size: 1024000,
          url_private: 'https://files.slack.com/files-pri/T123-F123/document.pdf',
          url_private_download: 'https://files.slack.com/files-pri/T123-F123/download/document.pdf',
          permalink: 'https://myteam.slack.com/files/U123/F123/document.pdf',
        },
      });

      const tool = registeredTools.get('slack_get_file_info');
      const result = (await tool?.handler({ file: 'F123' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'files.info',
          params: { file: 'F123' },
          toolId: 'slack_get_file_info',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({
        id: 'F123',
        name: 'document.pdf',
        title: 'Important Document',
        mimetype: 'application/pdf',
        filetype: 'pdf',
        size: 1024000,
        url_private: 'https://files.slack.com/files-pri/T123-F123/document.pdf',
        url_private_download: 'https://files.slack.com/files-pri/T123-F123/download/document.pdf',
        permalink: 'https://myteam.slack.com/files/U123/F123/document.pdf',
      });
    });

    it('should handle file not found error', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('file_not_found'));

      const tool = registeredTools.get('slack_get_file_info');
      const result = (await tool?.handler({ file: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error:');
    });

    it('should handle missing optional fields', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        file: {
          id: 'F123',
          name: 'file.txt',
        },
      });

      const tool = registeredTools.get('slack_get_file_info');
      const result = (await tool?.handler({ file: 'F123' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('F123');
      expect(parsed.name).toBe('file.txt');
      expect(parsed.title).toBeUndefined();
      expect(parsed.mimetype).toBeUndefined();
    });
  });

  describe('slack_list_files', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'slack_list_files',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should list files and format response', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        files: [
          {
            id: 'F123',
            name: 'doc1.pdf',
            title: 'Document 1',
            filetype: 'pdf',
            size: 1024,
            permalink: 'https://slack.com/files/F123',
          },
          {
            id: 'F456',
            name: 'image.png',
            title: 'Screenshot',
            filetype: 'png',
            size: 2048,
            permalink: 'https://slack.com/files/F456',
          },
        ],
      });

      const tool = registeredTools.get('slack_list_files');
      const result = (await tool?.handler({ count: 20 })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'files.list',
          params: {
            channel: undefined,
            user: undefined,
            types: undefined,
            count: 20,
          },
          toolId: 'slack_list_files',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({
        id: 'F123',
        name: 'doc1.pdf',
        title: 'Document 1',
        filetype: 'pdf',
        size: 1024,
        permalink: 'https://slack.com/files/F123',
      });
    });

    it('should filter by channel', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ files: [] });

      const tool = registeredTools.get('slack_list_files');
      await tool?.handler({ channel: 'C123', count: 10 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'files.list',
          params: expect.objectContaining({ channel: 'C123' }),
          toolId: 'slack_list_files',
        },
        undefined,
      );
    });

    it('should filter by user', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ files: [] });

      const tool = registeredTools.get('slack_list_files');
      await tool?.handler({ user: 'U123', count: 10 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'files.list',
          params: expect.objectContaining({ user: 'U123' }),
          toolId: 'slack_list_files',
        },
        undefined,
      );
    });

    it('should filter by types', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ files: [] });

      const tool = registeredTools.get('slack_list_files');
      await tool?.handler({ types: 'images', count: 10 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'slack',
        {
          method: 'files.list',
          params: expect.objectContaining({ types: 'images' }),
          toolId: 'slack_list_files',
        },
        undefined,
      );
    });

    it('should handle empty files list', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ files: [] });

      const tool = registeredTools.get('slack_list_files');
      const result = (await tool?.handler({ count: 20 })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual([]);
    });

    it('should handle null files response', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ files: null });

      const tool = registeredTools.get('slack_list_files');
      const result = (await tool?.handler({ count: 20 })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual([]);
    });
  });
});
