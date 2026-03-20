import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const getWorkflowRunCount = defineTool({
  name: 'get_workflow_run_count',
  displayName: 'Get Workflow Run Count',
  description:
    'Get the total execution count for every workflow. Returns a map of workflow ID to run count. Useful for identifying active vs dormant workflows and monitoring workflow health.',
  summary: 'Get total run counts per workflow',
  icon: 'hash',
  group: 'Workflows',
  input: z.object({}),
  output: z.object({
    counts: z.record(z.string(), z.number()).describe('Map of workflow ID to total run count'),
  }),
  handle: async () => {
    const data = await api<{
      workflowRunsCountByWorkflow?: Record<string, { workflowId?: string; count?: string | number }>;
    }>('/api/workflowRun/getCountByWorkflow');
    const raw = data.workflowRunsCountByWorkflow ?? {};
    const counts: Record<string, number> = {};
    for (const [key, val] of Object.entries(raw)) {
      counts[key] = Number(val.count ?? 0);
    }
    return { counts };
  },
});
