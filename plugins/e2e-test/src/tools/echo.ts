import { testApi } from '../test-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const echo = defineTool({
  name: 'echo',
  displayName: 'Echo',
  description: 'Echo a message back — simplest possible tool for E2E testing',
  summary: 'Echo a message back',
  icon: 'wrench',
  group: 'Basic',
  input: z.object({
    message: z.string().describe('The message to echo back'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the request succeeded'),
    message: z.string().describe('The echoed message'),
  }),
  handle: async params => {
    const data = await testApi<{ message: string }>('/api/echo', { message: params.message });
    return { ok: data.ok, message: data.message };
  },
});
