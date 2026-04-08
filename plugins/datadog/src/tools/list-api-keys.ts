import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const listApiKeys = defineTool({
  name: 'list_api_keys',
  displayName: 'List API Keys',
  description: 'List API keys in the Datadog organization.',
  summary: 'List API keys',
  icon: 'key',
  group: 'Admin',
  input: z.object({}),
  output: z.object({
    api_keys: z.array(
      z.object({
        id: z.string().describe('API key ID'),
        name: z.string().describe('API key name'),
        created_at: z.string().describe('Creation timestamp'),
        last4: z.string().describe('Last 4 characters of the key'),
      }),
    ),
  }),
  handle: async () => {
    const data = await apiGet<{ data?: Array<Record<string, unknown>> }>('/api/v2/api_keys');
    const keys = (data.data ?? []).map(k => {
      const attrs = (k.attributes as Record<string, unknown>) ?? k;
      return {
        id: (k.id as string) ?? '',
        name: (attrs.name as string) ?? '',
        created_at: (attrs.created_at as string) ?? '',
        last4: (attrs.last4 as string) ?? '',
      };
    });
    return { api_keys: keys };
  },
});
