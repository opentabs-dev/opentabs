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
import { registerDatadogSLOTools } from './slos.js';
import { relay } from '../../websocket-relay.js';

describe('Datadog SLO Tools', () => {
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

    registerDatadogSLOTools(mockServer as unknown as McpServer);
  });

  afterEach(() => {
    setSystemTime(); // Reset to real time
  });

  describe('datadog_list_slos', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_list_slos',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should list SLOs with default parameters', async () => {
      const mockResponse = {
        data: [
          {
            id: 'slo1',
            name: 'API Availability',
            type: 'metric',
            tags: ['service:api', 'env:production'],
            thresholds: [{ timeframe: '30d', target: 99.9 }],
            created_at: 1705276800,
          },
          {
            id: 'slo2',
            name: 'Latency SLO',
            type: 'metric',
            tags: ['service:api'],
            thresholds: [{ timeframe: '7d', target: 99.0 }],
            created_at: 1705190400,
          },
        ],
        metadata: {
          page: { total_count: 100, total_filtered_count: 2 },
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_list_slos');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/slo',
          method: 'GET',
          params: { limit: '100', offset: '0' },
          env: undefined,
          toolId: 'datadog_list_slos',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(2);
      expect(parsed.slos).toHaveLength(2);
      expect(parsed.slos[0].name).toBe('API Availability');
    });

    it('should filter SLOs by query and tags', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ data: [] });

      const tool = registeredTools.get('datadog_list_slos');
      await tool?.handler({ query: 'billing', tags: 'service:billing-lifecycle', limit: 50 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/slo',
          method: 'GET',
          params: { limit: '50', offset: '0', query: 'billing', tags: 'service:billing-lifecycle' },
          env: undefined,
          toolId: 'datadog_list_slos',
        },
        undefined,
      );
    });
  });

  describe('datadog_get_slo', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_get_slo',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get SLO by ID', async () => {
      const mockResponse = {
        data: {
          id: 'slo123',
          name: 'Test SLO',
          type: 'metric',
          thresholds: [{ timeframe: '30d', target: 99.9 }],
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_get_slo');
      const result = (await tool?.handler({ sloId: 'slo123' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/slo/slo123',
          method: 'GET',
          params: {},
          env: undefined,
          toolId: 'datadog_get_slo',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.id).toBe('slo123');
    });

    it('should request configured alert IDs when specified', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ data: {} });

      const tool = registeredTools.get('datadog_get_slo');
      await tool?.handler({ sloId: 'slo123', withConfiguredAlertIds: true });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/slo/slo123',
          method: 'GET',
          params: { with_configured_alert_ids: 'true' },
          env: undefined,
          toolId: 'datadog_get_slo',
        },
        undefined,
      );
    });
  });

  describe('datadog_get_slo_history', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_get_slo_history',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get SLO history with default time range', async () => {
      const mockResponse = {
        data: {
          overall: {
            sli_value: 99.95,
            error_budget_remaining: { value: 0.05, unit: 'percent' },
          },
          from_ts: 1705190400,
          to_ts: 1705276800,
          type: 'metric',
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_get_slo_history');
      const result = (await tool?.handler({ sloId: 'slo123' })) as { content: Array<{ text: string }> };

      const now = Math.floor(Date.now() / 1000);
      const from = now - 24 * 60 * 60;

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/slo/slo123/history',
          method: 'GET',
          params: { from_ts: `${from}`, to_ts: `${now}` },
          env: undefined,
          toolId: 'datadog_get_slo_history',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.overall.sliValue).toBe(99.95);
      expect(parsed.overall.errorBudgetRemaining.value).toBe(0.05);
    });

    it('should get SLO history with custom time range', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ data: {} });

      const tool = registeredTools.get('datadog_get_slo_history');
      await tool?.handler({ sloId: 'slo123', timeRangeHours: 168 }); // 1 week

      const now = Math.floor(Date.now() / 1000);
      const from = now - 168 * 60 * 60;

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/slo/slo123/history',
          method: 'GET',
          params: { from_ts: `${from}`, to_ts: `${now}` },
          env: undefined,
          toolId: 'datadog_get_slo_history',
        },
        undefined,
      );
    });
  });

  describe('datadog_search_slos', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_search_slos',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should search SLOs by query', async () => {
      const mockResponse = {
        data: [{ id: 'slo1', name: 'Billing SLO', type: 'metric', tags: ['service:billing'] }],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_search_slos');
      const result = (await tool?.handler({ query: 'billing' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/slo',
          method: 'GET',
          params: { query: 'billing', limit: '50' },
          env: undefined,
          toolId: 'datadog_search_slos',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
      expect(parsed.slos[0].name).toBe('Billing SLO');
    });
  });

  it('should handle errors', async () => {
    mocked(relay.sendServiceRequest).mockRejectedValue(new Error('API error'));

    const tool = registeredTools.get('datadog_list_slos');
    const result = (await tool?.handler({})) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
  });

  describe('datadog_get_error_budget_status', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_get_error_budget_status',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get error budget status for SLOs', async () => {
      // First call returns list of SLOs
      const mockListResponse = {
        data: [
          {
            id: 'slo1',
            name: 'API Availability',
            type: 'metric',
            tags: ['service:api'],
            thresholds: [{ timeframe: '30d', target: 99.9, warning: 99.8 }],
          },
          {
            id: 'slo2',
            name: 'Latency SLO',
            type: 'metric',
            tags: ['service:api'],
            thresholds: [{ timeframe: '30d', target: 99.0, warning: 98.5 }],
          },
        ],
      };

      // History responses for each SLO
      const mockHistoryResponse1 = {
        data: {
          overall: {
            sli_value: 99.95,
            error_budget_remaining: { value: 0.05, unit: 'percent' },
          },
        },
      };

      const mockHistoryResponse2 = {
        data: {
          overall: {
            sli_value: 98.0, // Below warning threshold
            error_budget_remaining: { value: -1.0, unit: 'percent' },
          },
        },
      };

      mocked(relay.sendServiceRequest)
        .mockResolvedValueOnce(mockListResponse)
        .mockResolvedValueOnce(mockHistoryResponse1)
        .mockResolvedValueOnce(mockHistoryResponse2);

      const tool = registeredTools.get('datadog_get_error_budget_status');
      const result = (await tool?.handler({ service: 'api' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.summary.total).toBe(2);
      expect(parsed.summary.critical).toBe(1); // slo2 is below warning
      expect(parsed.summary.healthy).toBe(1); // slo1 meets target
      expect(parsed.slos.length).toBe(2);
    });

    it('should return message when no SLOs found', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ data: [] });

      const tool = registeredTools.get('datadog_get_error_budget_status');
      const result = (await tool?.handler({ service: 'nonexistent' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toContain('No SLOs found');
    });

    it('should support different timeframes', async () => {
      const mockListResponse = {
        data: [
          {
            id: 'slo1',
            name: 'Test SLO',
            type: 'metric',
            thresholds: [{ timeframe: '7d', target: 99.9 }],
          },
        ],
      };

      const mockHistoryResponse = {
        data: {
          overall: {
            sli_value: 99.95,
            error_budget_remaining: { value: 0.05, unit: 'percent' },
          },
        },
      };

      mocked(relay.sendServiceRequest)
        .mockResolvedValueOnce(mockListResponse)
        .mockResolvedValueOnce(mockHistoryResponse);

      const tool = registeredTools.get('datadog_get_error_budget_status');
      const result = (await tool?.handler({ timeframe: '7d' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.timeframe).toBe('7d');
    });
  });
});
