import { defineTool, getConfig } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const sdkGetConfig = defineTool({
  name: 'sdk_get_config',
  displayName: 'SDK Get Config',
  description: 'Tests sdk.getConfig — reads a plugin config value by key',
  summary: 'Test SDK getConfig',
  icon: 'wrench',
  input: z.object({
    key: z.string().describe('Config key to read'),
  }),
  output: z.object({
    key: z.string(),
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .nullable()
      .describe('The resolved config value, or null if not set'),
  }),
  handle: async params => {
    const value = getConfig(params.key);
    return { key: params.key, value: value ?? null };
  },
});
