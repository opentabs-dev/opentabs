import { success, error, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { ServiceEnv } from '../../utils.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

export const registerDatadogDowntimesTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List downtimes
  define(
    'datadog_list_downtimes',
    {
      description: `List scheduled downtimes in Datadog.

Downtimes are used to mute monitors during maintenance windows or known issues.
Returns information about active and scheduled downtimes including:
- Scope (what's being muted, e.g., service:my-service)
- Schedule (start/end times)
- Associated monitor
- Status (active, scheduled, canceled)

This is useful for:
- Understanding why a monitor isn't alerting
- Checking if maintenance is scheduled
- Finding stale/forgotten downtimes`,
      inputSchema: {
        currentOnly: z
          .boolean()
          .optional()
          .default(false)
          .describe('Only return currently active downtimes (default: false, returns all)'),
        limit: z
          .number()
          .optional()
          .default(50)
          .describe('Maximum number of downtimes to return (default: 50, max: 100)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ currentOnly, limit, env }) => {
      const params: Record<string, string> = {
        'page[size]': String(Math.min(limit ?? 50, 100)),
      };

      if (currentOnly) {
        params.current_only = 'true';
      }

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/downtime',
        method: 'GET',
        params,
        env: env as ServiceEnv | undefined,
      });

      // Parse and format the response
      const response = result as {
        data?: Array<{
          id?: string;
          type?: string;
          attributes?: {
            scope?: string;
            message?: string;
            status?: string;
            display_timezone?: string;
            created?: string;
            modified?: string;
            canceled?: string | null;
            monitor_identifier?: {
              monitor_id?: number;
              monitor_tags?: string[];
            };
            schedule?: {
              start?: string;
              end?: string | null;
              timezone?: string;
              recurrences?: Array<{
                type?: string;
                period?: number;
                rrule?: string;
              }>;
            };
            notify_end_states?: string[];
            notify_end_types?: string[];
            mute_first_recovery_notification?: boolean;
          };
        }>;
        meta?: {
          page?: {
            total_filtered_count?: number;
          };
        };
      };

      const downtimes = (response.data || []).map(downtime => ({
        id: downtime.id,
        scope: downtime.attributes?.scope,
        message: downtime.attributes?.message,
        status: downtime.attributes?.status,
        monitorId: downtime.attributes?.monitor_identifier?.monitor_id,
        monitorTags: downtime.attributes?.monitor_identifier?.monitor_tags,
        schedule: {
          start: downtime.attributes?.schedule?.start,
          end: downtime.attributes?.schedule?.end,
          timezone: downtime.attributes?.display_timezone,
          recurrences: downtime.attributes?.schedule?.recurrences,
        },
        created: downtime.attributes?.created,
        modified: downtime.attributes?.modified,
        canceled: downtime.attributes?.canceled,
        notifyEndStates: downtime.attributes?.notify_end_states,
      }));

      return success({
        totalCount: response.meta?.page?.total_filtered_count ?? downtimes.length,
        count: downtimes.length,
        downtimes,
      });
    },
  );

  // Get downtime by ID
  define(
    'datadog_get_downtime',
    {
      description: `Get detailed information about a specific downtime by ID.

Use datadog_list_downtimes first to find downtime IDs.`,
      inputSchema: {
        downtimeId: z.string().describe('The downtime ID (UUID format)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ downtimeId, env }) => {
      const result = await sendServiceRequest('datadog', {
        endpoint: `/api/v2/downtime/${downtimeId}`,
        method: 'GET',
        env: env as ServiceEnv | undefined,
      });

      // Parse the response
      const response = result as {
        data?: {
          id?: string;
          type?: string;
          attributes?: {
            scope?: string;
            message?: string;
            status?: string;
            display_timezone?: string;
            created?: string;
            modified?: string;
            canceled?: string | null;
            monitor_identifier?: {
              monitor_id?: number;
              monitor_tags?: string[];
            };
            schedule?: {
              start?: string;
              end?: string | null;
              timezone?: string;
              recurrences?: Array<{
                type?: string;
                period?: number;
                rrule?: string;
              }>;
            };
            notify_end_states?: string[];
            notify_end_types?: string[];
            mute_first_recovery_notification?: boolean;
          };
        };
      };

      const downtime = response.data;
      return success({
        id: downtime?.id,
        scope: downtime?.attributes?.scope,
        message: downtime?.attributes?.message,
        status: downtime?.attributes?.status,
        monitorId: downtime?.attributes?.monitor_identifier?.monitor_id,
        monitorTags: downtime?.attributes?.monitor_identifier?.monitor_tags,
        schedule: {
          start: downtime?.attributes?.schedule?.start,
          end: downtime?.attributes?.schedule?.end,
          timezone: downtime?.attributes?.display_timezone,
          recurrences: downtime?.attributes?.schedule?.recurrences,
        },
        created: downtime?.attributes?.created,
        modified: downtime?.attributes?.modified,
        canceled: downtime?.attributes?.canceled,
        notifyEndStates: downtime?.attributes?.notify_end_states,
        muteFirstRecovery: downtime?.attributes?.mute_first_recovery_notification,
      });
    },
  );

  // Create downtime
  define(
    'datadog_create_downtime',
    {
      description: `Create a new downtime to mute monitors during maintenance or known issues.

Downtimes can be scoped by:
- **Monitor tags**: Mute monitors with specific tags (e.g., "service:my-service")
- **Monitor ID**: Mute a specific monitor
- **Scope**: Filter which instances of a monitor to mute

Common use cases:
- Scheduled maintenance windows
- Known issues being worked on
- Deployment windows to prevent noise

Example: Create a 1-hour downtime for all monitors tagged with "service:my-service"`,
      inputSchema: {
        monitorTags: z
          .array(z.string())
          .optional()
          .describe('Monitor tags to mute (e.g., ["service:my-service", "env:production"])'),
        monitorId: z.number().optional().describe('Specific monitor ID to mute'),
        scope: z.string().optional().describe('Scope to mute (e.g., "host:my-host" or "*" for all)'),
        message: z.string().optional().describe('Message/reason for the downtime'),
        start: z
          .string()
          .optional()
          .describe('Start time in ISO 8601 format (default: now). Example: "2024-01-15T10:00:00Z"'),
        end: z
          .string()
          .optional()
          .describe('End time in ISO 8601 format (default: no end = indefinite). Example: "2024-01-15T12:00:00Z"'),
        timezone: z.string().optional().describe('Timezone for display (e.g., "America/Los_Angeles")'),
        muteFirstRecoveryNotification: z
          .boolean()
          .optional()
          .describe('Mute the first recovery notification after the downtime ends'),
        notifyEndStates: z
          .array(z.enum(['alert', 'warn', 'no data']))
          .optional()
          .describe('Monitor states that should trigger end-of-downtime notification'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({
      monitorTags,
      monitorId,
      scope,
      message,
      start,
      end,
      timezone,
      muteFirstRecoveryNotification,
      notifyEndStates,
      env,
    }) => {
      // Build monitor_identifier - must have either monitor_id or monitor_tags
      const monitorIdentifier: Record<string, unknown> = {};
      if (monitorId !== undefined) {
        monitorIdentifier.monitor_id = monitorId;
      } else if (monitorTags && monitorTags.length > 0) {
        monitorIdentifier.monitor_tags = monitorTags;
      } else {
        return error(new Error('Either monitorId or monitorTags must be provided'));
      }

      // Build schedule
      const schedule: Record<string, unknown> = {
        start: start || new Date().toISOString(),
      };
      if (end) {
        schedule.end = end;
      }

      // Build attributes
      const attributes: Record<string, unknown> = {
        monitor_identifier: monitorIdentifier,
        scope: scope || '*',
        schedule,
      };

      if (message) attributes.message = message;
      if (timezone) attributes.display_timezone = timezone;
      if (muteFirstRecoveryNotification !== undefined) {
        attributes.mute_first_recovery_notification = muteFirstRecoveryNotification;
      }
      if (notifyEndStates && notifyEndStates.length > 0) {
        attributes.notify_end_states = notifyEndStates;
      }

      const body = {
        data: {
          type: 'downtime',
          attributes,
        },
      };

      const result = await sendServiceRequest('datadog', {
        endpoint: '/api/v2/downtime',
        method: 'POST',
        body,
        env: env as ServiceEnv,
      });

      const response = result as {
        data?: {
          id?: string;
          attributes?: {
            scope?: string;
            message?: string;
            status?: string;
            schedule?: {
              start?: string;
              end?: string;
            };
          };
        };
      };

      return success({
        created: true,
        id: response.data?.id,
        scope: response.data?.attributes?.scope,
        message: response.data?.attributes?.message,
        status: response.data?.attributes?.status,
        schedule: response.data?.attributes?.schedule,
      });
    },
  );

  // Cancel downtime
  define(
    'datadog_cancel_downtime',
    {
      description: `Cancel/delete an existing downtime.

Use this to:
- End a downtime early
- Remove a scheduled downtime before it starts
- Clean up old or stale downtimes

Use datadog_list_downtimes to find downtime IDs.`,
      inputSchema: {
        downtimeId: z.string().describe('The downtime ID to cancel (UUID format)'),
        env: z
          .enum(['production', 'staging'])
          .optional()
          .describe('Datadog environment to query (default: production)'),
      },
    },
    async ({ downtimeId, env }) => {
      await sendServiceRequest('datadog', {
        endpoint: `/api/v2/downtime/${downtimeId}`,
        method: 'DELETE',
        env: env as ServiceEnv,
      });

      return success({
        canceled: true,
        downtimeId,
      });
    },
  );

  return tools;
};
