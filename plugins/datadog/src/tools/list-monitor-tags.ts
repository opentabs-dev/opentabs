import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const listMonitorTags = defineTool({
  name: 'list_monitor_tags',
  displayName: 'List Monitor Tags',
  description: 'List all tags used across monitors. Useful for discovering available filter values.',
  summary: 'List tags used by monitors',
  icon: 'tag',
  group: 'Monitors',
  input: z.object({}),
  output: z.object({
    tags: z.array(z.string()).describe('Monitor tags'),
  }),
  handle: async () => {
    const data = await apiGet<{ tags?: string[] }>('/api/v1/monitor/tags');
    return { tags: data.tags ?? [] };
  },
});
