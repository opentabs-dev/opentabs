import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { vercelApi } from '../vercel-api.js';
import { envVarSchema, mapEnvVar } from './schemas.js';

export const listEnvVars = defineTool({
  name: 'list_env_vars',
  displayName: 'List Environment Variables',
  description:
    'List environment variables for a Vercel project. Shows variable names, targets (production/preview/development), and types. Values of encrypted/secret variables may be masked.',
  summary: 'List project environment variables',
  icon: 'key',
  group: 'Environment',
  input: z.object({
    project: z.string().describe('Project name or ID'),
    target: z.enum(['production', 'preview', 'development']).optional().describe('Filter by deployment target'),
    git_branch: z.string().optional().describe('Filter by Git branch name'),
  }),
  output: z.object({
    env_vars: z.array(envVarSchema).describe('List of environment variables'),
  }),
  handle: async params => {
    const data = await vercelApi<Record<string, unknown>>(`/v9/projects/${encodeURIComponent(params.project)}/env`, {
      query: {
        target: params.target,
        gitBranch: params.git_branch,
      },
    });
    const envs = Array.isArray(data.envs) ? (data.envs as Record<string, unknown>[]) : [];
    return { env_vars: envs.map(e => mapEnvVar(e)) };
  },
});
