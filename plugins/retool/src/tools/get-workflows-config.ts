import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const getWorkflowsConfig = defineTool({
  name: 'get_workflows_config',
  displayName: 'Get Workflows Config',
  description:
    'Get the global workflows runtime configuration. Returns Retool backend version, code executor version, Python support, Temporal client status, and other system-level settings.',
  summary: 'Get global workflow runtime configuration',
  icon: 'settings',
  group: 'Workflows',
  input: z.object({}),
  output: z.object({
    config: z.record(z.string(), z.unknown()).describe('Workflow runtime configuration'),
  }),
  handle: async () => {
    const data = await api<Record<string, unknown>>('/api/workflow/workflowsConfiguration');
    return { config: data ?? {} };
  },
});
