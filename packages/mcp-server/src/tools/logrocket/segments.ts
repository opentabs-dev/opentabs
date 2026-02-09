import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerLogrocketSegmentTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List segments
  define(
    'logrocket_list_segments',
    {
      description: `List saved user segments in a LogRocket application. Segments are team-defined cohorts of users based on behavior, device, traits, or page visits.

Returns for each segment:
- Segment name, ID, and creator
- Filter criteria (device type, email domain, user traits, URL patterns)
- Compound filters (click targets, page time thresholds, custom events)

Examples of segments teams typically create: "Mobile users", "Non-Brex admins", "Users who clicked Redeem", "Dark mode fans". Use segment IDs with logrocket_get_segment for full filter details.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
      },
    },
    async ({ orgSlug, appSlug }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/segments/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // Get segment details
  define(
    'logrocket_get_segment',
    {
      description: `Get the full definition of a LogRocket segment, including all filter criteria.

Returns:
- Segment name, category, and creator
- Simple filters (device type, email patterns, user traits, session duration)
- Compound filters (click counts, time-on-page thresholds, visible element text, custom events with properties)

Use this to understand exactly what criteria define a user cohort, which helps when building session search filters or understanding team-defined user groups.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
        segmentId: z.string().describe('Segment ID'),
      },
    },
    async ({ orgSlug, appSlug, segmentId }) => {
      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/segments/${segmentId}/`,
        method: 'GET',
      });

      return success(result);
    },
  );

  // List definitions (custom events/metrics)
  define(
    'logrocket_list_definitions',
    {
      description: `List custom event and metric definitions in a LogRocket application. Definitions are named page or event patterns that LogRocket tracks — including page visits by URL, custom analytics events, and auto-detected error states.

Returns for each definition:
- Definition name, category (DEFINITION or error state), and description
- URL match filters (href patterns like "/p/accounting", "/invoices/create")
- Custom event filters (event name, property name/value matching)
- Visible element detectors (text patterns like "something went wrong", "oops")
- Creator and last-updated-by user info

Error state definitions (is_error_state: true) are auto-detected UI error patterns such as "Something Went Wrong text", "Please Try Again text", "Oops text". These are valuable for understanding what user-facing errors LogRocket monitors.`,
      inputSchema: {
        orgSlug: z.string().describe('Organization slug'),
        appSlug: z.string().describe('Application slug'),
        name: z.string().optional().describe('Filter by definition name'),
        page: z.number().optional().default(1).describe('Page number'),
        pageSize: z.number().optional().default(25).describe('Results per page'),
      },
    },
    async ({ orgSlug, appSlug, name, page, pageSize }) => {
      const params = new URLSearchParams();
      params.set('page', String(page ?? 1));
      params.set('pageSize', String(pageSize ?? 25));
      if (name) params.set('name', name);

      const result = await sendServiceRequest('logrocket', {
        endpoint: `/orgs/${orgSlug}/apps/${appSlug}/definitions/?${params.toString()}`,
        method: 'GET',
      });

      return success(result);
    },
  );

  return tools;
};
