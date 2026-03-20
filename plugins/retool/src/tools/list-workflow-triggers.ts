import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { type RawWorkflowTrigger, mapWorkflowTrigger, workflowTriggerSchema } from './schemas.js';

export const listWorkflowTriggers = defineTool({
  name: 'list_workflow_triggers',
  displayName: 'List Workflow Triggers',
  description:
    'List all triggers configured for a Retool workflow. Returns both deployed (active) and latest saved (pending) triggers, including webhooks and schedules.',
  summary: 'List triggers for a workflow',
  icon: 'zap',
  group: 'Workflows',
  input: z.object({
    workflow_id: z.string().describe('Workflow ID'),
  }),
  output: z.object({
    deployed_triggers: z.array(workflowTriggerSchema).describe('Currently active triggers'),
    saved_triggers: z.array(workflowTriggerSchema).describe('Latest saved triggers (pending deployment)'),
  }),
  handle: async params => {
    const data = await api<{
      deployedTriggers?: RawWorkflowTrigger[];
      latestSavedTriggers?: RawWorkflowTrigger[];
    }>(`/api/workflowTrigger?workflowId=${params.workflow_id}`);
    return {
      deployed_triggers: (data.deployedTriggers ?? []).map(mapWorkflowTrigger),
      saved_triggers: (data.latestSavedTriggers ?? []).map(mapWorkflowTrigger),
    };
  },
});
