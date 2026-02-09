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
import { registerDatadogServicesTools } from './services.js';
import { relay } from '../../websocket-relay.js';

describe('Datadog Services Tools', () => {
  const registeredTools: Map<string, { handler: (...args: unknown[]) => Promise<unknown> }> = new Map();

  beforeEach(() => {
    clearAllMocks();

    mockRegisterTool.mockImplementation(
      (name: string, _config: { description?: string; inputSchema?: unknown }, handler: () => Promise<unknown>) => {
        registeredTools.set(name, { handler });
      },
    );

    const mockServer = {
      registerTool: mockRegisterTool,
    };

    registerDatadogServicesTools(mockServer as unknown as McpServer);
  });

  afterEach(() => {
    setSystemTime(); // Reset to real time
  });

  describe('datadog_list_services', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_list_services',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should list services with default parameters', async () => {
      const mockResponse = {
        data: [
          {
            id: 'service1',
            attributes: {
              meta: {
                'github-html-url': 'https://github.com/example/service1',
                'last-modified-time': '2024-01-15T10:00:00Z',
              },
              schema: {
                'dd-service': 'billing-lifecycle-dgs',
                team: 'billing',
                description: 'Billing lifecycle service',
                contacts: [{ type: 'slack', contact: '#billing-oncall', name: 'Billing On-Call' }],
              },
            },
          },
        ],
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_list_services');
      const result = (await tool?.handler({})) as { content: Array<{ text: string }> };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/services/definitions',
          method: 'GET',
          params: { 'page[size]': '50' },
          env: undefined,
          toolId: 'datadog_list_services',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
      expect(parsed.services[0]).toMatchObject({
        id: 'service1',
        name: 'billing-lifecycle-dgs',
        team: 'billing',
        description: 'Billing lifecycle service',
      });
    });

    it('should filter services by query', async () => {
      mocked(relay.sendServiceRequest).mockResolvedValue({ data: [] });

      const tool = registeredTools.get('datadog_list_services');
      await tool?.handler({ query: 'billing', limit: 100 });

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/services/definitions',
          method: 'GET',
          params: { 'page[size]': '100', 'filter[query]': 'billing' },
          env: undefined,
          toolId: 'datadog_list_services',
        },
        undefined,
      );
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('API error'));

      const tool = registeredTools.get('datadog_list_services');
      const result = (await tool?.handler({})) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('datadog_get_service_definition', () => {
    it('should register the tool', () => {
      expect(mockRegisterTool).toHaveBeenCalledWith(
        'datadog_get_service_definition',
        expect.objectContaining({ description: expect.any(String) }),
        expect.any(Function),
      );
    });

    it('should get service definition with full details', async () => {
      const mockResponse = {
        data: {
          id: 'service1',
          attributes: {
            meta: {
              'github-html-url': 'https://github.com/example/service1',
              'last-modified-time': '2024-01-15T10:00:00Z',
            },
            schema: {
              'dd-service': 'billing-lifecycle-dgs',
              team: 'billing',
              description: 'Billing lifecycle service',
              application: 'billing-platform',
              tier: 'tier-1',
              lifecycle: 'production',
              contacts: [
                { type: 'slack', contact: '#billing-oncall', name: 'Billing On-Call' },
                { type: 'email', contact: 'billing@example.com', name: 'Billing Team' },
              ],
              links: [{ type: 'runbook', url: 'https://example.com/runbook', name: 'Runbook' }],
              repos: [{ name: 'billing-lifecycle', url: 'https://github.com/example/billing', provider: 'github' }],
              integrations: {
                pagerduty: { 'service-url': 'https://pagerduty.com/services/billing' },
                opsgenie: { 'service-url': 'https://opsgenie.com/services/billing', region: 'US' },
              },
              tags: ['billing', 'tier-1'],
            },
          },
        },
      };
      mocked(relay.sendServiceRequest).mockResolvedValue(mockResponse);

      const tool = registeredTools.get('datadog_get_service_definition');
      const result = (await tool?.handler({ serviceName: 'billing-lifecycle-dgs' })) as {
        content: Array<{ text: string }>;
      };

      expect(relay.sendServiceRequest).toHaveBeenCalledWith(
        'datadog',
        {
          endpoint: '/api/v2/services/definitions/billing-lifecycle-dgs',
          method: 'GET',
          env: undefined,
          toolId: 'datadog_get_service_definition',
        },
        undefined,
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toMatchObject({
        name: 'billing-lifecycle-dgs',
        team: 'billing',
        tier: 'tier-1',
        contacts: expect.arrayContaining([expect.objectContaining({ type: 'slack', contact: '#billing-oncall' })]),
        onCall: {
          pagerduty: 'https://pagerduty.com/services/billing',
          opsgenie: {
            serviceUrl: 'https://opsgenie.com/services/billing',
            region: 'US',
          },
        },
      });
    });

    it('should handle errors', async () => {
      mocked(relay.sendServiceRequest).mockRejectedValue(new Error('Service not found'));

      const tool = registeredTools.get('datadog_get_service_definition');
      const result = (await tool?.handler({ serviceName: 'nonexistent' })) as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });
});
