import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { serviceSchema, mapService } from './schemas.js';

export const listServices = defineTool({
  name: 'list_services',
  displayName: 'List Services',
  description:
    'List service definitions from the Datadog service catalog. Returns service names, owning teams, contacts, and links.',
  summary: 'List services from the service catalog',
  icon: 'layers',
  group: 'Services',
  input: z.object({
    page_size: z.number().int().min(1).max(100).optional().describe('Page size (default 25)'),
    page_number: z.number().int().min(0).optional().describe('Page number (default 0)'),
  }),
  output: z.object({
    services: z.array(serviceSchema),
  }),
  handle: async params => {
    const data = await apiGet<{ data?: Array<Record<string, unknown>> }>('/api/v2/services/definitions', {
      'page[size]': params.page_size ?? 25,
      'page[number]': params.page_number ?? 0,
    });
    return { services: (data.data ?? []).map(mapService) };
  },
});
