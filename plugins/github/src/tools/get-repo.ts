import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { pageJson } from '../github-api.js';
import { repositorySchema } from './schemas.js';

// Same-origin repo page payload
interface RepoPayload {
  codeViewRepoRoute?: {
    refInfo?: { name?: string };
    overview?: {
      commitCount?: number;
      overviewFiles?: Array<{ name?: string }>;
    };
    tree?: {
      items?: Array<{ name?: string; contentType?: string }>;
    };
  };
  // Additional metadata from the page
  repo?: {
    id?: number;
    name?: string;
    ownerLogin?: string;
    defaultBranch?: string;
    isPrivate?: boolean;
    description?: string;
    currentUserCanPush?: boolean;
    isFork?: boolean;
    isEmpty?: boolean;
    isArchived?: boolean;
    language?: string;
    stargazerCount?: number;
    forkCount?: number;
    openIssueCount?: number;
    updatedAt?: string;
    htmlUrl?: string;
  };
}

export const getRepo = defineTool({
  name: 'get_repo',
  displayName: 'Get Repository',
  description: 'Get detailed information about a specific repository.',
  summary: 'Get details of a specific repository',
  icon: 'book-open',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
  }),
  output: z.object({
    repository: repositorySchema.describe('Repository details'),
  }),
  handle: async params => {
    const data = await pageJson<RepoPayload>(`/${params.owner}/${params.repo}`);
    const route = data.codeViewRepoRoute;

    return {
      repository: {
        id: data.repo?.id ?? 0,
        name: params.repo,
        full_name: `${params.owner}/${params.repo}`,
        description: data.repo?.description ?? '',
        private: data.repo?.isPrivate ?? false,
        html_url: `https://github.com/${params.owner}/${params.repo}`,
        default_branch: route?.refInfo?.name ?? data.repo?.defaultBranch ?? '',
        language: data.repo?.language ?? '',
        stargazers_count: data.repo?.stargazerCount ?? 0,
        forks_count: data.repo?.forkCount ?? 0,
        open_issues_count: data.repo?.openIssueCount ?? 0,
        archived: data.repo?.isArchived ?? false,
        updated_at: data.repo?.updatedAt ?? '',
      },
    };
  },
});
