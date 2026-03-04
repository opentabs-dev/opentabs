import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiV1 } from '../confluence-api.js';
import { type RawSearchResult, mapSearchResult, searchResultSchema } from './schemas.js';

export const search = defineTool({
  name: 'search',
  displayName: 'Search',
  description:
    'Search Confluence content using CQL (Confluence Query Language). Examples: \'type=page AND text~"meeting"\', \'type=page AND space="SD" ORDER BY lastmodified DESC\', \'type=page AND title~"design"\'. See https://developer.atlassian.com/cloud/confluence/cql-fields/ for full CQL reference.',
  summary: 'Search content using CQL',
  icon: 'search',
  group: 'Search',
  input: z.object({
    cql: z.string().min(1).describe('CQL query string (e.g., \'type=page AND text~"meeting"\')'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum number of results to return (default 25, max 100)'),
    start: z.number().int().min(0).optional().describe('Start index for pagination (default 0)'),
  }),
  output: z.object({
    results: z.array(searchResultSchema).describe('Array of search results'),
    total_size: z.number().describe('Total number of matching results'),
    size: z.number().describe('Number of results returned in this response'),
  }),
  handle: async params => {
    const data = await apiV1<{
      results: RawSearchResult[];
      totalSize?: number;
      size?: number;
    }>('/search', {
      query: {
        cql: params.cql,
        limit: params.limit ?? 25,
        start: params.start ?? 0,
      },
    });

    return {
      results: (data.results ?? []).map(mapSearchResult),
      total_size: data.totalSize ?? 0,
      size: data.size ?? 0,
    };
  },
});
