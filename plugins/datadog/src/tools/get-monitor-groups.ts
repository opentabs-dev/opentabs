import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const getMonitorGroups = defineTool({
  name: 'get_monitor_groups',
  displayName: 'Get Monitor Groups',
  description:
    'Get the status of individual groups for a multi-alert monitor. Useful for seeing which specific hosts, services, or tag combinations are alerting.',
  summary: 'Get group statuses for a multi-alert monitor',
  icon: 'grid',
  group: 'Monitors',
  input: z.object({
    monitor_id: z.number().int().describe('Monitor ID'),
  }),
  output: z.object({
    groups: z.record(
      z.string(),
      z.object({
        status: z.string().describe('Group status (OK, Alert, Warn, No Data)'),
        last_triggered_ts: z.number().nullable().describe('Last triggered timestamp'),
        last_nodata_ts: z.number().nullable().describe('Last no-data timestamp'),
      }),
    ),
  }),
  handle: async params => {
    const data = await apiGet<Record<string, unknown>>(`/api/v1/monitor/${params.monitor_id}`, {
      group_states: 'all',
    });
    const stateGroups = (data.state as Record<string, unknown>) ?? {};
    const groups: Record<string, { status: string; last_triggered_ts: number | null; last_nodata_ts: number | null }> =
      {};
    const rawGroups = (stateGroups.groups as Record<string, Record<string, unknown>>) ?? {};
    for (const [key, val] of Object.entries(rawGroups)) {
      groups[key] = {
        status: (val.status as string) ?? 'Unknown',
        last_triggered_ts: (val.last_triggered_ts as number) ?? null,
        last_nodata_ts: (val.last_nodata_ts as number) ?? null,
      };
    }
    return { groups };
  },
});
