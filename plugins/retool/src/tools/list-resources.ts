import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { mapResource, type RawResource, resourceSchema } from './schemas.js';

export const listResources = defineTool({
  name: 'list_resources',
  displayName: 'List Resources',
  description:
    'List all configured resources (data sources) in the Retool organization. Resources include databases, APIs, AI providers, and other integrations.',
  summary: 'List all configured data resources',
  icon: 'database',
  group: 'Resources',
  input: z.object({}),
  output: z.object({
    resources: z.array(resourceSchema).describe('List of resources'),
  }),
  handle: async () => {
    const data = await api<{ resources: RawResource[] }>('/api/resources');
    return { resources: (data.resources ?? []).map(mapResource) };
  },
});
