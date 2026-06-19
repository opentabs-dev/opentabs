import { definePreScript } from '@opentabs-dev/plugin-sdk/pre-script';

/**
 * Pre-script for the PowerPoint plugin.
 *
 * Runs at document_start in MAIN world, strictly before any page script.
 *
 * On SharePoint/OneDrive-hosted presentations (`*.sharepoint.com/:p:/...`) the
 * page edits through the cross-origin WOPI canvas and MSAL stores its token
 * cache encrypted, so there is no plaintext Graph token in `localStorage`. The
 * page does mint per-resource access tokens on load by POSTing to the AAD token
 * endpoint (`login.microsoftonline.com/<tenant>/oauth2/v2.0/token`); each
 * response is plaintext JSON with `access_token`, `scope`, and `expires_in`.
 *
 * This wraps both `window.fetch` and `XMLHttpRequest`, captures the Graph-scoped
 * token from those token-endpoint responses, and stashes it for the adapter to
 * read via `getPreScriptValue`. It also captures a `Bearer` token from any
 * direct `graph.microsoft.com` request, covering the standalone
 * `powerpoint.cloud.microsoft` app. Capturing the minted token is
 * format-agnostic: it works regardless of how MSAL keys or encrypts its cache.
 */

interface CapturedGraphToken {
  token: string;
  /** Unix epoch seconds. */
  exp: number;
}

const GRAPH_HOSTNAME = 'graph.microsoft.com';
const TOKEN_ENDPOINT_HOSTNAME = 'login.microsoftonline.com';
/**
 * AAD token endpoint paths. Matches both:
 *   v2: `/<tenant>/oauth2/v2.0/token`  (MSAL.js 2.x default)
 *   v1: `/<tenant>/oauth2/token`       (MSAL.js 1.x / ADAL.js / legacy SP flows)
 */
const TOKEN_ENDPOINT_PATH = /\/oauth2\/(?:v2\.0\/)?token$/i;
/** Marker used to make the fetch patch idempotent under re-injection. */
const FETCH_PATCHED_MARKER = Symbol.for('opentabs.powerpoint.fetch.patched');
/** Marker used to make the XHR patch idempotent under re-injection. */
const XHR_PATCHED_MARKER = Symbol.for('opentabs.powerpoint.xhr.patched');

/**
 * localStorage key the captured token is mirrored to. MSAL only re-mints a
 * Graph token on a cold load or at refresh time, so warm reloads would
 * otherwise see nothing. Persisting here lets every same-origin tab reuse a
 * captured token for its lifetime. The adapter reads the same key.
 */
const LS_TOKEN_KEY = '__opentabs_powerpoint_graph_token';

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
  const g = globalThis as {
    fetch: typeof fetch & { [FETCH_PATCHED_MARKER]?: true };
    XMLHttpRequest: typeof XMLHttpRequest & { [XHR_PATCHED_MARKER]?: true };
  };

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
    log.debug(`[powerpoint] captured Graph token from AAD token endpoint`);
  };

  // --- fetch patch (primary path for MSAL.js auth-code flow + direct Graph) ---

  // Idempotency: a second injection into the same realm (hot reload, future
  // iframe-reuse) must not stack wrappers — that would recurse and double-stash.
  if (!g.fetch[FETCH_PATCHED_MARKER]) {
    const origFetch = g.fetch;
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

    (patchedFetch as typeof patchedFetch & { [FETCH_PATCHED_MARKER]: true })[FETCH_PATCHED_MARKER] = true;
    g.fetch = patchedFetch as typeof fetch & { [FETCH_PATCHED_MARKER]?: true };
  }

  // --- XMLHttpRequest patch ---
  //
  // SharePoint's WAC/Owl framework uses XHR for AAD silent-refresh calls on
  // some flows (MSAL.js exposes an XHR client for legacy compatibility, and
  // SP wraps it). Without this hook, refreshed tokens never reach our stash
  // and the LS mirror goes stale after the first hour.

  if (!g.XMLHttpRequest.prototype || !(g.XMLHttpRequest as unknown as { [k: symbol]: unknown })[XHR_PATCHED_MARKER]) {
    const Xhr = g.XMLHttpRequest;
    const origOpen = Xhr.prototype.open;
    const origSetRequestHeader = Xhr.prototype.setRequestHeader;

    // Per-instance state stashed under a Symbol so we don't collide with page code.
    const STATE = Symbol('opentabs.powerpoint.xhr.state');
    type XhrState = { url: string; bearer?: string };
    type XhrWithState = XMLHttpRequest & { [STATE]?: XhrState };

    // The XHR.open spec is variadic — `(method, url, async?, user?, password?)`.
    // The rest tuple here covers the optional tail of the longer overload so
    // we can forward every form without falling back to `arguments`.
    type XhrOpenRest = [async?: boolean, username?: string | null, password?: string | null];
    const patchedOpen = function patchedOpen(
      this: XhrWithState,
      method: string,
      url: string | URL,
      ...rest: XhrOpenRest
    ) {
      const urlStr = typeof url === 'string' ? url : url.href;
      this[STATE] = { url: urlStr };
      // `once` is essential: XHR instances are reusable, and we add a listener
      // on every `open()`. Without it, a reused instance would accumulate a
      // listener per request and re-run capture for every prior request on each
      // subsequent response. With it, each request gets exactly one fire.
      this.addEventListener(
        'load',
        () => {
          const state = this[STATE];
          if (!state) return;

          // Secondary path: outbound Graph request carrying a Bearer header.
          if (isGraphUrl(state.url) && state.bearer?.startsWith('Bearer ')) {
            stash(state.bearer.slice('Bearer '.length), Math.floor(Date.now() / 1000) + 600);
          }

          // Primary path: AAD token-endpoint response body.
          if (isTokenEndpointUrl(state.url)) {
            try {
              const text = this.responseText;
              if (text) captureFromTokenResponse(JSON.parse(text));
            } catch {
              /* non-JSON or restricted responseText — ignore */
            }
          }
        },
        { once: true },
      );
      // The two `open` overloads (with/without async/user/password) don't
      // unify when forwarding a rest tuple, so widen `origOpen` to a single
      // signature that accepts unknown trailing args.
      const forward = origOpen as (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) => void;
      return forward.call(this, method, urlStr, ...rest);
    };
    Xhr.prototype.open = patchedOpen as typeof Xhr.prototype.open;

    Xhr.prototype.setRequestHeader = function patchedSetRequestHeader(this: XhrWithState, name: string, value: string) {
      if (name.toLowerCase() === 'authorization' && this[STATE]) {
        this[STATE].bearer = value;
      }
      return origSetRequestHeader.call(this, name, value);
    };

    (g.XMLHttpRequest as unknown as { [k: symbol]: unknown })[XHR_PATCHED_MARKER] = true;
  }

  log.info('[powerpoint] Graph token interceptor installed (fetch + XHR)');
});
