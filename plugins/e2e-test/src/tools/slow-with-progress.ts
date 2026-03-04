import { defineTool, sleep } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const slowWithProgress = defineTool({
  name: 'slow_with_progress',
  displayName: 'Slow With Progress',
  description:
    'Sleeps for a configurable duration and reports progress at regular intervals. Used for E2E testing of the progress notification pipeline.',
  summary: 'Sleep and report progress',
  icon: 'timer',
  input: z.object({
    durationMs: z.number().describe('Total duration of the operation in milliseconds'),
    steps: z.number().int().min(1).describe('Number of progress steps to report'),
  }),
  output: z.object({
    completed: z.boolean().describe('Whether the operation completed successfully'),
    stepsReported: z.number().int().describe('Number of progress steps that were reported'),
  }),
  handle: async (params, context) => {
    const intervalMs = params.durationMs / params.steps;

    for (let i = 0; i < params.steps; i++) {
      context?.reportProgress({
        progress: i + 1,
        total: params.steps,
        message: `Step ${String(i + 1)} of ${String(params.steps)}`,
      });
      await sleep(intervalMs);
    }

    return { completed: true, stepsReported: params.steps };
  },
});
