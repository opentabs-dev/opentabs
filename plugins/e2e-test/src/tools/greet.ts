import { testApi } from '../test-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const greet = defineTool({
  name: 'greet',
  displayName: 'Greet',
  description: 'Greet a person by name — tests input→output transformation via the server',
  icon: 'wrench',
  group: 'Basic',
  input: z.object({
    name: z.string().describe('The name of the person to greet'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the request succeeded'),
    greeting: z.string().describe('The computed greeting message'),
  }),
  handle: async params => {
    const data = await testApi<{ greeting: string }>('/api/greet', { name: params.name });
    return { ok: data.ok, greeting: data.greeting };
  },
});
