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
import { registerDatadogDashboardsTools } from './dashboards.js';
import { relay } from '../../websocket-relay.js';

describe('Datadog Dashboards Tools', () => {
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

    registerDatadogDashboardsTools(mockServer as unknown as McpServer);
  });

  describe('datadog_list_dashboards', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'datadog_list_dashboards',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should list dashboards without filters', async () => {
      const mockDashboards = {
        dashboards: [
          { id: 'abc-123', title: 'System Overview', description: 'Main system metrics' },
          { id: 'def-456', title: 'API Performance', description: 'API latency and errors' },
        ],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockDashboards);

      const tool = registeredTools.get('datadog_list_dashboards');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/dashboard',
          method: 'GET',
          params: {},
          env: undefined,
          toolId: 'datadog_list_dashboards',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.dashboards).toHaveLength(2);
      expect(parsed.dashboards[0].title).toBe('System Overview');
    });

    it('should list dashboards with shared filter', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ dashboards: [] });

      const tool = registeredTools.get('datadog_list_dashboards');
      await tool?.handler({ filterShared: true });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/dashboard',
          method: 'GET',
          params: {
            filter_shared: 'true',
          },
          env: undefined,
          toolId: 'datadog_list_dashboards',
        },
        undefined,
      );
    });

    it('should list dashboards with deleted filter', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ dashboards: [] });

      const tool = registeredTools.get('datadog_list_dashboards');
      await tool?.handler({ filterDeleted: true });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/dashboard',
          method: 'GET',
          params: {
            filter_deleted: 'true',
          },
          env: undefined,
          toolId: 'datadog_list_dashboards',
        },
        undefined,
      );
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('API error'));

      const tool = registeredTools.get('datadog_list_dashboards');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('datadog_get_dashboard', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'datadog_get_dashboard',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get dashboard by ID', async () => {
      const mockDashboard = {
        id: 'abc-123',
        title: 'System Overview',
        description: 'Main system metrics',
        widgets: [
          { id: 1, definition: { type: 'timeseries', title: 'CPU Usage' } },
          { id: 2, definition: { type: 'timeseries', title: 'Memory Usage' } },
        ],
        layout_type: 'ordered',
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockDashboard);

      const tool = registeredTools.get('datadog_get_dashboard');
      const result = (await tool?.handler({ dashboardId: 'abc-123' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/dashboard/abc-123',
          method: 'GET',
          env: undefined,
          toolId: 'datadog_get_dashboard',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.title).toBe('System Overview');
      expect(parsed.widgets).toHaveLength(2);
    });

    it('should handle non-existent dashboard', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('Dashboard not found'));

      const tool = registeredTools.get('datadog_get_dashboard');
      const result = (await tool?.handler({ dashboardId: 'nonexistent' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('datadog_search_dashboards', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'datadog_search_dashboards',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should search dashboards by title', async () => {
      const mockDashboards = {
        dashboards: [
          { id: 'abc-123', title: 'System Overview', description: 'Main system metrics' },
          { id: 'def-456', title: 'API Performance', description: 'API latency and errors' },
          { id: 'ghi-789', title: 'Database Metrics', description: 'Database performance' },
        ],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockDashboards);

      const tool = registeredTools.get('datadog_search_dashboards');
      const result = (await tool?.handler({ query: 'system' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v1/dashboard',
          method: 'GET',
          env: undefined,
          toolId: 'datadog_search_dashboards',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.dashboards).toHaveLength(1);
      expect(parsed.dashboards[0].title).toBe('System Overview');
    });

    it('should search dashboards by description', async () => {
      const mockDashboards = {
        dashboards: [
          { id: 'abc-123', title: 'Service Health', description: 'API latency and errors' },
          { id: 'def-456', title: 'API Dashboard', description: 'API performance metrics' },
        ],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockDashboards);

      const tool = registeredTools.get('datadog_search_dashboards');
      const result = (await tool?.handler({ query: 'latency' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.dashboards).toHaveLength(1);
      expect(parsed.dashboards[0].title).toBe('Service Health');
    });

    it('should handle case-insensitive search', async () => {
      const mockDashboards = {
        dashboards: [{ id: 'abc-123', title: 'CPU Dashboard', description: 'CPU metrics' }],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockDashboards);

      const tool = registeredTools.get('datadog_search_dashboards');
      const result = (await tool?.handler({ query: 'cpu' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.dashboards).toHaveLength(1);
    });

    it('should return empty array when no matches', async () => {
      const mockDashboards = {
        dashboards: [{ id: 'abc-123', title: 'System Overview', description: 'System metrics' }],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockDashboards);

      const tool = registeredTools.get('datadog_search_dashboards');
      const result = (await tool?.handler({ query: 'nonexistent' })) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.dashboards).toHaveLength(0);
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('API error'));

      const tool = registeredTools.get('datadog_search_dashboards');
      const result = (await tool?.handler({ query: 'test' })) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });
});
