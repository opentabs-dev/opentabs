import { definePreScript } from '@opentabs-dev/plugin-sdk/pre-script';

/**
 * Pre-script for the prescript-test plugin.
 *
 * Runs at document_start in MAIN world, strictly before any page script.
 * Wraps window.fetch to capture bearer tokens from outbound requests —
 * simulating the PR #69 scenario where the page overwrites window.fetch
 * immediately after its own bootstrap fetch, which would prevent a normal
 * adapter from ever seeing the token.
 *
 * The adapter reads the captured values later via getPreScriptValue().
 */
definePreScript(({ set, log }) => {
  const g = globalThis as Record<string, unknown>;
  const origFetch = g['fetch'] as typeof fetch;

  const patchedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Resolve the URL string for storage
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

    // Extract any Authorization: Bearer header from whichever HeadersInit shape was passed
    const headers = init?.headers;
    let bearer: string | undefined;

    if (headers instanceof Headers) {
      bearer = headers.get('Authorization') ?? headers.get('authorization') ?? undefined;
    } else if (Array.isArray(headers)) {
      for (const entry of headers as string[][]) {
        if (entry[0]?.toLowerCase() === 'authorization') {
          bearer = entry[1];
          break;
        }
      }
    } else if (headers && typeof headers === 'object') {
      const h = headers as Record<string, string>;
      bearer = h['Authorization'] ?? h['authorization'];
    }

    if (bearer?.startsWith('Bearer ')) {
      set('authToken', bearer.slice(7));
      set('authUrl', url);
      set('capturedAt', Date.now());
      log.debug(`[prescript-test] captured bearer for ${url}`);
    }

    return origFetch(input, init);
  };

  g['fetch'] = patchedFetch;
  log.info('[prescript-test] fetch interceptor installed');
});
