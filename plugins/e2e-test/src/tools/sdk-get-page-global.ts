import { defineTool, getPageGlobal } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const sdkGetPageGlobal = defineTool({
  name: 'sdk_get_page_global',
  displayName: 'SDK Get Page Global',
  description: 'Tests sdk.getPageGlobal — reads a deep property from globalThis using dot-notation path',
  summary: 'Test SDK getPageGlobal',
  icon: 'wrench',
  input: z.object({
    path: z.string().describe('Dot-notation path to the global property (e.g., "__sdkTestGlobal.nested.value")'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the operation succeeded'),
    value: z.unknown().describe('The value found at the given path'),
    found: z.boolean().describe('Whether the value was found (not undefined)'),
  }),
  handle: async params => {
    const value = getPageGlobal(params.path);
    return { ok: true, value: value ?? null, found: value !== undefined };
  },
});
