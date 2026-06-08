import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { folderSchema, mapFolder, mapWorkflow, type RawFolder, type RawWorkflow, workflowSchema } from './schemas.js';

export const listWorkflows = defineTool({
  name: 'list_workflows',
  displayName: 'List Workflows',
  description:
    'List all workflows and workflow folders in the Retool organization. Workflows are automated processes that can be triggered by events, schedules, or webhooks.',
  summary: 'List all workflows and workflow folders',
  icon: 'workflow',
  group: 'Workflows',
  input: z.object({}),
  output: z.object({
    workflows: z.array(workflowSchema).describe('List of workflows'),
    folders: z.array(folderSchema).describe('List of workflow folders'),
  }),
  handle: async () => {
    const data = await api<{
      workflowsMetadata: RawWorkflow[];
      workflowFolders: RawFolder[];
    }>('/api/workflow/');
    return {
      workflows: (data.workflowsMetadata ?? []).map(mapWorkflow),
      folders: (data.workflowFolders ?? []).map(mapFolder),
    };
  },
});
