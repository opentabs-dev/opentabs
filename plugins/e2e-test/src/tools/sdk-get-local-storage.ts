import { defineTool, getLocalStorage } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const sdkGetLocalStorage = defineTool({
  name: 'sdk_get_local_storage',
  displayName: 'SDK Get Local Storage',
  description: 'Tests sdk.getLocalStorage — reads a value from localStorage using the SDK utility',
  summary: 'Test SDK getLocalStorage',
  icon: 'wrench',
  input: z.object({
    key: z.string().describe('The localStorage key to read'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the operation succeeded'),
    value: z.string().nullable().describe('The value read from localStorage'),
  }),
  handle: async params => {
    const value = getLocalStorage(params.key);
    return { ok: true, value };
  },
});
