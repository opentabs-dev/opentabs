import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Infer the issue_id_type from the format of the issue ID.
 * - 40-char hex string → GROUP_HASH (network error fingerprint)
 * - Numeric string → SENTRY_GROUP_ID (Sentry error group)
 * - Anything else → ISSUE_GROUP (generic fallback)
 */
const inferIssueIdType = (issueId: string): string => {
  if (/^[0-9a-f]{40}$/i.test(issueId)) return 'GROUP_HASH';
  if (/^\d+$/.test(issueId)) return 'SENTRY_GROUP_ID';
  return 'ISSUE_GROUP';
};

export const registerLogrocketIssueTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // List issue groups
  defineTool(
    tools,
    server,
    'logrocket_list_issues',
    {
      description: `List LogRocket issue groups for an application. Issues are automatically grouped errors and exceptions detected across sessions.

Returns issue groups with:
- Issue title and type (JS error, network error, etc.)
- Occurrence count and affected user count
- First/last seen timestamps
- Status (open, resolved, ignored)

Use this to find recurring errors affecting users.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug (e.g., "brex")'),
        appSlug: z.string().describe('Application slug'),
        status: z.enum(['open', 'resolved', 'ignored']).optional().describe('Filter by issue status'),
        page: z.number().optional().default(1).describe('Page number (default: 1)'),
        pageSize: z.number().optional().default(25).describe('Results per page (default: 25, max: 100)'),
      },
    },
    async ({ orgSlug, appSlug, status, page, pageSize }) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (page) params.set('page', String(page));
      if (pageSize) params.set('pageSize', String(Math.min(pageSize ?? 25, 100)));

      const queryString = params.toString();
      const endpoint = `/orgs/${orgSlug}/apps/${appSlug}/issue-groups/${queryString ? `?${queryString}` : ''}`;

      const result = await sendServiceRequest('logrocket', {
        endpoint,
        method: 'GET',
      });

      return success(result);
    },
  );

  // Get issue group details
  defineTool(
    tools,
    server,
    'logrocket_get_issue',
    {
      description: `Get detailed information about a specific LogRocket issue group.

Returns:
- Full error message and stack trace
- Affected sessions and users count
- First/last occurrence timestamps
- Browser and OS breakdown
- Related sessions for replay`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
        issueGroupId: z.string().describe('Issue group ID'),
      },
    },
    async ({ orgSlug, appSlug, issueGroupId }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/issue-groups/${issueGroupId}/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // Get AI issue analysis
  defineTool(
    tools,
    server,
    'logrocket_get_issue_analysis',
    {
      description: `Get AI-powered analysis for a LogRocket issue. Uses LogRocket's Galileo AI to provide root cause analysis and suggested fixes.

Returns:
- AI-generated summary of the issue
- Likely root cause
- Suggested code fixes
- Related patterns`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
        issueId: z.string().describe('Issue ID to analyze'),
        issueType: z
          .enum(['EXCEPTION', 'NETWORK_ERROR', 'RAGE_CLICK', 'DEAD_CLICK', 'CUSTOM'])
          .optional()
          .default('EXCEPTION')
          .describe('Issue type (default: EXCEPTION)'),
      },
    },
    async ({ orgSlug, appSlug, issueId, issueType }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/issue-analyses/retrieve-by-issue-id/`,
        method: 'POST',
        body: {
          issue_id: issueId,
          issue_id_type: inferIssueIdType(issueId),
          issue_type: issueType ?? 'EXCEPTION',
        },
      });

      return success(result);
    },
  );

  // Batch retrieve AI analyses for multiple issues (parallel single-issue calls)
  defineTool(
    tools,
    server,
    'logrocket_batch_issue_analysis',
    {
      description: `Batch retrieve AI-powered analyses for multiple LogRocket issues at once. Fetches analyses in parallel for faster triage.

Use this during triage to quickly understand root causes across several related errors. Each result includes the AI-generated analysis or an error if not found.

Provide issue IDs from logrocket_list_issues results.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
        issueIds: z
          .preprocess(val => {
            if (typeof val === 'string') {
              try {
                return JSON.parse(val);
              } catch {
                return [val];
              }
            }
            return val;
          }, z.array(z.string()))
          .describe('Array of issue IDs to analyze'),
        issueType: z
          .enum(['EXCEPTION', 'NETWORK_ERROR', 'RAGE_CLICK', 'DEAD_CLICK', 'CUSTOM'])
          .optional()
          .default('EXCEPTION')
          .describe('Issue type for all issues in the batch (default: EXCEPTION)'),
      },
    },
    async ({ orgSlug, appSlug, issueIds, issueType }) => {
      const ids = issueIds as string[];
      const type = issueType ?? 'EXCEPTION';

      const results = await Promise.all(
        ids.map(async issueId => {
          try {
            const analysis = await sendServiceRequest('logrocket', {
              endpoint: `/orgs/${orgSlug}/apps/${appSlug}/issue-analyses/retrieve-by-issue-id/`,
              method: 'POST',
              body: {
                issue_id: issueId,
                issue_id_type: inferIssueIdType(issueId),
                issue_type: type,
              },
            });
            return { issueId, analysis };
          } catch (err) {
            return { issueId, error: String(err) };
          }
        }),
      );

      return success(results);
    },
  );

  // Get issue analysis by analysis ID (direct fetch)
  defineTool(
    tools,
    server,
    'logrocket_get_issue_analysis_by_id',
    {
      description: `Get a specific AI issue analysis by its analysis ID. Use this when you already have the analysis ID (e.g., from a Galileo chat's issue_analysis.id field).

This is a direct fetch — faster than retrieve-by-issue-id when you already know the analysis ID.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
        analysisId: z.string().describe('Issue analysis ID (UUID from Galileo chat issue_analysis.id)'),
      },
    },
    async ({ orgSlug, appSlug, analysisId }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/issue-analyses/${analysisId}/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // List issue filters
  defineTool(
    tools,
    server,
    'logrocket_list_issue_filters',
    {
      description: `List saved issue filters in a LogRocket application. Filters are reusable search criteria that team members have saved for common issue views.

Returns filter names and their saved criteria. Use this to discover pre-built issue views your team has created (e.g., "Critical production errors", "Network failures this week").`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
      },
    },
    async ({ orgSlug, appSlug }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/issue-filters/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  return tools;
};
