import { definePreScript } from '@opentabs-dev/plugin-sdk/pre-script';

/**
 * POC pre-script — runs at document_start in MAIN world before any page script.
 *
 * Patches window.fetch so the FIRST call carrying an Authorization: Bearer
 * header to the mock auth endpoint is captured into the per-plugin namespace.
 * The adapter's echo_auth tool reads it back via getPreScriptValue('authToken').
 *
 * The mock server's inline <script> then overwrites window.fetch with a stub.
 * If this pre-script ran too late (as a normal document_idle adapter would),
 * that overwrite would prevent us from ever seeing the initial bearer call.
 */
definePreScript(({ set, log }) => {
  log.info('pre-script installed at document_start');
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url = input instanceof Request ? input.url : String(input);
      const headers: Headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const auth = headers.get('Authorization');
      if (auth?.startsWith('Bearer ') && url.includes('/api/v2.0/me')) {
        set('authToken', auth.slice(7));
        set('authUrl', url);
        set('capturedAt', Date.now());
        log.info('captured bearer token:', auth.slice(7));
      }
    } catch (e) {
      log.warn('interception failed:', e);
    }
    return originalFetch(input, init);
  };
});
