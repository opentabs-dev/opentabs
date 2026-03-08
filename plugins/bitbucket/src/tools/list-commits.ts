import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';
import { type RawCommit, commitSchema, mapCommit } from './schemas.js';

export const listCommits = defineTool({
  name: 'list_commits',
  displayName: 'List Commits',
  description: 'List commits in a Bitbucket repository. Optionally filter by branch or tag name. Supports pagination.',
  summary: 'List repository commits',
  icon: 'git-commit',
  group: 'Commits',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    repo_slug: z.string().describe('Repository slug'),
    page: z.number().int().optional().describe('Page number for pagination (default 1)'),
    pagelen: z.number().int().optional().describe('Number of results per page (default 25, max 100)'),
    branch: z.string().optional().describe('Branch or tag name to filter commits by — pass as the include query param'),
  }),
  output: z.object({
    commits: z.array(commitSchema).describe('Array of commits'),
  }),
  handle: async params => {
    const query: Record<string, string | number | undefined> = {
      page: params.page,
      pagelen: params.pagelen,
      include: params.branch,
    };
    const data = await api<{ values: RawCommit[] }>(`/repositories/${params.workspace}/${params.repo_slug}/commits`, {
      query,
    });
    return { commits: (data.values ?? []).map(mapCommit) };
  },
});
