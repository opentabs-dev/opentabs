import { defineTool, log } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const logLevels = defineTool({
  name: 'log_levels',
  displayName: 'Log Levels',
  description:
    'Emits one log entry at each level (debug, info, warning, error) for E2E testing of the plugin logging pipeline',
  summary: 'Emit one log at each level',
  icon: 'wrench',
  input: z.object({
    prefix: z.string().describe('A unique prefix to identify log messages from this invocation'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the log calls completed'),
    levels: z.array(z.string()).describe('The log levels that were emitted'),
  }),
  handle: async params => {
    log.debug(`${params.prefix} debug-message`, { level: 'debug' });
    log.info(`${params.prefix} info-message`, { level: 'info' });
    log.warn(`${params.prefix} warning-message`, { level: 'warning' });
    log.error(`${params.prefix} error-message`, { level: 'error' });

    return { ok: true, levels: ['debug', 'info', 'warning', 'error'] };
  },
});
