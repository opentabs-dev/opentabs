import { defineTool, setSessionStorage, getSessionStorage } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const sdkSetSessionStorage = defineTool({
  name: 'sdk_set_session_storage',
  displayName: 'SDK Set Session Storage',
  description: 'Tests setSessionStorage and getSessionStorage — writes a value then reads it back',
  summary: 'Test SDK session storage',
  icon: 'wrench',
  input: z.object({
    key: z.string().describe('The sessionStorage key to write'),
    value: z.string().describe('The value to store'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the operation succeeded'),
    readBack: z.string().nullable().describe('The value read back from sessionStorage'),
  }),
  handle: async params => {
    setSessionStorage(params.key, params.value);
    const readBack = getSessionStorage(params.key);
    return { ok: true, readBack };
  },
});
