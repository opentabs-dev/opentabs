import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawPipeline, pipelineSchema, mapPipeline } from './schemas.js';

export const getPipeline = defineTool({
  name: 'get_pipeline',
  displayName: 'Get Pipeline',
  description: 'Get detailed information about a specific pipeline run.',
  summary: 'Get pipeline details',
  icon: 'play',
  group: 'Pipelines',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    pipeline_uuid: z.string().describe('Pipeline UUID'),
  }),
  output: pipelineSchema,
  handle: async params => {
    const data = await api<RawPipeline>(
      `/repositories/${params.workspace}/${params.repo_slug}/pipelines/${params.pipeline_uuid}`,
    );
    return mapPipeline(data);
  },
});
