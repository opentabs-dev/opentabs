import { defineTool, getPreScriptValue } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

/**
 * Returns whatever the pre-script captured in this plugin's bucket.
 * If the pre-script never ran (adapter injected into a tab that was open
 * before plugin registration), returns { token: null, source: 'none' }.
 */
export const echoAuth = defineTool({
  name: 'echo_auth',
  description: 'Return the bearer token captured by the pre-script at document_start',
  icon: 'key',
  input: z.object({}),
  output: z.object({
    token: z.string().nullable(),
    authUrl: z.string().nullable(),
    capturedAt: z.number().nullable(),
    source: z.enum(['pre-script', 'none']),
  }),
  async handle() {
    const token = getPreScriptValue<string>('authToken');
    const authUrl = getPreScriptValue<string>('authUrl');
    const capturedAt = getPreScriptValue<number>('capturedAt');
    return {
      token: token ?? null,
      authUrl: authUrl ?? null,
      capturedAt: capturedAt ?? null,
      source: token ? ('pre-script' as const) : ('none' as const),
    };
  },
});
