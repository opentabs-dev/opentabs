import { defineTool, ToolError, fetchFromPage } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface PageViewResponse {
  items?: Array<{
    article?: string;
    views?: number;
    timestamp?: string;
  }>;
}

export const getPageViews = defineTool({
  name: 'get_page_views',
  displayName: 'Get Page Views',
  description:
    'Get the daily page view counts for a Wikipedia article over a date range. Uses the Wikimedia REST API. Dates must be in YYYYMMDD format. Maximum range is 365 days.',
  summary: 'Get daily page view statistics',
  icon: 'bar-chart-3',
  group: 'Statistics',
  input: z.object({
    title: z.string().describe('Article title (e.g., "JavaScript")'),
    start: z.string().describe('Start date in YYYYMMDD format (e.g., "20260101")'),
    end: z.string().describe('End date in YYYYMMDD format (e.g., "20260131")'),
  }),
  output: z.object({
    article: z.string().describe('Canonical article title'),
    views: z.array(
      z.object({
        date: z.string().describe('Date (YYYYMMDD)'),
        count: z.number().int().describe('Number of page views'),
      }),
    ),
    total: z.number().int().describe('Total page views in the date range'),
  }),
  handle: async params => {
    const encodedTitle = encodeURIComponent(params.title.replace(/ /g, '_'));
    // The pageviews API is served from wikimedia.org, not the local wiki instance
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodedTitle}/daily/${params.start}/${params.end}`;

    let data: PageViewResponse | undefined;
    try {
      const response = await fetchFromPage(url, { credentials: 'omit' });
      data = (await response.json()) as PageViewResponse;
    } catch (e) {
      if (e instanceof ToolError) throw e;
      if (e instanceof SyntaxError) {
        throw ToolError.internal(`Failed to parse Wikimedia API response for "${params.title}"`);
      }
      throw ToolError.internal(`Failed to fetch page view data for "${params.title}"`);
    }

    const items = data?.items ?? [];
    const views = items.map(item => ({
      date: (item.timestamp ?? '').substring(0, 8),
      count: item.views ?? 0,
    }));
    const total = views.reduce((sum, v) => sum + v.count, 0);

    return {
      article: params.title,
      views,
      total,
    };
  },
});
