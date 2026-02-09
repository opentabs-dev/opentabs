import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { mocked, clearAllMocks, trackMock } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Create mock function before module mock
const mockSendServiceRequest = trackMock(mock(() => {}));

// Mock the websocket relay - must be before imports
mock.module('../../websocket-relay', () => ({
  relay: {
    sendServiceRequest: mockSendServiceRequest,
  },
}));

// Import after mock.module
import { registerDatadogIncidentsTools } from './incidents.js';
import { relay } from '../../websocket-relay.js';

describe('Datadog Incidents Tools', () => {
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

    registerDatadogIncidentsTools(mockServer as unknown as McpServer);
  });

  describe('datadog_list_incident_services', () => {
    it('should register the tool', () => {
      expect(mockServer.registerTool).toHaveBeenCalledWith(
        'datadog_list_incident_services',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should list incident services with default parameters', async () => {
      const mockResponse = {
        data: [
          {
            id: 'service-1',
            type: 'incident_services',
            attributes: {
              name: 'Payment Service',
              created_at: '2024-01-01T00:00:00Z',
            },
          },
          {
            id: 'service-2',
            type: 'incident_services',
            attributes: {
              name: 'Auth Service',
              created_at: '2024-01-02T00:00:00Z',
            },
          },
        ],
        meta: {
          pagination: {
            total: 2,
          },
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_list_incident_services');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/incidents/config/services',
          method: 'GET',
          params: {
            'page[size]': '50',
          },
          env: undefined,
          toolId: 'datadog_list_incident_services',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toHaveLength(2);
      expect(parsed.data[0].attributes.name).toBe('Payment Service');
    });

    it('should list incident services with filter', async () => {
      const mockResponse = {
        data: [
          {
            id: 'service-1',
            type: 'incident_services',
            attributes: {
              name: 'API Gateway',
            },
          },
        ],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_list_incident_services');
      const result = (await tool?.handler({ filter: 'API' })) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/incidents/config/services',
          method: 'GET',
          params: {
            'page[size]': '50',
            'filter[name]': 'API',
          },
          env: undefined,
          toolId: 'datadog_list_incident_services',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toHaveLength(1);
    });

    it('should list incident services with custom page size', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ data: [] });

      const tool = registeredTools.get('datadog_list_incident_services');
      await tool?.handler({ pageSize: 100 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/incidents/config/services',
          method: 'GET',
          params: {
            'page[size]': '100',
          },
          env: undefined,
          toolId: 'datadog_list_incident_services',
        },
        undefined,
      );
    });

    it('should handle empty results', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ data: [] });

      const tool = registeredTools.get('datadog_list_incident_services');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toHaveLength(0);
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('API error'));

      const tool = registeredTools.get('datadog_list_incident_services');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });
});
