import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { apiGet } from '../datadog-api.js';

export const getTrace = defineTool({
  name: 'get_trace',
  displayName: 'Get Trace',
  description:
    'Get a full trace by trace ID from Datadog APM. Accepts either hex or decimal trace IDs. Returns all spans within the trace, including orphaned spans.',
  summary: 'Get a full APM trace by ID',
  icon: 'activity',
  group: 'APM',
  input: z.object({
    trace_id: z
      .string()
      .describe('Trace ID — accepts 32 hex characters (e.g., "abcdef1234567890abcdef1234567890") or decimal digits'),
  }),
  output: z.object({
    trace: z.unknown().describe('Trace spans organized by service'),
    orphaned: z.unknown().describe('Orphaned spans not connected to the main trace tree'),
    is_truncated: z.boolean().describe('Whether the trace was truncated due to size'),
  }),
  handle: async params => {
    // The Datadog API expects decimal trace IDs
    let decimalId = params.trace_id;
    if (/^[0-9a-f]+$/i.test(decimalId) && decimalId.length >= 16 && /[a-f]/i.test(decimalId)) {
      // Hex format — convert to decimal
      const stripped = decimalId.replace(/^0+/, '') || '0';
      decimalId = BigInt(`0x${stripped}`).toString();
    }

    const data = await apiGet<{
      trace?: unknown;
      orphaned?: unknown;
      is_truncated?: boolean;
    }>(`/api/v1/trace/${decimalId}`);

    return {
      trace: data.trace ?? {},
      orphaned: data.orphaned ?? [],
      is_truncated: data.is_truncated ?? false,
    };
  },
});
