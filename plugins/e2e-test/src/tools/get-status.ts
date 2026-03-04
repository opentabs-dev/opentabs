import { testApi } from '../test-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const getStatus = defineTool({
  name: 'get_status',
  displayName: 'Get Status',
  description: "Get the current status of the test server — tests zero-input tools (similar to Slack's auth.test)",
  icon: 'wrench',
  group: 'Basic',
  input: z.object({}),
  output: z.object({
    ok: z.boolean().describe('Whether the server is reachable and responding'),
    authenticated: z.boolean().describe('Whether the current session is authenticated'),
    uptime: z.number().describe('Server uptime in seconds'),
    version: z.string().describe('Server version string'),
  }),
  handle: async () => {
    const data = await testApi<{ authenticated: boolean; uptime: number; version: string }>('/api/status', {});
    return {
      ok: data.ok,
      authenticated: data.authenticated,
      uptime: data.uptime,
      version: data.version,
    };
  },
});
