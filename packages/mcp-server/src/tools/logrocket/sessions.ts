import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Build GraphQL SessionFilter objects from user-provided filter params.
 *
 * LogRocket's GraphQL SessionFilter input uses typed fields each expecting
 * a TextFilter: { operator: IS|CONTAINS|..., strings: [...] }.
 */
const buildSessionFilters = (params: {
  userId?: string;
  email?: string;
  url?: string;
  query?: string;
  browser?: string;
  os?: string;
  country?: string;
  referrer?: string;
  errorMessage?: string;
  exceptionMessage?: string;
  customEvent?: string;
}): Record<string, unknown>[] => {
  const filters: Record<string, unknown>[] = [];
  if (params.userId) filters.push({ userID: { operator: 'IS', strings: [params.userId] } });
  if (params.email) filters.push({ email: { operator: 'IS', strings: [params.email] } });
  if (params.url) filters.push({ visitedURL: { operator: 'CONTAINS', strings: [params.url] } });
  if (params.query) filters.push({ query: { operator: 'CONTAINS', strings: [params.query] } });
  if (params.browser) filters.push({ browser: { operator: 'IS', strings: [params.browser] } });
  if (params.os) filters.push({ os: { operator: 'IS', strings: [params.os] } });
  if (params.country) filters.push({ country: { operator: 'IS', strings: [params.country] } });
  if (params.referrer) filters.push({ referrer: { operator: 'CONTAINS', strings: [params.referrer] } });
  if (params.errorMessage) filters.push({ errorMessage: { operator: 'CONTAINS', strings: [params.errorMessage] } });
  if (params.exceptionMessage)
    filters.push({ exceptionMessage: { operator: 'CONTAINS', strings: [params.exceptionMessage] } });
  if (params.customEvent) filters.push({ customEvent: { operator: 'IS', strings: [params.customEvent] } });
  return filters;
};

export const registerLogrocketSessionTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // Search sessions via GraphQL
  define(
    'logrocket_search_sessions',
    {
      description: `Search LogRocket sessions using filters. Returns session replay data including user info, pages visited, errors, and session URLs.

Use this to find sessions by:
- User email or ID
- URL/page visited
- Time range
- Error occurrence
- Custom user traits

Returns session IDs that can be used with logrocket_get_session_url to construct replay URLs.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug (e.g., "brex")'),
        appSlug: z.string().describe('Application slug (e.g., "brex-dashboard")'),
        query: z.string().optional().describe('Search query string to filter sessions'),
        userId: z.string().optional().describe('Filter by user ID'),
        email: z.string().optional().describe('Filter by user email'),
        url: z.string().optional().describe('Filter by URL/page visited'),
        browser: z.string().optional().describe('Filter by browser name (e.g., "Chrome", "Firefox", "Safari")'),
        os: z.string().optional().describe('Filter by OS (e.g., "Mac OS", "Windows", "Linux")'),
        country: z.string().optional().describe('Filter by country (e.g., "United States")'),
        referrer: z.string().optional().describe('Filter by referrer URL (contains match)'),
        errorMessage: z.string().optional().describe('Filter sessions containing this error message'),
        exceptionMessage: z.string().optional().describe('Filter sessions containing this exception message'),
        customEvent: z.string().optional().describe('Filter by custom event name'),
        startDate: z
          .string()
          .optional()
          .describe('Start date in ISO 8601 format — returns sessions before this date (e.g., "2026-02-01T00:00:00Z")'),
        limit: z.number().optional().default(25).describe('Maximum sessions to return (default: 25, max: 100)'),
      },
    },
    async ({
      orgSlug,
      appSlug,
      query: searchQuery,
      userId,
      email,
      url,
      browser,
      os,
      country,
      referrer,
      errorMessage,
      exceptionMessage,
      customEvent,
      startDate,
      limit,
    }) => {
      const filters = buildSessionFilters({
        userId,
        email,
        url,
        query: searchQuery,
        browser,
        os,
        country,
        referrer,
        errorMessage,
        exceptionMessage,
        customEvent,
      });
      const pageSize = Math.min(limit ?? 25, 100);

      // Build date filter as millisecond timestamp
      let dateTs: number | null = null;
      if (startDate) {
        const ts = new Date(startDate).getTime();
        if (!Number.isNaN(ts)) dateTs = ts;
      }

      const hasDate = dateTs !== null;
      const gqlQuery = `query SearchSessions($filters: [SessionFilter!]${hasDate ? ', $date: Float' : ''}) {
  app(id: "${orgSlug}/${appSlug}") {
    sessionInfo(filters: $filters, pageSize: ${pageSize}${hasDate ? ', date: $date' : ''}) {
      sessionCount
      sessions {
        id
        date
        duration
        eventCount
        replayType
        isInactive
        user { email userID name }
        browserInfo { name version }
        deviceInfo { deviceType }
        location { city region country }
      }
    }
  }
}`;

      const result = await sendServiceRequest(
        'logrocket',
        {
          query: gqlQuery,
          variables: { filters, ...(dateTs !== null ? { date: dateTs } : {}) },
        },
        'graphql',
      );

      // Enrich sessions with replay URLs
      const data = result as {
        app?: {
          sessionInfo?: { sessionCount: number; sessions: Array<Record<string, unknown>> };
        };
      };
      const sessions = data?.app?.sessionInfo?.sessions ?? [];
      const enriched = sessions.map(s => {
        const sessionId = s.id as string;
        // LogRocket replay URLs use /sessions/{sessionId} format
        const encodedId = encodeURIComponent(sessionId);
        return {
          ...s,
          replayUrl: `https://app.logrocket.com/${orgSlug}/${appSlug}/sessions/${encodedId}`,
        };
      });

      return success({
        sessionCount: data?.app?.sessionInfo?.sessionCount ?? 0,
        sessions: enriched,
      });
    },
  );

  // Get session replay URL
  define(
    'logrocket_get_session_url',
    {
      description: `Get the LogRocket session replay URL for a specific session.

Constructs the replay URL from session identifiers. Use this to provide a direct link to watch a session replay.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug (e.g., "brex")'),
        appSlug: z.string().describe('Application slug'),
        recordingId: z.string().describe('Recording ID from session data'),
        sessionId: z.string().describe('Session ID'),
      },
    },
    async ({ orgSlug, appSlug, recordingId, sessionId }) => {
      const replayUrl = `https://app.logrocket.com/${orgSlug}/${appSlug}/s/${recordingId}/${sessionId}`;
      return success({ replayUrl, recordingId, sessionId });
    },
  );

  return tools;
};
