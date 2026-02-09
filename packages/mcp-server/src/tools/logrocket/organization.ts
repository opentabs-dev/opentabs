import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerLogrocketOrgTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // List organizations
  defineTool(
    tools,
    server,
    'logrocket_list_orgs',
    {
      description: `List all LogRocket organizations the current user has access to.

Returns organization details including slug, name, and plan information. Use the orgSlug from results with other LogRocket tools.`,
      inputSchema: {},
    },
    async () => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: '/orgs/',
        method: 'GET',
      });

      return success(result);
    },
  );

  // Get organization details
  defineTool(
    tools,
    server,
    'logrocket_get_org',
    {
      description: `Get detailed information about a LogRocket organization.

Returns:
- Organization name, slug, and creation date
- Plan tier and session limits
- List of applications (with slugs for use with other tools)
- Feature flags and billing status

Use this to get the orgSlug and appSlug values needed by all other LogRocket tools.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug (e.g., "brex")'),
      },
    },
    async ({ orgSlug }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // List applications
  defineTool(
    tools,
    server,
    'logrocket_list_apps',
    {
      description: `List all applications in a LogRocket organization.

Returns app details including slug, name, and configuration. Use the appSlug from results with other LogRocket tools.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
      },
    },
    async ({ orgSlug }) => {
      // The /orgs/{slug}/apps/ endpoint requires admin permissions.
      // Instead, fetch the org detail which includes an apps list.
      const result = (await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/`,
        method: 'GET',
      })) as { apps?: unknown[] };

      return success(result.apps ?? []);
    },
  );

  // Get application details
  defineTool(
    tools,
    server,
    'logrocket_get_app',
    {
      description: `Get detailed information about a specific LogRocket application.

Returns:
- Application name, slug, and platform (web/mobile)
- SDK configuration (recording settings, privacy options, network capture)
- Configured integrations (Datadog, Sentry, Slack, etc.)
- Session recording limits and retention settings

Use this to understand how an application is instrumented and what data LogRocket is capturing.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
      },
    },
    async ({ orgSlug, appSlug }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // List organization members
  defineTool(
    tools,
    server,
    'logrocket_list_members',
    {
      description: `List members of a LogRocket organization.

Returns for each member:
- Name, email, and profile picture
- Role (admin, member, viewer)
- Last login timestamp
- SSO identity slug

Supports search by name or email and pagination. Use this to find who has access to LogRocket or to look up a specific team member.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        search: z.string().optional().describe('Search by name or email'),
        limit: z.number().optional().default(50).describe('Max results (default: 50)'),
        offset: z.number().optional().default(0).describe('Offset for pagination'),
      },
    },
    async ({ orgSlug, search, limit, offset }) => {
      const params = new URLSearchParams();
      params.set('limit', String(limit ?? 50));
      params.set('offset', String(offset ?? 0));
      if (search) params.set('userSearch', search);

      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/members/?${params.toString()}`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // Get session usage histogram
  defineTool(
    tools,
    server,
    'logrocket_get_session_usage',
    {
      description: `Get session usage histogram for a LogRocket organization. Shows session volume over time by SDK type (web/mobile).

Essential for incident correlation:
- Did traffic drop or spike at a specific time?
- Are session counts normal compared to historical patterns?
- Is an outage affecting user reachability?

The histogram data helps correlate backend incidents with frontend impact.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        startDate: z
          .string()
          .optional()
          .describe('Start date in ISO 8601 format (defaults to beginning of current billing period)'),
        sdkType: z.enum(['web', 'mobile']).optional().describe('Filter by SDK type: "web" or "mobile"'),
      },
    },
    async ({ orgSlug, startDate, sdkType }) => {
      const params = new URLSearchParams();
      // start is required by the API — default to 30 days ago
      const start = startDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      params.set('start', start);
      if (sdkType) params.set('sdkType', sdkType);

      const queryString = params.toString();
      const endpoint = `/orgs/${orgSlug}/session_usage_histogram/${queryString ? `?${queryString}` : ''}`;

      const result = await sendServiceRequest('logrocket', {
        endpoint,
        method: 'GET',
      });

      return success(result);
    },
  );

  return tools;
};
