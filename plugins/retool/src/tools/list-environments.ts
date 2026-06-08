import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { environmentSchema, mapEnvironment, type RawEnvironment } from './schemas.js';

export const listEnvironments = defineTool({
  name: 'list_environments',
  displayName: 'List Environments',
  description:
    'List all deployment environments in the Retool organization. Environments define separate configurations for resources (e.g., production, staging).',
  summary: 'List all deployment environments',
  icon: 'server',
  group: 'Environments',
  input: z.object({}),
  output: z.object({
    environments: z.array(environmentSchema).describe('List of environments'),
  }),
  handle: async () => {
    const data = await api<{ environments: RawEnvironment[] }>('/api/environments');
    return { environments: (data.environments ?? []).map(mapEnvironment) };
  },
});
