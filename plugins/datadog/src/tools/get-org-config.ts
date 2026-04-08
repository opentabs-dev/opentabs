import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const getOrgConfig = defineTool({
  name: 'get_org_config',
  displayName: 'Get Org Config',
  description: 'Get a specific organization configuration value by name.',
  summary: 'Get org configuration',
  icon: 'settings',
  group: 'Admin',
  input: z.object({
    config_name: z.string().describe('Configuration name to retrieve'),
  }),
  output: z.object({
    config: z.unknown().describe('Organization configuration data'),
  }),
  handle: async params => {
    const data = await apiGet<Record<string, unknown>>(`/api/v2/org_configs/${params.config_name}`);
    return { config: data.data ?? data };
  },
});
