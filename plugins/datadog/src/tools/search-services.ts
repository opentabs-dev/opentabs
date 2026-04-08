import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { serviceSchema, mapService } from './schemas.js';

export const searchServices = defineTool({
  name: 'search_services',
  displayName: 'Search Services',
  description: 'Search services in the service catalog by name, team, or other attributes.',
  summary: 'Search the service catalog',
  icon: 'search',
  group: 'Services',
  input: z.object({
    query: z.string().describe('Search query to filter services by name or attributes'),
    page_size: z.number().int().min(1).max(100).optional().describe('Results per page'),
  }),
  output: z.object({ services: z.array(serviceSchema) }),
  handle: async params => {
    const data = await apiGet<{ data?: Array<Record<string, unknown>> }>('/api/v2/services/definitions', {
      'page[size]': params.page_size ?? 25,
      'filter[query]': params.query,
    });
    return { services: (data.data ?? []).map(mapService) };
  },
});
