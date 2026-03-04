import { defineTool, retry, fetchJSON, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const sdkRetry = defineTool({
  name: 'sdk_retry',
  displayName: 'SDK Retry',
  description: 'Tests sdk.retry — calls a flaky endpoint that fails the first 3 times, then succeeds',
  summary: 'Test SDK retry utility',
  icon: 'wrench',
  input: z.object({}),
  output: z.object({
    ok: z.boolean().describe('Whether the operation eventually succeeded'),
    data: z.string().describe('Data from the successful response'),
    attempts: z.number().describe('Number of attempts the server received'),
  }),
  handle: async () => {
    const result = await retry(
      () =>
        fetchJSON<{ ok: boolean; data: string; attempts: number }>('/api/flaky', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      { maxAttempts: 5, delay: 100 },
    );
    if (result === undefined) {
      throw ToolError.validation('fetchJSON returned no content (204) but a JSON body was expected');
    }
    return { ok: result.ok, data: result.data, attempts: result.attempts };
  },
});
