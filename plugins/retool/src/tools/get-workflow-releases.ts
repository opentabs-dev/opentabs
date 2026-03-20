import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { type RawWorkflowRelease, mapWorkflowRelease, workflowReleaseSchema } from './schemas.js';

export const getWorkflowReleases = defineTool({
  name: 'get_workflow_releases',
  displayName: 'Get Workflow Releases',
  description:
    'Get the release/deployment history for a workflow. Returns an array of releases with version, deployer, and timestamps.',
  summary: 'Get workflow release history',
  icon: 'rocket',
  group: 'Workflows',
  input: z.object({
    workflow_id: z.string().describe('Workflow ID'),
  }),
  output: z.object({
    releases: z.array(workflowReleaseSchema).describe('List of workflow releases'),
  }),
  handle: async params => {
    const data = await api<RawWorkflowRelease[]>(`/api/workflow/${params.workflow_id}/releases`);
    return { releases: (Array.isArray(data) ? data : []).map(mapWorkflowRelease) };
  },
});
