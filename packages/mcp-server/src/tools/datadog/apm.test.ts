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
import { registerDatadogApmTools } from './apm.js';
import { relay } from '../../websocket-relay.js';

describe('Datadog APM Tools', () => {
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

    registerDatadogApmTools(mockServer as unknown as McpServer);
  });

  afterEach(() => {
    setSystemTime(); // Reset to real time
  });

  describe('datadog_search_traces', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_search_traces',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should search traces with default parameters', async () => {
      const mockResponse = {
        data: [
          {
            id: 'span-123',
            type: 'spans',
            attributes: {
              service: 'my-service',
              resource_name: 'GET /api/users',
              duration: 150000000,
            },
          },
        ],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_search_traces');
      const result = (await tool?.handler({ query: 'service:my-service' })) as { content: Array<{ text: string }> };

      const now = Date.now();
      const from = now - 1 * 60 * 60 * 1000;

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/spans/events/search',
          method: 'POST',
          body: {
            data: {
              type: 'search_request',
              attributes: {
                filter: {
                  query: 'service:my-service',
                  from: new Date(from).toISOString(),
                  to: new Date(now).toISOString(),
                },
                page: {
                  limit: 50,
                },
              },
            },
          },
          env: undefined,
          toolId: 'datadog_search_traces',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].attributes.service).toBe('my-service');
    });

    it('should search traces with custom time range and limit', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ data: [] });

      const tool = registeredTools.get('datadog_search_traces');
      await tool?.handler({ query: 'env:production', timeRangeHours: 6, limit: 100 });

      const now = Date.now();
      const from = now - 6 * 60 * 60 * 1000;

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/spans/events/search',
          method: 'POST',
          body: {
            data: {
              type: 'search_request',
              attributes: {
                filter: {
                  query: 'env:production',
                  from: new Date(from).toISOString(),
                  to: new Date(now).toISOString(),
                },
                page: {
                  limit: 100,
                },
              },
            },
          },
          env: undefined,
          toolId: 'datadog_search_traces',
        },
        undefined,
      );
    });

    it('should cap limit at 1000', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ data: [] });

      const tool = registeredTools.get('datadog_search_traces');
      await tool?.handler({ query: '*', limit: 5000 });

      const callArgs = mocked(relay.sendServiceRequest).mock.calls[0];
      const params = callArgs[1] as { body: { data: { attributes: { page: { limit: number } } } } };
      expect(params.body.data.attributes.page.limit).toBe(1000);
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('Search failed'));

      const tool = registeredTools.get('datadog_search_traces');
      const result = (await tool?.handler({ query: 'invalid' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('datadog_get_trace', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_get_trace',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get trace by ID with structured response', async () => {
      // Mock response in the internal API format (InternalTraceResponse)
      // Internal API returns start/duration in seconds (or milliseconds)
      const mockTrace = {
        trace: {
          root_id: 'span-1',
          spans: {
            'span-1': {
              span_id: 'span-1',
              service: 'api-gateway',
              name: 'http.request',
              resource: 'GET /api/users',
              start: 1705319400, // seconds since epoch
              duration: 0.05, // 50ms in seconds
              error: 0,
              children_ids: ['span-2'],
            },
            'span-2': {
              span_id: 'span-2',
              parent_id: 'span-1',
              service: 'user-service',
              name: 'db.query',
              resource: 'SELECT * FROM users',
              start: 1705319400.01,
              duration: 0.02, // 20ms in seconds
              error: 1,
              meta: {
                'error.message': 'Query timeout',
                'error.type': 'TimeoutException',
              },
            },
          },
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockTrace);

      const tool = registeredTools.get('datadog_get_trace');
      const result = (await tool?.handler({ traceId: 'abc123' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/trace/abc123',
          method: 'GET',
          env: undefined,
          toolId: 'datadog_get_trace',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.traceId).toBe('abc123');
      expect(parsed.summary.totalSpans).toBe(2);
      expect(parsed.summary.services).toContain('api-gateway');
      expect(parsed.summary.services).toContain('user-service');
      expect(parsed.summary.errorCount).toBe(1);
      expect(parsed.errors).toHaveLength(1);
      expect(parsed.errors[0].errorMessage).toBe('Query timeout');
    });

    it('should include span tree when requested', async () => {
      // Mock response in the internal API format
      const mockTrace = {
        trace: {
          root_id: 'span-1',
          spans: {
            'span-1': {
              span_id: 'span-1',
              service: 'my-service',
              name: 'http.request',
              start: 1705319400, // seconds
              duration: 0.05, // 50ms in seconds
              error: 0,
            },
          },
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockTrace);

      const tool = registeredTools.get('datadog_get_trace');
      const result = (await tool?.handler({ traceId: 'abc123', includeSpanTree: true })) as {
        content: Array<{ text: string }>;
      };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.spanTree).toBeDefined();
      expect(parsed.spanTree).toHaveLength(1);
    });

    it('should handle non-existent trace', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('Trace not found'));

      const tool = registeredTools.get('datadog_get_trace');
      const result = (await tool?.handler({ traceId: 'nonexistent' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('datadog_get_trace_logs', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_get_trace_logs',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get logs for a trace ID', async () => {
      const mockResponse = {
        status: 'done',
        hitCount: 2,
        result: {
          events: [
            {
              event_id: 'log1',
              columns: ['info', '2024-01-15T11:00:00Z', 'host1', 'my-service', 'Processing request'],
              event: { span_id: 'span-1' },
            },
            {
              event_id: 'log2',
              columns: ['error', '2024-01-15T11:00:01Z', 'host1', 'my-service', 'Request failed'],
              event: {
                span_id: 'span-2',
                custom: {
                  error: { message: 'Timeout', stack: 'Error at...' },
                },
              },
            },
          ],
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_get_trace_logs');
      const result = (await tool?.handler({ traceId: 'trace-123' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/logs-analytics/list?type=logs',
          method: 'POST',
          body: expect.objectContaining({
            list: expect.objectContaining({
              search: { query: 'trace_id:trace-123' },
            }),
          }),
          env: undefined,
          toolId: 'datadog_get_trace_logs',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.traceId).toBe('trace-123');
      expect(parsed.logCount).toBe(2);
      expect(parsed.logs[1].error).toEqual({ message: 'Timeout', stack: 'Error at...' });
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('Search failed'));

      const tool = registeredTools.get('datadog_get_trace_logs');
      const result = (await tool?.handler({ traceId: 'trace-123' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('datadog_get_service_summary', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_get_service_summary',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get service summary with default time range', async () => {
      const mockSummary = {
        service: 'my-service',
        type: 'web',
        dependencies: ['database', 'cache', 'auth-service'],
        stats: {
          latency_p50: 25,
          latency_p95: 150,
          error_rate: 0.01,
          hits_per_second: 500,
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockSummary);

      const tool = registeredTools.get('datadog_get_service_summary');
      const result = (await tool?.handler({ service: 'my-service', env: 'production' })) as {
        content: Array<{ text: string }>;
      };

      const now = Math.floor(Date.now() / 1000);
      const from = now - 1 * 60 * 60;

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/service_dependencies/my-service',
          method: 'GET',
          params: {
            start: `${from}`,
            end: `${now}`,
            env: 'production',
          },
          env: undefined,
          toolId: 'datadog_get_service_summary',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.service).toBe('my-service');
      expect(parsed.dependencies).toHaveLength(3);
    });

    it('should get service summary with custom time range', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({});

      const tool = registeredTools.get('datadog_get_service_summary');
      await tool?.handler({ service: 'api-service', env: 'staging', timeRangeHours: 24 });

      const now = Math.floor(Date.now() / 1000);
      const from = now - 24 * 60 * 60;

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/service_dependencies/api-service',
          method: 'GET',
          params: {
            start: `${from}`,
            end: `${now}`,
            env: 'staging',
          },
          env: undefined,
          toolId: 'datadog_get_service_summary',
        },
        undefined,
      );
    });

    it('should handle non-existent service', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('Service not found'));

      const tool = registeredTools.get('datadog_get_service_summary');
      const result = (await tool?.handler({ service: 'nonexistent', env: 'prod' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('datadog_search_similar_traces', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_search_similar_traces',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should search for similar traces by service and error type', async () => {
      const mockResponse = {
        data: [
          {
            id: 'span-1',
            attributes: {
              trace_id: 'trace-123',
              timestamp: '2024-01-15T11:00:00Z',
              service: 'billing-service',
              resource_name: 'ProcessPayment',
              status: 'error',
              custom: {
                duration: 5000000000, // 5s in nanoseconds
                http: { status_code: '504' },
                error: { type: 'DEADLINE_EXCEEDED', message: 'Timeout' },
              },
            },
          },
        ],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_search_similar_traces');
      const result = (await tool?.handler({
        service: 'billing-service',
        errorType: 'DEADLINE_EXCEEDED',
        env: 'production',
      })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/spans/events/search',
          method: 'POST',
          body: expect.objectContaining({
            data: expect.objectContaining({
              attributes: expect.objectContaining({
                filter: expect.objectContaining({
                  query: expect.stringContaining('service:billing-service'),
                }),
              }),
            }),
          }),
          env: undefined,
          toolId: 'datadog_search_similar_traces',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.totalTraces).toBe(1);
      expect(parsed.traces[0].traceId).toBe('trace-123');
    });
  });

  describe('datadog_get_customer_traces', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_get_customer_traces',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should require either customerId or userId', async () => {
      const tool = registeredTools.get('datadog_get_customer_traces');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('customerId or userId must be provided');
    });

    it('should search for traces by customer ID', async () => {
      const mockResponse = {
        data: [
          {
            id: 'span-1',
            attributes: {
              trace_id: 'trace-456',
              timestamp: '2024-01-15T11:00:00Z',
              service: 'api-service',
              resource_name: 'GET /api/balance',
              status: 'ok',
              custom: {
                duration: 100000000,
              },
            },
          },
        ],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_get_customer_traces');
      const result = (await tool?.handler({
        customerId: 'cuacc_123',
        env: 'production',
      })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/spans/events/search',
          method: 'POST',
          body: expect.objectContaining({
            data: expect.objectContaining({
              attributes: expect.objectContaining({
                filter: expect.objectContaining({
                  query: expect.stringContaining('cuacc_123'),
                }),
              }),
            }),
          }),
          env: undefined,
          toolId: 'datadog_get_customer_traces',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.customerId).toBe('cuacc_123');
      expect(parsed.summary.totalTraces).toBe(1);
    });
  });

  describe('datadog_get_database_query_analysis', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_get_database_query_analysis',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should analyze database queries in a trace', async () => {
      const mockTrace = {
        trace: {
          root_id: 'span-1',
          spans: {
            'span-1': {
              span_id: 'span-1',
              service: 'api-service',
              name: 'http.request',
              type: 'web',
              start: 1705319400,
              duration: 0.5,
              error: 0,
              children_ids: ['span-2', 'span-3', 'span-4', 'span-5', 'span-6'],
            },
            'span-2': {
              span_id: 'span-2',
              parent_id: 'span-1',
              service: 'api-service',
              name: 'db.query',
              type: 'sql',
              resource: 'SELECT * FROM users WHERE id = ?',
              start: 1705319400.01,
              duration: 0.05,
              error: 0,
              meta: { 'db.system': 'postgresql' },
            },
            'span-3': {
              span_id: 'span-3',
              parent_id: 'span-1',
              service: 'api-service',
              name: 'db.query',
              type: 'sql',
              resource: 'SELECT * FROM users WHERE id = ?',
              start: 1705319400.06,
              duration: 0.05,
              error: 0,
              meta: { 'db.system': 'postgresql' },
            },
            'span-4': {
              span_id: 'span-4',
              parent_id: 'span-1',
              service: 'api-service',
              name: 'db.query',
              type: 'sql',
              resource: 'SELECT * FROM users WHERE id = ?',
              start: 1705319400.11,
              duration: 0.05,
              error: 0,
              meta: { 'db.system': 'postgresql' },
            },
            'span-5': {
              span_id: 'span-5',
              parent_id: 'span-1',
              service: 'api-service',
              name: 'db.query',
              type: 'sql',
              resource: 'SELECT * FROM users WHERE id = ?',
              start: 1705319400.16,
              duration: 0.05,
              error: 0,
              meta: { 'db.system': 'postgresql' },
            },
            'span-6': {
              span_id: 'span-6',
              parent_id: 'span-1',
              service: 'api-service',
              name: 'db.query',
              type: 'sql',
              resource: 'SELECT * FROM users WHERE id = ?',
              start: 1705319400.21,
              duration: 0.05,
              error: 0,
              meta: { 'db.system': 'postgresql' },
            },
          },
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockTrace);

      const tool = registeredTools.get('datadog_get_database_query_analysis');
      const result = (await tool?.handler({ traceId: 'trace-123', n1Threshold: 3 })) as {
        content: Array<{ text: string }>;
      };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.summary.totalDbQueries).toBe(5);
      expect(parsed.n1Patterns).toBeDefined();
      expect(parsed.n1Patterns.length).toBeGreaterThan(0);
      expect(parsed.n1Patterns[0].count).toBe(5);
    });

    it('should handle traces with no database queries', async () => {
      const mockTrace = {
        trace: {
          root_id: 'span-1',
          spans: {
            'span-1': {
              span_id: 'span-1',
              service: 'api-service',
              name: 'http.request',
              type: 'web',
              start: 1705319400,
              duration: 0.1,
              error: 0,
            },
          },
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockTrace);

      const tool = registeredTools.get('datadog_get_database_query_analysis');
      const result = (await tool?.handler({ traceId: 'trace-123' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toContain('No database queries');
    });
  });

  describe('datadog_compare_traces', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_compare_traces',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should compare two traces', async () => {
      const mockTrace1 = {
        trace: {
          root_id: 'span-1',
          spans: {
            'span-1': {
              span_id: 'span-1',
              service: 'api-service',
              name: 'http.request',
              type: 'web',
              start: 1705319400,
              end: 1705319401,
              duration: 1.0, // 1 second (slow)
              error: 1,
            },
          },
        },
      };

      const mockTrace2 = {
        trace: {
          root_id: 'span-1',
          spans: {
            'span-1': {
              span_id: 'span-1',
              service: 'api-service',
              name: 'http.request',
              type: 'web',
              start: 1705319400,
              end: 1705319400.1,
              duration: 0.1, // 100ms (fast)
              error: 0,
            },
          },
        },
      };

      mocked(relay.sendServiceRequest).mockResolvedValueOnce(mockTrace1).mockResolvedValueOnce(mockTrace2);

      const tool = registeredTools.get('datadog_compare_traces');
      const result = (await tool?.handler({
        traceId1: 'slow-trace',
        traceId2: 'fast-trace',
        label1: 'Slow',
        label2: 'Fast',
      })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.comparison.Slow.totalDurationMs).toBe(1000);
      expect(parsed.comparison.Fast.totalDurationMs).toBe(100);
      expect(parsed.differences.durationDiffMs).toBe(900); // Slow - Fast
      expect(parsed.differences.errorCountDiff).toBe(1); // Slow has error, Fast doesn't
    });

    it('should handle missing trace', async () => {
      mocked(relay.sendServiceRequest)
        .mockResolvedValueOnce({ trace: { root_id: 'span-1', spans: {} } })
        .mockResolvedValueOnce({ trace: null });

      const tool = registeredTools.get('datadog_compare_traces');
      const result = (await tool?.handler({
        traceId1: 'trace1',
        traceId2: 'trace2',
      })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('not found');
    });
  });

  describe('datadog_get_grpc_method_stats', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_get_grpc_method_stats',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get gRPC method statistics', async () => {
      const mockResponse = {
        data: [
          {
            attributes: {
              timestamp: '2024-01-15T11:00:00Z',
              resource_name: 'CalculateBalances',
              status: 'ok',
              custom: {
                duration: 50000000, // 50ms in nanoseconds
                rpc: {
                  method: 'CalculateBalances',
                  grpc: { status_code: 0 },
                },
              },
            },
          },
          {
            attributes: {
              timestamp: '2024-01-15T11:00:01Z',
              resource_name: 'CalculateBalances',
              status: 'ok',
              custom: {
                duration: 100000000, // 100ms
                rpc: {
                  method: 'CalculateBalances',
                  grpc: { status_code: 0 },
                },
              },
            },
          },
          {
            attributes: {
              timestamp: '2024-01-15T11:00:02Z',
              resource_name: 'CalculateBalances',
              status: 'error',
              custom: {
                duration: 60000000000, // 60s (timeout)
                rpc: {
                  method: 'CalculateBalances',
                  grpc: { status_code: 4 },
                },
              },
            },
          },
        ],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_get_grpc_method_stats');
      const result = (await tool?.handler({
        service: 'billing-service',
        method: 'CalculateBalances',
        env: 'production',
      })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/spans/events/search',
          method: 'POST',
          body: expect.objectContaining({
            data: expect.objectContaining({
              attributes: expect.objectContaining({
                filter: expect.objectContaining({
                  query: expect.stringContaining('service:billing-service'),
                }),
              }),
            }),
          }),
          env: undefined,
          toolId: 'datadog_get_grpc_method_stats',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.service).toBe('billing-service');
      expect(parsed.totalSamples).toBe(3);
      expect(parsed.methods.length).toBeGreaterThan(0);
      expect(parsed.methods[0].sampleCount).toBe(3);
      expect(parsed.methods[0].errorCount).toBe(1);
    });

    it('should handle no gRPC spans found', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ data: [] });

      const tool = registeredTools.get('datadog_get_grpc_method_stats');
      const result = (await tool?.handler({
        service: 'nonexistent-service',
        env: 'production',
      })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toContain('No gRPC spans found');
    });
  });
});
