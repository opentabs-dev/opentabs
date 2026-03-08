import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../bitbucket-api.js';

interface RawSearchResult {
  file?: {
    path?: string;
    links?: { self?: { href?: string } };
  };
  content_matches?: Array<{ lines?: Array<{ line?: number; segments?: Array<{ text?: string }> }> }>;
}

interface RawSearchResponse {
  values?: RawSearchResult[];
}

const extractRepoSlug = (href: string): string => {
  // href format: https://api.bitbucket.org/2.0/repositories/{workspace}/{repo}/src/{hash}/{path}
  const parts = href.split('/repositories/')[1]?.split('/');
  return parts?.[1] ?? '';
};

export const searchCode = defineTool({
  name: 'search_code',
  displayName: 'Search Code',
  description:
    'Search for code across all repositories in a Bitbucket workspace. Returns matching file paths and content snippets.',
  summary: 'Search code in a workspace',
  icon: 'search',
  group: 'Source',
  input: z.object({
    workspace: z.string().describe('Workspace slug or UUID'),
    search_query: z.string().describe('Search query string'),
    page: z.number().int().optional().describe('Page number for pagination (default 1)'),
    pagelen: z.number().int().optional().describe('Number of results per page (default 25, max 100)'),
  }),
  output: z.object({
    results: z
      .array(
        z.object({
          file: z.string().describe('File path'),
          repo: z.string().describe('Repository slug'),
          content_matches: z
            .array(
              z.object({
                lines: z.string().describe('Matched lines'),
              }),
            )
            .describe('Content match segments'),
        }),
      )
      .describe('Search results'),
  }),
  handle: async params => {
    const query: Record<string, string | number | undefined> = {
      search_query: params.search_query,
      page: params.page,
      pagelen: params.pagelen,
    };
    const data = await api<RawSearchResponse>(`/workspaces/${params.workspace}/search/code`, { query });
    const results = (data.values ?? []).map(item => {
      const filePath = item.file?.path ?? '';
      const selfHref = item.file?.links?.self?.href ?? '';
      const repo = extractRepoSlug(selfHref);
      const contentMatches = (item.content_matches ?? []).map(match => {
        const lines = (match.lines ?? []).map(line => (line.segments ?? []).map(s => s.text ?? '').join('')).join('\n');
        return { lines };
      });
      return { file: filePath, repo, content_matches: contentMatches };
    });
    return { results };
  },
});
