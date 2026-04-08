import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';
import { serviceSchema, mapService } from './schemas.js';

export const getServiceDefinition = defineTool({
  name: 'get_service_definition',
  displayName: 'Get Service Definition',
  description:
    'Get the full service catalog definition for a specific service, including team, contacts, links, and tags.',
  summary: 'Get service definition by name',
  icon: 'layers',
  group: 'Services',
  input: z.object({
    service_name: z.string().describe('Service name (e.g., "web-store", "billing-api")'),
  }),
  output: z.object({
    service: serviceSchema,
  }),
  handle: async params => {
    const data = await apiGet<{ data?: Array<Record<string, unknown>> }>(
      `/api/v2/services/definitions/${params.service_name}`,
    );
    const items = data.data ?? [];
    return { service: mapService(items[0] ?? {}) };
  },
});
