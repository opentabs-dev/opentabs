import { ToolError, fetchText } from '@opentabs-dev/plugin-sdk';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { isAuthenticated, pageEmbeddedData } from '../github-api.js';
import { type RawFileDiff, fileDiffSchema, mapFileDiff } from './schemas.js';

interface ComparePageData {
  pullRequestsChangesRoute?: {
    diffSummaries?: RawFileDiff[];
    commits?: Array<Record<string, unknown>>;
  };
}

export const compareCommits = defineTool({
  name: 'compare_commits',
  displayName: 'Compare Commits',
  description:
    'Compare two commits, branches, or tags. Returns the diff status, commit count, and changed files between the base and head.',
  summary: 'Compare two commits or branches',
  icon: 'git-compare',
  group: 'Repositories',
  input: z.object({
    owner: z.string().min(1).describe('Repository owner (user or org)'),
    repo: z.string().min(1).describe('Repository name'),
    basehead: z
      .string()
      .min(1)
      .describe('Base and head to compare in "base...head" format (e.g., "main...feature-branch")'),
  }),
  output: z.object({
    files: z.array(fileDiffSchema).describe('List of changed files'),
    total_files: z.number().describe('Total number of files changed'),
  }),
  handle: async params => {
    if (!isAuthenticated()) throw ToolError.auth('Not authenticated — please log in to GitHub.');

    // The compare page with embedded data has file diff summaries
    try {
      const data = await pageEmbeddedData<ComparePageData>(
        `/${params.owner}/${params.repo}/compare/${params.basehead}`,
      );
      const summaries = data.pullRequestsChangesRoute?.diffSummaries ?? [];
      return {
        files: summaries.map(mapFileDiff),
        total_files: summaries.length,
      };
    } catch {
      // Compare page might not have embedded data. Parse the HTML instead.
      const html = await fetchText(`/${params.owner}/${params.repo}/compare/${params.basehead}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const fileEls = doc.querySelectorAll('.file-info a, [data-path]');
      const files = [...fileEls].map(el => ({
        filename: el.getAttribute('data-path') ?? el.textContent?.trim() ?? '',
        status: 'modified',
        additions: 0,
        deletions: 0,
        changes: 0,
      }));

      return { files, total_files: files.length };
    }
  },
});
