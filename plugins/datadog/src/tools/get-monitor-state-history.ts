import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiUiPost } from '../datadog-api.js';

export const getMonitorStateHistory = defineTool({
  name: 'get_monitor_state_history',
  displayName: 'Get Monitor State History',
  description:
    'Preview the evaluation results of a monitor over a time range. Shows the timeseries data that the monitor evaluates against.',
  summary: 'Get monitor evaluation preview over time',
  icon: 'history',
  group: 'Monitors',
  input: z.object({
    monitor_id: z.number().int().describe('Monitor ID'),
    from: z.number().describe('Start time (epoch milliseconds)'),
    to: z.number().describe('End time (epoch milliseconds)'),
  }),
  output: z.object({
    data: z.unknown().describe('Evaluation preview data'),
  }),
  handle: async params => {
    const data = await apiUiPost<Record<string, unknown>>('/monitor/evaluation_preview', {
      id: params.monitor_id,
      from: params.from,
      to: params.to,
    });
    return { data };
  },
});
