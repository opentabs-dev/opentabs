import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { type RawWorkflowRun, mapWorkflowRun, workflowRunSchema } from './schemas.js';

export const getWorkflowRun = defineTool({
  name: 'get_workflow_run',
  displayName: 'Get Workflow Run',
  description:
    'Get detailed results for a specific workflow run, including status, timing, input/output sizes, and trigger type.',
  summary: 'Get workflow run details',
  icon: 'play-circle',
  group: 'Workflows',
  input: z.object({
    run_id: z.string().describe('Workflow run ID'),
  }),
  output: z.object({
    run: workflowRunSchema,
  }),
  handle: async params => {
    const data = await api<RawWorkflowRun>(`/api/workflowRun/${params.run_id}`);
    return { run: mapWorkflowRun(data ?? {}) };
  },
});
