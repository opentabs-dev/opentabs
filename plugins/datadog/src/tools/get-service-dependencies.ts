import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const getServiceDependencies = defineTool({
  name: 'get_service_dependencies',
  displayName: 'Get Service Dependencies',
  description:
    'Get upstream and downstream service dependencies for an APM service. Returns services that call this service and services this service calls.',
  summary: 'Get service dependency map',
  icon: 'link',
  group: 'APM',
  input: z.object({
    service_name: z.string().describe('Service name to get dependencies for'),
    env: z.string().optional().describe('Environment (e.g., "production", "staging"). Defaults to "production".'),
  }),
  output: z.object({
    service_name: z.string().describe('Queried service name'),
    calls: z.array(z.string()).describe('Services this service calls (downstream)'),
    called_by: z.array(z.string()).describe('Services that call this service (upstream)'),
  }),
  handle: async params => {
    const data = await apiGet<{ name?: string; calls?: string[]; called_by?: string[] }>(
      `/api/v1/service_dependencies/${params.service_name}`,
      { env: params.env ?? 'production' },
    );
    return {
      service_name: data.name ?? params.service_name,
      calls: data.calls ?? [],
      called_by: data.called_by ?? [],
    };
  },
});
