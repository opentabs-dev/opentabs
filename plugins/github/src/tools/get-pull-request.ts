import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { pageEmbeddedData } from '../github-api.js';
import { type RawIssueOrPR, mapPullRequest, pullRequestSchema } from './schemas.js';

// Same-origin PR page embedded data shape
interface PRPageData {
  pullRequestsLayoutRoute?: {
    pullRequest?: {
      author?: { login?: string; displayName?: string };
      baseBranch?: string;
      headBranch?: string;
      commitsCount?: number;
      headRepositoryName?: string;
      headRepositoryOwnerLogin?: string;
      id?: number;
      mergedBy?: { login?: string } | null;
      mergedTime?: string | null;
      number?: number;
      state?: string;
      title?: string;
    };
    repository?: {
      name?: string;
      ownerLogin?: string;
      defaultBranch?: string;
    };
  };
  pullRequestsChangesRoute?: {
    diffSummaries?: Array<{
      path?: string;
      linesAdded?: number;
      linesDeleted?: number;
      linesChanged?: number;
      changeType?: string;
    }>;
  };
}

export const getPullRequest = defineTool({
  name: 'get_pull_request',
  displayName: 'Get Pull Request',
  description: 'Get detailed information about a specific pull request, including merge status and diff stats.',
  summary: 'Get details of a specific pull request',
  icon: 'git-pull-request',
  group: 'Pull Requests',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    pull_number: z.number().int().min(1).describe('Pull request number'),
  }),
  output: z.object({
    pull_request: pullRequestSchema.describe('Pull request details'),
  }),
  handle: async params => {
    // Fetch the PR page to get basic metadata from the layout route
    const pageData = await pageEmbeddedData<PRPageData>(`/${params.owner}/${params.repo}/pull/${params.pull_number}`);

    const prLayout = pageData.pullRequestsLayoutRoute?.pullRequest;

    // Also fetch the files page for diff stats
    let diffSummaries: PRPageData['pullRequestsChangesRoute'] | undefined;
    try {
      const filesData = await pageEmbeddedData<PRPageData>(
        `/${params.owner}/${params.repo}/pull/${params.pull_number}/files`,
      );
      diffSummaries = filesData.pullRequestsChangesRoute;
    } catch {
      // Files page may not be accessible; diff stats will be 0
    }

    const raw: RawIssueOrPR = {
      number: prLayout?.number ?? params.pull_number,
      title: prLayout?.title,
      author: prLayout?.author,
      baseBranch: prLayout?.baseBranch,
      headBranch: prLayout?.headBranch,
      commitsCount: prLayout?.commitsCount,
      mergedBy: prLayout?.mergedBy,
      mergedTime: prLayout?.mergedTime,
      // Map state from page format (OPEN, CLOSED, MERGED) to lowercase
      pullRequestState: prLayout?.state,
      closed: prLayout?.state === 'CLOSED' || prLayout?.state === 'MERGED',
      isDraft: false, // not available in layout route
      __typename: 'PullRequest',
      diffSummaries: diffSummaries?.diffSummaries,
    };

    return {
      pull_request: mapPullRequest(raw, { owner: params.owner, repo: params.repo }),
    };
  },
});
