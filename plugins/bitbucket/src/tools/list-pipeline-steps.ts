import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawPipelineStep, pipelineStepSchema, mapPipelineStep } from './schemas.js';

export const listPipelineSteps = defineTool({
  name: 'list_pipeline_steps',
  displayName: 'List Pipeline Steps',
  description: 'List steps for a specific pipeline run. Supports pagination.',
  summary: 'List pipeline steps',
  icon: 'list',
  group: 'Pipelines',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    pipeline_uuid: z.string().describe('Pipeline UUID'),
    page: z.number().int().optional().describe('Page number for pagination (default 1)'),
    pagelen: z.number().int().optional().describe('Number of results per page (default 25, max 100)'),
  }),
  output: z.object({
    steps: z.array(pipelineStepSchema).describe('Array of pipeline steps'),
  }),
  handle: async params => {
    const query: Record<string, string | number | undefined> = {
      page: params.page,
      pagelen: params.pagelen,
    };
    const data = await api<{ values: RawPipelineStep[] }>(
      `/repositories/${params.workspace}/${params.repo_slug}/pipelines/${params.pipeline_uuid}/steps/`,
      { query },
    );
    return { steps: (data.values ?? []).map(mapPipelineStep) };
  },
});
