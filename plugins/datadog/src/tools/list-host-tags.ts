import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const listHostTags = defineTool({
  name: 'list_host_tags',
  displayName: 'List Host Tags',
  description: 'List all tags for a specific host, organized by source (e.g., datadog-agent, cloud provider).',
  summary: 'List tags for a host',
  icon: 'tag',
  group: 'Infrastructure',
  input: z.object({
    host_name: z.string().describe('Host name to get tags for'),
  }),
  output: z.object({
    tags: z.array(z.string()).describe('All tags for the host'),
  }),
  handle: async params => {
    const data = await apiGet<{ tags?: string[] }>(`/api/v1/tags/hosts/${params.host_name}`);
    return { tags: data.tags ?? [] };
  },
});
