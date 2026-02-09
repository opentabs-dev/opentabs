import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerLogrocketIntegrationTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // List integrations
  defineTool(
    tools,
    server,
    'logrocket_list_integrations',
    {
      description: `List all configured integrations for a LogRocket application.

Returns for each integration:
- Integration name (Linear, Datadog, Intercom, Slack, etc.)
- Connection status (has_error flag)
- Error code if misconfigured (e.g., "no_identified_users")

Use this to check which external services LogRocket sends data to, and whether any integrations are broken.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
      },
    },
    async ({ orgSlug, appSlug }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/integrations/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // List feedback surveys
  defineTool(
    tools,
    server,
    'logrocket_list_surveys',
    {
      description: `List feedback surveys configured in a LogRocket application. Surveys are in-app prompts that collect user sentiment and feedback during sessions.

Returns survey configurations including names, questions, targeting rules, and active status. Survey responses are correlated with session replays for context.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
      },
    },
    async ({ orgSlug, appSlug }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/feedback-surveys/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // List release recaps
  defineTool(
    tools,
    server,
    'logrocket_list_release_recaps',
    {
      description: `List release recaps for a LogRocket application. Release recaps are automated summaries generated after each deployment.

Returns for each recap:
- Release version and timestamp
- New errors introduced by the release
- Performance impact (page load time changes, network request latency)
- Session count and user impact metrics

Use this to correlate recent deployments with error spikes or performance regressions.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
      },
    },
    async ({ orgSlug, appSlug }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/release-recaps/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // List issue alert configs
  defineTool(
    tools,
    server,
    'logrocket_list_alerts',
    {
      description: `List alerting configurations for LogRocket issues. Alerts fire when error occurrence or session count exceeds a threshold within a time window.

Returns for each alert:
- Threshold (e.g., > 100 sessions in 30 minutes)
- Notification targets (email addresses, Slack channels)
- Associated chart or issue group
- Enabled/disabled status

Use this to understand what error conditions trigger notifications to the team.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
      },
    },
    async ({ orgSlug, appSlug }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/issues-alerting-configs/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  return tools;
};
