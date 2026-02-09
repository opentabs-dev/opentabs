import { describe, it, expect, beforeEach, afterEach, mock, setSystemTime } from 'bun:test';
import { mocked, clearAllMocks, trackMock } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Create mock function before module mock
const mockSendServiceRequest = trackMock(mock(() => {}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRegisterTool = mock<any>(() => {});

// Mock - must be before imports
mock.module('../../websocket-relay', () => ({
  relay: {
    sendServiceRequest: mockSendServiceRequest,
  },
}));

// Import after mock.module
import { registerDatadogWatchdogTools } from './watchdog.js';
import { relay } from '../../websocket-relay.js';

describe('Datadog Watchdog Tools', () => {
  const registeredTools: Map<string, { handler: (...args: unknown[]) => Promise<unknown> }> = new Map();

  beforeEach(() => {
    clearAllMocks();
    setSystemTime(new Date('2024-01-15T12:00:00Z'));

    mockRegisterTool.mockImplementation(
      (name: string, _config: { description?: string; inputSchema?: unknown }, handler: () => Promise<unknown>) => {
        registeredTools.set(name, { handler });
      },
    );

    const mockServer = {
      registerTool: mockRegisterTool,
    };

    registerDatadogWatchdogTools(mockServer as unknown as McpServer);
  });

  afterEach(() => {
    setSystemTime(); // Reset to real time
  });

  describe('datadog_get_watchdog_insights', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_get_watchdog_insights',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get watchdog insights with default parameters', async () => {
      // The new implementation uses span search to find errors and aggregate by service
      const mockResponse = {
        data: [
          {
            id: 'span1',
            attributes: {
              service: 'billing-lifecycle-dgs',
              resource_name: 'POST /api/billing',
              operation_name: 'grpc.server',
              status: 'error',
              start_timestamp: '2024-01-15T11:30:00Z',
              custom: {
                error: {
                  type: 'DEADLINE_EXCEEDED',
                  message: 'Request timeout after 30s',
                },
              },
            },
          },
          {
            id: 'span2',
            attributes: {
              service: 'billing-lifecycle-dgs',
              resource_name: 'GET /api/status',
              status: 'error',
              start_timestamp: '2024-01-15T11:35:00Z',
              custom: {
                error: {
                  type: 'DEADLINE_EXCEEDED',
                  message: 'Connection timeout',
                },
              },
            },
          },
        ],
        meta: { status: 'done' },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_get_watchdog_insights');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      // Verify the new API call format
      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/spans/events/search',
          method: 'POST',
          body: expect.objectContaining({
            data: expect.objectContaining({
              type: 'search_request',
              attributes: expect.objectContaining({
                filter: expect.objectContaining({
                  query: expect.stringContaining('status:error'),
                }),
              }),
            }),
          }),
          env: undefined,
          toolId: 'datadog_get_watchdog_insights',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.totalErrorSpans).toBe(2);
      expect(parsed.affectedServices).toBe(1);
      expect(parsed.insights).toHaveLength(1);
      expect(parsed.insights[0]).toMatchObject({
        type: 'error_spike',
        service: 'billing-lifecycle-dgs',
        errorCount: 2,
        errorTypes: expect.arrayContaining(['DEADLINE_EXCEEDED']),
      });
    });

    it('should filter by service and environment', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ data: [], meta: {} });

      const tool = registeredTools.get('datadog_get_watchdog_insights');
      await tool?.handler({ service: 'billing-lifecycle-dgs', env: 'production', timeRangeHours: 6 });

      // Verify service and env are included in the query
      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/spans/events/search',
          method: 'POST',
          body: expect.objectContaining({
            data: expect.objectContaining({
              attributes: expect.objectContaining({
                filter: expect.objectContaining({
                  query: 'env:production service:billing-lifecycle-dgs status:error',
                }),
              }),
            }),
          }),
          env: undefined,
          toolId: 'datadog_get_watchdog_insights',
        },
        undefined,
      );
    });

    it('should handle empty results', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({
        data: [],
        meta: { status: 'done' },
      });

      const tool = registeredTools.get('datadog_get_watchdog_insights');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.totalErrorSpans).toBe(0);
      expect(parsed.affectedServices).toBe(0);
      expect(parsed.insights).toEqual([]);
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('API error'));

      const tool = registeredTools.get('datadog_get_watchdog_insights');
      const result = (await tool?.handler({})) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });
});
