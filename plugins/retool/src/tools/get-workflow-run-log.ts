import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

const logEntrySchema = z.object({
  message: z.string().describe('Log message'),
  timestamp: z.number().describe('Unix timestamp in milliseconds'),
});

interface RawLogEntry {
  message?: string;
  timestamp?: number | string;
}

export const getWorkflowRunLog = defineTool({
  name: 'get_workflow_run_log',
  displayName: 'Get Workflow Run Log',
  description:
    'Get execution logs for a workflow run. Each log entry captures a step in the workflow execution, useful for debugging failures and understanding execution flow.',
  summary: 'Get execution logs for a workflow run',
  icon: 'scroll-text',
  group: 'Workflows',
  input: z.object({
    run_id: z.string().describe('Workflow run ID'),
  }),
  output: z.object({
    status: z.string().describe('Overall run status'),
    logs: z.array(logEntrySchema).describe('Execution log entries'),
  }),
  handle: async params => {
    const data = await api<{ status?: string; logs?: RawLogEntry[] }>(`/api/workflowRun/getLog?runId=${params.run_id}`);
    return {
      status: data.status ?? '',
      logs: (data.logs ?? []).map((l: RawLogEntry) => ({
        message: l.message ?? '',
        timestamp: Number(l.timestamp ?? 0),
      })),
    };
  },
});
