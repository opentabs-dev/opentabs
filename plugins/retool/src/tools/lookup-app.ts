import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const lookupApp = defineTool({
  name: 'lookup_app',
  displayName: 'Lookup App',
  description:
    'Look up a Retool application by its URL path (e.g., "fraud/fraud"). Returns the full app state including components, queries, and configuration. Use this when you know the app path but not its UUID.',
  summary: 'Look up app by URL path',
  icon: 'search',
  group: 'Apps',
  input: z.object({
    page_path: z.string().describe('Page path or name to look up (e.g., "my-folder/my-app")'),
  }),
  output: z.object({
    page: z.record(z.string(), z.unknown()).describe('Full app state with components and queries'),
  }),
  handle: async params => {
    const data = await api<Record<string, unknown>>('/api/pages/lookupPage', {
      method: 'POST',
      body: { pagePath: params.page_path },
    });
    return { page: data ?? {} };
  },
});
