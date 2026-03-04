import { defineTool, fetchJSON, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const sdkFetchJson = defineTool({
  name: 'sdk_fetch_json',
  displayName: 'SDK Fetch JSON',
  description: 'Tests sdk.fetchJSON — fetches JSON from the test server using the SDK utility',
  summary: 'Test SDK fetchJSON',
  icon: 'wrench',
  input: z.object({}),
  output: z.object({
    ok: z.boolean().describe('Whether the fetch succeeded'),
    data: z.string().describe('Data returned from the server'),
  }),
  handle: async () => {
    const result = await fetchJSON<{ ok: boolean; data: string }>('/api/sdk-fetch-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (result === undefined) {
      throw ToolError.validation('fetchJSON returned no content (204) but a JSON body was expected');
    }
    return { ok: result.ok, data: result.data };
  },
});
