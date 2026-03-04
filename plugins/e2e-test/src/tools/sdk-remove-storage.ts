import {
  defineTool,
  getLocalStorage,
  getSessionStorage,
  removeLocalStorage,
  removeSessionStorage,
} from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const sdkRemoveStorage = defineTool({
  name: 'sdk_remove_storage',
  displayName: 'SDK Remove Storage',
  description: 'Tests storage removal — removes a key from localStorage or sessionStorage',
  summary: 'Test SDK storage removal',
  icon: 'trash',
  input: z.object({
    storageType: z.enum(['local', 'session']).describe('Which storage to remove from'),
    key: z.string().describe('The storage key to remove'),
  }),
  output: z.object({
    existed: z.boolean().describe('Whether the key existed before removal'),
    afterRemoval: z.boolean().describe('Whether the key still exists after removal (should be false)'),
  }),
  handle: async params => {
    const getter = params.storageType === 'local' ? getLocalStorage : getSessionStorage;
    const existed = getter(params.key) !== null;

    if (params.storageType === 'local') {
      removeLocalStorage(params.key);
    } else {
      removeSessionStorage(params.key);
    }

    const afterRemoval = getter(params.key) !== null;
    return { existed, afterRemoval };
  },
});
