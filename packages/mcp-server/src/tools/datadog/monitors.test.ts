import { describe, it, expect, beforeEach, mock } from 'bun:test';
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
import { registerDatadogMonitorsTools } from './monitors.js';
import { relay } from '../../websocket-relay.js';

describe('Datadog Monitor Tools', () => {
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

    registerDatadogMonitorsTools(mockServer as unknown as McpServer);
  });

  describe('datadog_list_monitors', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'datadog_list_monitors',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should list monitors without filters', async () => {
      const mockMonitors = [
        { id: 123, name: 'Test Monitor', type: 'metric alert' },
        { id: 456, name: 'Another Monitor', type: 'service check' },
      ];
      mocked(relay.sendServiceRequest).mockResolvedValue(mockMonitors);

      const tool = registeredTools.get('datadog_list_monitors');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/monitor',
          method: 'GET',
          params: {},
          env: undefined,
          toolId: 'datadog_list_monitors',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(mockMonitors);
    });

    it('should list monitors with filters', async () => {
      const mockMonitors = [{ id: 123, name: 'Prod Monitor', type: 'metric alert' }];
      mocked(relay.sendServiceRequest).mockResolvedValue(mockMonitors);

      const tool = registeredTools.get('datadog_list_monitors');
      const result = (await tool?.handler({
        name: 'Prod',
        tags: 'env:production',
        monitorType: 'metric alert',
      })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/monitor',
          method: 'GET',
          params: {
            name: 'Prod',
            monitor_tags: 'env:production',
            type: 'metric alert',
          },
          env: undefined,
          toolId: 'datadog_list_monitors',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(mockMonitors);
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('API error'));

      const tool = registeredTools.get('datadog_list_monitors');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('datadog_get_monitor', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'datadog_get_monitor',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get monitor by ID', async () => {
      const mockMonitor = {
        id: 123,
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'avg:system.cpu.user{*} > 80',
        message: 'CPU is high',
        overall_state: 'OK',
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockMonitor);

      const tool = registeredTools.get('datadog_get_monitor');
      const result = (await tool?.handler({ monitorId: 123 })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/monitor/123',
          method: 'GET',
          env: undefined,
          toolId: 'datadog_get_monitor',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(mockMonitor);
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('Monitor not found'));

      const tool = registeredTools.get('datadog_get_monitor');
      const result = (await tool?.handler({ monitorId: 999 })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('datadog_search_monitors', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'datadog_search_monitors',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should search monitors with query', async () => {
      const mockSearchResult = {
        monitors: [{ id: 123, name: 'Alert Monitor' }],
        metadata: { total_count: 1 },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockSearchResult);

      const tool = registeredTools.get('datadog_search_monitors');
      const result = (await tool?.handler({ query: 'status:Alert' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/monitor/search',
          method: 'GET',
          params: {
            query: 'status:Alert',
            per_page: '50',
          },
          env: undefined,
          toolId: 'datadog_search_monitors',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(mockSearchResult);
    });

    it('should search monitors with custom limit', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ monitors: [] });

      const tool = registeredTools.get('datadog_search_monitors');
      await tool?.handler({ query: 'type:metric', limit: 100 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/monitor/search',
          method: 'GET',
          params: {
            query: 'type:metric',
            per_page: '100',
          },
          env: undefined,
          toolId: 'datadog_search_monitors',
        },
        undefined,
      );
    });
  });

  describe('datadog_get_monitor_status', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'datadog_get_monitor_status',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get monitor status with default group states', async () => {
      const mockStatus = [{ id: 123, overall_state: 'OK' }];
      mocked(relay.sendServiceRequest).mockResolvedValue(mockStatus);

      const tool = registeredTools.get('datadog_get_monitor_status');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/monitor',
          method: 'GET',
          params: {
            group_states: 'all',
          },
          env: undefined,
          toolId: 'datadog_get_monitor_status',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(mockStatus);
    });

    it('should get monitor status with filters', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue([]);

      const tool = registeredTools.get('datadog_get_monitor_status');
      await tool?.handler({ tags: 'env:prod', groupStates: 'alert,warn' });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/monitor',
          method: 'GET',
          params: {
            group_states: 'alert,warn',
            monitor_tags: 'env:prod',
          },
          env: undefined,
          toolId: 'datadog_get_monitor_status',
        },
        undefined,
      );
    });
  });
});
