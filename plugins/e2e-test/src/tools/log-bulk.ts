import { defineTool, log } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const logBulk = defineTool({
  name: 'log_bulk',
  displayName: 'Log Bulk',
  description: 'Emits a configurable number of log entries for E2E testing of the log buffer overflow behavior',
  summary: 'Emit bulk log entries',
  icon: 'wrench',
  input: z.object({
    prefix: z.string().describe('A unique prefix to identify log messages from this invocation'),
    count: z.number().int().min(1).max(1200).describe('Number of log entries to emit'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the log calls completed'),
    emitted: z.number().describe('The number of log entries emitted'),
  }),
  handle: async params => {
    for (let i = 0; i < params.count; i++) {
      log.info(`${params.prefix} entry-${i}`, { index: i });
    }
    return { ok: true, emitted: params.count };
  },
});
