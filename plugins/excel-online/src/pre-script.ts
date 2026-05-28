import { definePreScript } from '@opentabs-dev/plugin-sdk/pre-script';

/**
 * Pre-script for the Excel Online plugin.
 *
 * Runs at document_start in MAIN world, strictly before any page script.
 *
 * On SharePoint/OneDrive-hosted workbooks (`*.sharepoint.com/:x:/...`) the
 * page never calls the Microsoft Graph workbook API itself — it edits through
 * the cross-origin WOPI canvas — and MSAL stores its token cache encrypted, so
 * there is no plaintext Graph token to read from `localStorage`. What the page
 * does do on load is mint per-resource access tokens by POSTing to the AAD
 * token endpoint (`login.microsoftonline.com/<tenant>/oauth2/v2.0/token`) via
 * `fetch`. Each response is a plaintext JSON body containing `access_token`,
 * `scope`, and `expires_in`.
 *
 * This pre-script wraps `window.fetch` and inspects those token-endpoint
 * responses. When a response grants Microsoft Graph scopes, it stashes the
 * access token and its expiry for the adapter to read via `getPreScriptValue`.
 * Capturing the minted token is format-agnostic: it works regardless of how
 * MSAL keys or encrypts its cache.
 *
 * As a secondary path it also captures a `Bearer` token from any outbound
 * request to `graph.microsoft.com`, covering pages (e.g. the standalone
 * `excel.cloud.microsoft` app) that call Graph directly.
 */

interface CapturedGraphToken {
  token: string;
  /** Unix epoch seconds. */
  exp: number;
}

const GRAPH_HOSTNAME = 'graph.microsoft.com';
const TOKEN_ENDPOINT_HOSTNAME = 'login.microsoftonline.com';
const TOKEN_ENDPOINT_PATH = /\/oauth2\/v2\.0\/token$/i;
/** Marker used to make the fetch patch idempotent under re-injection. */
const PATCHED_MARKER = Symbol.for('opentabs.excel-online.fetch.patched');

/**
 * localStorage key the captured token is mirrored to. MSAL only re-mints a
 * Graph token on a cold load or at refresh time, so warm reloads would
 * otherwise see nothing. Persisting here lets every same-origin tab reuse a
 * captured token for its lifetime. The adapter reads the same key.
 */
const LS_TOKEN_KEY = '__opentabs_excel_graph_token';

const parseUrl = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

const isGraphUrl = (url: string): boolean => parseUrl(url)?.hostname.toLowerCase() === GRAPH_HOSTNAME;

const isTokenEndpointUrl = (url: string): boolean => {
  const u = parseUrl(url);
  return !!u && u.hostname.toLowerCase() === TOKEN_ENDPOINT_HOSTNAME && TOKEN_ENDPOINT_PATH.test(u.pathname);
};

definePreScript(({ set, log }) => {
  const g = globalThis as { fetch: typeof fetch & { [PATCHED_MARKER]?: true } };
  // Idempotency: a second injection into the same realm (hot reload, future
  // iframe-reuse) must not stack wrappers — that would recurse and double-stash.
  if (g.fetch[PATCHED_MARKER]) return;
  const origFetch = g.fetch;

  const stash = (token: string, exp: number): void => {
    if (!token || token.length < 16) return;
    set('graph', { token, exp } satisfies CapturedGraphToken);
    set('graphCapturedAt', Date.now());
    try {
      localStorage.setItem(LS_TOKEN_KEY, JSON.stringify({ token, exp } satisfies CapturedGraphToken));
    } catch {
      /* storage unavailable — the in-page namespace still works for this load */
    }
  };

  const extractBearer = (headers: HeadersInit | undefined): string | undefined => {
    if (headers instanceof Headers) {
      return headers.get('Authorization') ?? headers.get('authorization') ?? undefined;
    }
    if (Array.isArray(headers)) {
      for (const entry of headers as string[][]) {
        if (entry[0]?.toLowerCase() === 'authorization') return entry[1];
      }
      return undefined;
    }
    if (headers && typeof headers === 'object') {
      const h = headers as Record<string, string>;
      return h.Authorization ?? h.authorization;
    }
    return undefined;
  };

  /**
   * Whether the AAD `scope` claim grants Microsoft Graph. The claim is a
   * space-separated list of scope identifiers (some are URIs), e.g.
   * `https://graph.microsoft.com/Files.Read.All openid profile`. We split and
   * exact-match the hostname rather than substring-match the whole claim.
   */
  const scopeGrantsGraph = (scope: string): boolean =>
    scope.split(/\s+/).some(s => parseUrl(s)?.hostname.toLowerCase() === GRAPH_HOSTNAME);

  /** Parse an AAD token-endpoint JSON response and stash any Graph-scoped token. */
  const captureFromTokenResponse = (body: unknown): void => {
    if (!body || typeof body !== 'object') return;
    const data = body as { access_token?: string; scope?: string; expires_in?: number };
    if (typeof data.access_token !== 'string' || typeof data.scope !== 'string') return;
    if (!scopeGrantsGraph(data.scope)) return;
    const ttl = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
    const exp = Math.floor(Date.now() / 1000) + ttl;
    stash(data.access_token, exp);
    log.debug(`[excel-online] captured Graph token from AAD token endpoint`);
  };

  const patchedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

    // Secondary path: a Bearer header on a direct Graph request.
    if (isGraphUrl(url)) {
      const header =
        extractBearer(init?.headers) ?? (input instanceof Request ? extractBearer(input.headers) : undefined);
      if (header?.startsWith('Bearer ') && header.length > 'Bearer '.length) {
        // No expiry available from a request header; trust it for a short window.
        stash(header.slice('Bearer '.length), Math.floor(Date.now() / 1000) + 600);
      }
    }

    const response = await origFetch(input, init);

    // Primary path: parse the AAD token-endpoint response for a Graph token.
    if (isTokenEndpointUrl(url)) {
      response
        .clone()
        .json()
        .then(captureFromTokenResponse)
        .catch(() => {
          /* non-JSON or read failure — ignore */
        });
    }

    return response;
  };

  (patchedFetch as typeof patchedFetch & { [PATCHED_MARKER]: true })[PATCHED_MARKER] = true;
  g.fetch = patchedFetch as typeof fetch & { [PATCHED_MARKER]?: true };
  log.info('[excel-online] Graph token interceptor installed');
});
