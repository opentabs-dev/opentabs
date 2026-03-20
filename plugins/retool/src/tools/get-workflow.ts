import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const getWorkflow = defineTool({
  name: 'get_workflow',
  displayName: 'Get Workflow',
  description:
    'Get the full definition of a Retool workflow including its blocks (steps), configuration, and trigger settings. Optionally specify a source control branch to view that version.',
  summary: 'Get workflow details by ID',
  icon: 'workflow',
  group: 'Workflows',
  input: z.object({
    workflow_id: z.string().describe('Workflow ID'),
    branch_name: z.string().optional().describe('Source control branch name (for versioned workflows)'),
  }),
  output: z.object({
    workflow: z.record(z.string(), z.unknown()).describe('Full workflow definition with blocks and configuration'),
  }),
  handle: async params => {
    const query: Record<string, string | undefined> = {};
    if (params.branch_name) query.branchName = params.branch_name;
    const data = await api<Record<string, unknown>>(`/api/workflow/${params.workflow_id}`, { query });
    return { workflow: data ?? {} };
  },
});
