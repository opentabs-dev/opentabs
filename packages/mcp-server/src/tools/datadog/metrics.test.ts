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
import { registerDatadogMetricsTools } from './metrics.js';
import { relay } from '../../websocket-relay.js';

describe('Datadog Metrics Tools', () => {
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

    registerDatadogMetricsTools(mockServer as unknown as McpServer);
  });

  afterEach(() => {
    setSystemTime(); // Reset to real time
  });

  describe('datadog_query_metrics', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'datadog_query_metrics',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should query metrics with default time range', async () => {
      const mockResponse = {
        series: [
          {
            metric: 'system.cpu.user',
            pointlist: [
              [1705316400000, 25.5],
              [1705316460000, 30.2],
            ],
          },
        ],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_query_metrics');
      const result = (await tool?.handler({ query: 'avg:system.cpu.user{*}' })) as { content: Array<{ text: string }> };

      // Default time range is 1 hour
      const now = Math.floor(Date.now() / 1000);
      const from = now - 1 * 60 * 60;

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/query',
          method: 'GET',
          params: {
            query: 'avg:system.cpu.user{*}',
            from: `${from}`,
            to: `${now}`,
          },
          env: undefined,
          toolId: 'datadog_query_metrics',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.series).toHaveLength(1);
      expect(parsed.series[0].metric).toBe('system.cpu.user');
    });

    it('should query metrics with custom time range', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ series: [] });

      const tool = registeredTools.get('datadog_query_metrics');
      await tool?.handler({ query: 'sum:my.metric{env:prod}', timeRangeHours: 6 });

      const now = Math.floor(Date.now() / 1000);
      const from = now - 6 * 60 * 60;

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/query',
          method: 'GET',
          params: {
            query: 'sum:my.metric{env:prod}',
            from: `${from}`,
            to: `${now}`,
          },
          env: undefined,
          toolId: 'datadog_query_metrics',
        },
        undefined,
      );
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('Invalid query'));

      const tool = registeredTools.get('datadog_query_metrics');
      const result = (await tool?.handler({ query: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('datadog_list_metrics', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'datadog_list_metrics',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should list metrics with default time range', async () => {
      const mockResponse = {
        metrics: ['system.cpu.user', 'system.cpu.system', 'system.memory.used'],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_list_metrics');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      // Default time range is 24 hours
      const now = Math.floor(Date.now() / 1000);
      const from = now - 24 * 60 * 60;

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/metrics',
          method: 'GET',
          params: {
            from: `${from}`,
          },
          env: undefined,
          toolId: 'datadog_list_metrics',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metrics).toHaveLength(3);
    });

    it('should list metrics with search filter', async () => {
      const mockResponse = {
        metrics: ['system.cpu.user', 'system.cpu.system', 'system.memory.used'],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_list_metrics');
      const result = (await tool?.handler({ search: 'system.cpu', timeRangeHours: 12 })) as {
        content: Array<{ text: string }>;
      };

      const now = Math.floor(Date.now() / 1000);
      const from = now - 12 * 60 * 60;

      // The search is now done client-side, so the API call doesn't include 'q'
      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/metrics',
          method: 'GET',
          params: {
            from: `${from}`,
          },
          env: undefined,
          toolId: 'datadog_list_metrics',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      // Client-side filtering for 'system.cpu' should return only the 2 matching metrics
      expect(parsed.metrics).toHaveLength(2);
      expect(parsed.metrics).toContain('system.cpu.user');
      expect(parsed.metrics).toContain('system.cpu.system');
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('API error'));

      const tool = registeredTools.get('datadog_list_metrics');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('datadog_get_metric_metadata', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'datadog_get_metric_metadata',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get metric metadata', async () => {
      const mockMetadata = {
        description: 'Average CPU usage by user processes',
        short_name: 'cpu user',
        integration: 'system',
        unit: 'percent',
        per_unit: null,
        type: 'gauge',
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockMetadata);

      const tool = registeredTools.get('datadog_get_metric_metadata');
      const result = (await tool?.handler({ metricName: 'system.cpu.user' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/metrics/system.cpu.user',
          method: 'GET',
          env: undefined,
          toolId: 'datadog_get_metric_metadata',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.unit).toBe('percent');
      expect(parsed.type).toBe('gauge');
    });

    it('should handle non-existent metric', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('Metric not found'));

      const tool = registeredTools.get('datadog_get_metric_metadata');
      const result = (await tool?.handler({ metricName: 'nonexistent.metric' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });
});
