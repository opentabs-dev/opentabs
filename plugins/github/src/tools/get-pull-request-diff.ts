import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { pageEmbeddedData } from '../github-api.js';

interface DiffLine {
  type?: string;
  text?: string;
  html?: string;
}

interface DiffContent {
  diffLines?: DiffLine[];
}

interface PRFilesPageData {
  pullRequestsChangesRoute?: {
    diffSummaries?: Array<{ path?: string }>;
    diffContents?: Record<string, DiffContent>;
  };
}

export const getPullRequestDiff = defineTool({
  name: 'get_pull_request_diff',
  displayName: 'Get Pull Request Diff',
  description: 'Get the raw diff of a pull request. Returns the unified diff text for all changed files.',
  summary: 'Get the raw diff of a pull request',
  icon: 'file-diff',
  group: 'Pull Requests',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    pull_number: z.number().int().min(1).describe('Pull request number'),
  }),
  output: z.object({
    diff: z.string().describe('Raw unified diff text'),
  }),
  handle: async params => {
    const data = await pageEmbeddedData<PRFilesPageData>(
      `/${params.owner}/${params.repo}/pull/${params.pull_number}/files`,
    );

    const route = data.pullRequestsChangesRoute;
    const summaries = route?.diffSummaries ?? [];
    const contents = route?.diffContents ?? {};

    // Reconstruct unified diff from the structured diff data.
    // diffContents uses numeric string keys ("0", "1", ...) matching the order of diffSummaries.
    const diffParts: string[] = [];

    for (let i = 0; i < summaries.length; i++) {
      const path = summaries[i]?.path ?? '';
      const content = contents[String(i)];
      if (!content?.diffLines) continue;

      diffParts.push(`diff --git a/${path} b/${path}`);
      for (const line of content.diffLines) {
        diffParts.push(line.text ?? '');
      }
    }

    return { diff: diffParts.join('\n') };
  },
});
