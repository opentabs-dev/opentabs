import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { pageJson } from '../github-api.js';
import { type RawCommit, commitSchema, mapCommit } from './schemas.js';

// Same-origin commits page payload shape
interface CommitsPayload {
  commitGroups: Array<{
    commits: RawCommit[];
  }>;
}

export const listCommits = defineTool({
  name: 'list_commits',
  displayName: 'List Commits',
  description:
    'List commits for a repository. Optionally filter by branch or tag. Returns commits sorted by date descending.',
  summary: 'List commits for a repository',
  icon: 'git-commit',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    sha: z.string().optional().describe('Branch name or tag to list commits from (defaults to the default branch)'),
  }),
  output: z.object({
    commits: z.array(commitSchema).describe('List of commits'),
  }),
  handle: async params => {
    const ref = params.sha ?? 'HEAD';
    const data = await pageJson<CommitsPayload>(`/${params.owner}/${params.repo}/commits/${ref}`);

    // Commits are grouped by date; flatten all groups into a single list
    const commits = (data.commitGroups ?? []).flatMap(g => (g.commits ?? []).map(mapCommit));
    return { commits };
  },
});
