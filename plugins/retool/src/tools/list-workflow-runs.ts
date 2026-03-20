import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { type RawWorkflowRun, mapWorkflowRun, workflowRunSchema } from './schemas.js';

export const listWorkflowRuns = defineTool({
  name: 'list_workflow_runs',
  displayName: 'List Workflow Runs',
  description:
    'List recent execution runs for a Retool workflow with pagination. Shows run status, timing, and data sizes.',
  summary: 'List workflow execution runs',
  icon: 'play',
  group: 'Workflows',
  input: z.object({
    workflow_id: z.string().describe('Workflow ID'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results per page (default 20)'),
    offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
  }),
  output: z.object({
    runs: z.array(workflowRunSchema).describe('List of workflow runs'),
    can_load_more: z.boolean().describe('Whether more results are available'),
  }),
  handle: async params => {
    const data = await api<{ rows: RawWorkflowRun[]; canLoadMore?: boolean }>(
      `/api/workflowRun/getRuns?workflowId=${params.workflow_id}&limit=${params.limit ?? 20}&offset=${params.offset ?? 0}`,
      { method: 'POST' },
    );
    return {
      runs: (data.rows ?? []).map(mapWorkflowRun),
      can_load_more: data.canLoadMore ?? false,
    };
  },
});
