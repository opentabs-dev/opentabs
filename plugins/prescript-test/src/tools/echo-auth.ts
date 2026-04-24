import { defineTool, getPreScriptValue } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

/**
 * Returns the bearer token captured by the pre-script at document_start.
 *
 * The pre-script installs a fetch interceptor that captures Authorization: Bearer
 * headers from outbound requests before the page can overwrite window.fetch.
 * This tool reads the captured values back to verify end-to-end pre-script behavior.
 */
export const echoAuth = defineTool({
  name: 'echo_auth',
  displayName: 'Echo Auth',
  description: 'Returns the bearer token captured by the pre-script at document_start',
  summary: 'Return captured bearer token',
  icon: 'key',
  group: 'Pre-Script Test',
  input: z.object({}),
  output: z.object({
    token: z.string().nullable().describe('Bearer token captured by the pre-script, or null if not yet captured'),
    authUrl: z.string().nullable().describe('URL of the request that carried the bearer token'),
    capturedAt: z.number().nullable().describe('Timestamp (ms since epoch) when the token was captured'),
    source: z.string().describe("Source of the token: 'pre-script' when captured, 'none' when not available"),
  }),
  handle: async () => {
    const token = getPreScriptValue<string>('authToken') ?? null;
    const authUrl = getPreScriptValue<string>('authUrl') ?? null;
    const capturedAt = getPreScriptValue<number>('capturedAt') ?? null;
    const source = token !== null ? 'pre-script' : 'none';
    return { token, authUrl, capturedAt, source };
  },
});
