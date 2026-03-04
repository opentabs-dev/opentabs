import { defineTool, sleep } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const indeterminateProgress = defineTool({
  name: 'indeterminate_progress',
  displayName: 'Indeterminate Progress',
  description:
    'Reports progress without total for indeterminate operations. Used for E2E testing of the indeterminate progress pipeline.',
  summary: 'Report indeterminate progress',
  icon: 'loader',
  input: z.object({}),
  output: z.object({
    ok: z.boolean().describe('Whether the operation completed successfully'),
  }),
  handle: async (_params, context) => {
    context?.reportProgress({ message: 'Step 1: Initializing...' });
    await sleep(100);
    context?.reportProgress({ message: 'Step 2: Processing...' });
    await sleep(100);
    context?.reportProgress({ message: 'Step 3: Finishing...' });
    return { ok: true };
  },
});
