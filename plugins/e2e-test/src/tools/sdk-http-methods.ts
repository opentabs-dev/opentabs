import { defineTool, putJSON, patchJSON, deleteJSON } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const sdkHttpMethods = defineTool({
  name: 'sdk_http_methods',
  displayName: 'SDK HTTP Methods',
  description: 'Tests putJSON, patchJSON, and deleteJSON SDK utilities against the test server',
  summary: 'Test SDK HTTP method utilities',
  icon: 'wrench',
  input: z.object({
    method: z.enum(['put', 'patch', 'delete']).describe('HTTP method to test'),
    data: z.record(z.string(), z.unknown()).optional().describe('JSON body to send (ignored for delete)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the request succeeded'),
    method: z.string().describe('The HTTP method that was used'),
  }),
  handle: async params => {
    const url = '/api/echo-method';
    switch (params.method) {
      case 'put':
        await putJSON(url, params.data ?? {});
        break;
      case 'patch':
        await patchJSON(url, params.data ?? {});
        break;
      case 'delete':
        await deleteJSON(url, undefined);
        break;
    }
    return { ok: true, method: params.method };
  },
});
