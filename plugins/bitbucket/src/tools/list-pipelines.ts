import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawPipeline, pipelineSchema, mapPipeline } from './schemas.js';

export const listPipelines = defineTool({
  name: 'list_pipelines',
  displayName: 'List Pipelines',
  description: 'List CI/CD pipelines for a Bitbucket repository. Supports pagination and sorting.',
  summary: 'List repository pipelines',
  icon: 'play',
  group: 'Pipelines',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    page: z.number().int().optional().describe('Page number for pagination (default 1)'),
    pagelen: z.number().int().optional().describe('Number of results per page (default 25, max 100)'),
    sort: z.string().optional().describe('Sort field (e.g., "-created_on" for newest first)'),
  }),
  output: z.object({
    pipelines: z.array(pipelineSchema).describe('Array of pipelines'),
  }),
  handle: async params => {
    const query: Record<string, string | number | undefined> = {
      page: params.page,
      pagelen: params.pagelen,
      sort: params.sort,
    };
    const data = await api<{ values: RawPipeline[] }>(
      `/repositories/${params.workspace}/${params.repo_slug}/pipelines/`,
      { query },
    );
    return { pipelines: (data.values ?? []).map(mapPipeline) };
  },
});
