import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogMonitorsTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List monitors
  define(
    'datadog_list_monitors',
    {
      description: `List all monitors in the Datadog organization with optional filtering.

Returns for each monitor:
- Monitor ID, name, type (metric alert, log alert, service check, etc.)
- Current status (OK, Alert, Warn, No Data)
- Query definition and threshold values
- Tags and notification targets

Filter by name (partial match), tags, or monitor type. For structured search queries (e.g., "status:Alert"), use datadog_search_monitors instead.`,
      inputSchema: {
        name: z.string().optional().describe('Filter monitors by name (partial match)'),
        tags: z.string().optional().describe('Filter by tags (comma-separated, e.g., "env:production,team:platform")'),
        monitorType: z
          .string()
          .optional()
          .describe('Filter by type (e.g., "metric alert", "service check", "log alert")'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ name, tags, monitorType, env }) => {
      const params: Record<string, string> = {};
      if (name) params.name = name;
      if (tags) params.monitor_tags = tags;
      if (monitorType) params.type = monitorType;

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/monitor',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // Get monitor by ID
  define(
    'datadog_get_monitor',
    {
      description: `Get the full definition of a specific Datadog monitor by its ID.

Returns:
- Monitor name, type, and message (notification template)
- Query string (the metric/log query that triggers alerts)
- Thresholds (critical, warning, ok values)
- Options (evaluation delay, new group delay, renotify interval)
- Tags, notification list, and overall status
- Creator and modification timestamps

Use monitor IDs from datadog_list_monitors or datadog_search_monitors.`,
      inputSchema: {
        monitorId: z.number().describe('The monitor ID'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ monitorId, env }) => {
      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v1/monitor/${monitorId}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // Search monitors
  define(
    'datadog_search_monitors',
    {
      description: `Search monitors using a query string.

Example queries:
- "status:Alert" - Find monitors currently alerting
- "type:metric" - Find metric monitors
- "tag:env:production" - Find monitors tagged with env:production`,
      inputSchema: {
        query: z.string().describe('Search query for monitors'),
        limit: z.number().optional().default(50).describe('Maximum number of results (default: 50)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ query, limit, env }) => {
      const params = {
        query,
        per_page: `${limit ?? 50}`,
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/monitor/search',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  // Delete monitor
  define(
    'datadog_delete_monitor',
    {
      description: `Delete a monitor by its ID.

WARNING: This permanently deletes the monitor. Use with caution.

Before deleting, consider:
- Muting the monitor instead if it's temporarily noisy
- Checking if it's managed by infrastructure-as-code (may be recreated)
- Confirming with the monitor's owner/team`,
      inputSchema: {
        monitorId: z.number().describe('The monitor ID to delete'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ monitorId, env }) => {
      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v1/monitor/${monitorId}`,
        method: 'DELETE',
        env: env as ServiceEnv | undefined,
      });
      return success({
        deleted: true,
        monitorId,
        result,
      });
    },
  );

  // Mute monitor
  define(
    'datadog_mute_monitor',
    {
      description: `Mute a monitor to suppress alerts temporarily.

Muting is useful during:
- Planned maintenance windows
- Known issues being actively worked on
- Testing or debugging

The monitor will automatically unmute after the specified end time.`,
      inputSchema: {
        monitorId: z.number().describe('The monitor ID to mute'),
        endTimestamp: z
          .number()
          .optional()
          .describe('Unix timestamp (seconds) when mute should end. If not specified, mute is indefinite.'),
        scope: z
          .string()
          .optional()
          .describe('Scope to mute (e.g., "host:my-host"). If not specified, mutes all scopes.'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ monitorId, endTimestamp, scope, env }) => {
      const body: Record<string, unknown> = {};
      if (endTimestamp) body.end = endTimestamp;
      if (scope) body.scope = scope;

      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v1/monitor/${monitorId}/mute`,
        method: 'POST',
        body: Object.keys(body).length > 0 ? body : undefined,
        env: env as ServiceEnv | undefined,
      });
      return success({
        muted: true,
        monitorId,
        endTimestamp,
        scope,
        result,
      });
    },
  );

  // Unmute monitor
  define(
    'datadog_unmute_monitor',
    {
      description: `Unmute a previously muted monitor to resume alerting.

Use this when:
- Maintenance is complete
- A known issue has been resolved
- You need to restore alerting before the scheduled unmute time`,
      inputSchema: {
        monitorId: z.number().describe('The monitor ID to unmute'),
        scope: z
          .string()
          .optional()
          .describe('Scope to unmute (e.g., "host:my-host"). If not specified, unmutes all scopes.'),
        allScopes: z.boolean().optional().describe('Unmute all scopes (default: true if no scope specified)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ monitorId, scope, allScopes, env }) => {
      const params: Record<string, string> = {};
      if (scope) params.scope = scope;
      if (allScopes !== undefined) params.all_scopes = String(allScopes);

      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v1/monitor/${monitorId}/unmute`,
        method: 'POST',
        params,
        env: env as ServiceEnv | undefined,
      });
      return success({
        unmuted: true,
        monitorId,
        scope,
        allScopes,
        result,
      });
    },
  );

  // Get monitor status
  define(
    'datadog_get_monitor_status',
    {
      description: `Get the current status of monitors with group-level state breakdowns.

Returns each monitor with its overall status and per-group states (e.g., per-host, per-service breakdowns showing which specific groups are in Alert, Warn, No Data, or OK).

Filter by tags to scope to specific services or teams. Filter by group states (e.g., "alert,warn") to only see monitors with problems. Use this for a quick health overview — use datadog_get_monitor for the full definition of a specific monitor.`,
      inputSchema: {
        tags: z.string().optional().describe('Filter by tags (comma-separated)'),
        groupStates: z
          .string()
          .optional()
          .describe('Filter by states (comma-separated, e.g., "alert,warn,no data"). Use "all" for all states.'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ tags, groupStates, env }) => {
      const params: Record<string, string> = {
        group_states: groupStates || 'all',
      };
      if (tags) params.monitor_tags = tags;

      // Use the monitor endpoint with group_states parameter
      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v1/monitor',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });
      return success(result);
    },
  );

  return tools;
};
