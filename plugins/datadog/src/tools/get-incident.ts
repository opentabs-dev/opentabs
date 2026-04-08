import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { incidentSchema, mapIncident } from './schemas.js';

export const getIncident = defineTool({
  name: 'get_incident',
  displayName: 'Get Incident',
  description: 'Get detailed information about a specific incident by ID.',
  summary: 'Get an incident by ID',
  icon: 'alert-triangle',
  group: 'Incidents',
  input: z.object({
    incident_id: z.string().describe('Incident ID'),
  }),
  output: z.object({
    incident: incidentSchema,
  }),
  handle: async params => {
    const data = await apiGet<{ data?: Record<string, unknown> }>(`/api/v2/incidents/${params.incident_id}`);
    return { incident: mapIncident(data.data ?? {}) };
  },
});
