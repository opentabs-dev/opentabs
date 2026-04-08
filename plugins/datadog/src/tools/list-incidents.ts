import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { incidentSchema, mapIncident } from './schemas.js';

export const listIncidents = defineTool({
  name: 'list_incidents',
  displayName: 'List Incidents',
  description:
    'List incidents in the Datadog organization. Supports filtering by status and pagination. Note: Incident Management must be enabled.',
  summary: 'List Datadog incidents',
  icon: 'alert-triangle',
  group: 'Incidents',
  input: z.object({
    page_size: z.number().int().min(1).max(100).optional().describe('Results per page (default 25)'),
    page_offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
  }),
  output: z.object({
    incidents: z.array(incidentSchema),
  }),
  handle: async params => {
    const data = await apiGet<{ data?: Array<Record<string, unknown>> }>('/api/v2/incidents', {
      'page[size]': params.page_size ?? 25,
      'page[offset]': params.page_offset ?? 0,
    });
    return { incidents: (data.data ?? []).map(mapIncident) };
  },
});
