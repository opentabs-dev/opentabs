import { describe, it, expect, beforeEach, afterEach, mock, setSystemTime } from 'bun:test';
import { mocked, clearAllMocks, trackMock } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Create mock function before module mock
const mockSendServiceRequest = trackMock(mock(() => {}));

// Mock the websocket relay - must be before importing the module that uses it
mock.module('../../websocket-relay', () => ({
  relay: {
    sendServiceRequest: mockSendServiceRequest,
  },
}));

// Import after mock.module
import { registerDatadogLogsTools } from './logs.js';
import { relay } from '../../websocket-relay.js';

describe('Datadog Logs Tools', () => {
  let mockServer: {
    registerTool: ReturnType<typeof mock>;
  };
  const registeredTools: Map<string, { handler: (...args: unknown[]) => Promise<unknown> }> = new Map();

  beforeEach(() => {
    clearAllMocks();
    setSystemTime(new Date('2024-01-15T12:00:00Z'));

    mockServer = {
      registerTool: mock(
        (name: string, _config: { description?: string; inputSchema?: unknown }, handler: () => Promise<unknown>) => {
          registeredTools.set(name, { handler });
        },
      ),
    };

    registerDatadogLogsTools(mockServer as unknown as McpServer);
  });

  afterEach(() => {
    setSystemTime(); // Reset to real time
  });

  describe('datadog_search_logs', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'datadog_search_logs',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should search logs with default parameters', async () => {
      const mockResponse = {
        status: 'done',
        hitCount: 2,
        result: {
          events: [
            {
              event_id: 'log1',
              columns: ['error', '2024-01-15T11:00:00Z', 'host1', 'my-service', 'Error message'],
            },
            {
              event_id: 'log2',
              columns: ['info', '2024-01-15T10:30:00Z', 'host2', 'my-service', 'Info message'],
            },
          ],
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_search_logs');
      const result = (await tool?.handler({ query: 'service:my-service' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/logs-analytics/list?type=logs',
          method: 'POST',
          body: expect.objectContaining({
            list: expect.objectContaining({
              search: { query: 'service:my-service' },
              limit: 50,
            }),
          }),
          env: undefined,
          toolId: 'datadog_search_logs',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.hitCount).toBe(2);
      expect(parsed.events).toHaveLength(2);
      expect(parsed.events[0]).toMatchObject({
        id: 'log1',
        timestamp: '2024-01-15T11:00:00Z',
        host: 'host1',
        service: 'my-service',
        message: 'Error message',
        status: 'error',
      });
    });

    it('should search logs with custom time range and limit', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        status: 'done',
        hitCount: 0,
        result: { events: [] },
      });

      const tool = registeredTools.get('datadog_search_logs');
      await tool?.handler({ query: 'status:error', timeRangeHours: 1, limit: 100 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/logs-analytics/list?type=logs',
          method: 'POST',
          body: expect.objectContaining({
            list: expect.objectContaining({
              limit: 100,
              time: {
                from: expect.any(Number),
                to: expect.any(Number),
              },
            }),
          }),
          env: undefined,
          toolId: 'datadog_search_logs',
        },
        undefined,
      );

      // Verify the time range is 1 hour
      const callArgs = mocked(relay.sendServiceRequest).mock.calls[0];
      const params = callArgs[1] as { body: { list: { time: { from: number; to: number } } } };
      const timeDiff = params.body.list.time.to - params.body.list.time.from;
      expect(timeDiff).toBe(1 * 60 * 60 * 1000); // 1 hour in ms
    });

    it('should cap limit at 1000', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        status: 'done',
        result: { events: [] },
      });

      const tool = registeredTools.get('datadog_search_logs');
      await tool?.handler({ query: '*', limit: 5000 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/logs-analytics/list?type=logs',
          method: 'POST',
          body: expect.objectContaining({
            list: expect.objectContaining({
              limit: 1000, // Should be capped
            }),
          }),
          env: undefined,
          toolId: 'datadog_search_logs',
        },
        undefined,
      );
    });

    it('should handle empty results', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        status: 'done',
        hitCount: 0,
        result: { events: [] },
      });

      const tool = registeredTools.get('datadog_search_logs');
      const result = (await tool?.handler({ query: 'nonexistent' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.hitCount).toBe(0);
      expect(parsed.events).toEqual([]);
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('Query failed'));

      const tool = registeredTools.get('datadog_search_logs');
      const result = (await tool?.handler({ query: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });

    it('should include trace correlation and error details', async () => {
      const mockResponse = {
        status: 'done',
        hitCount: 1,
        result: {
          events: [
            {
              event_id: 'log1',
              columns: ['error', '2024-01-15T11:00:00Z', 'host1', 'my-service', 'Error occurred'],
              event: {
                trace_id: '1234567890',
                span_id: '9876543210',
                custom: {
                  error: {
                    stack: 'java.lang.Error at...',
                    message: 'Something went wrong',
                  },
                },
              },
            },
          ],
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_search_logs');
      const result = (await tool?.handler({ query: 'status:error' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.events[0].traceId).toBe('1234567890');
      expect(parsed.events[0].spanId).toBe('9876543210');
      expect(parsed.events[0].error).toEqual({
        stack: 'java.lang.Error at...',
        message: 'Something went wrong',
      });
    });
  });
});
