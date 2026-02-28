/**
 * Authentication detection module for the site analyzer.
 *
 * Pure analysis function: takes captured network requests and page execution
 * results, returns structured auth analysis. Does not call browser tools
 * directly — the orchestrator (analyze-site/index.ts) collects data and
 * passes it here.
 */

// ---------------------------------------------------------------------------
// Input types — match the data shapes provided by the orchestrator
// ---------------------------------------------------------------------------

/** Captured network request (subset of CapturedRequest from browser-extension). */
interface NetworkRequest {
  url: string;
  method: string;
  status?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  mimeType?: string;
}

/** A cookie visible from the page context, with name and value. */
interface CookieEntry {
  name: string;
  value: string;
}

/** A key-value entry from localStorage or sessionStorage. */
interface StorageEntry {
  key: string;
  value: string;
}

/** A window global with its dot-notation path and runtime value. */
interface GlobalEntry {
  path: string;
  value: unknown;
}

/** A CSRF token found in the DOM via a meta tag or hidden input field. */
interface CsrfDomToken {
  source: 'meta' | 'hidden-input';
  name: string;
  value: string;
}

/** Data collected by the orchestrator and passed to detectAuth. */
interface AuthDetectionInput {
  cookies: CookieEntry[];
  localStorageEntries: StorageEntry[];
  sessionStorageEntries: StorageEntry[];
  networkRequests: NetworkRequest[];
  csrfDomTokens: CsrfDomToken[];
  windowGlobals: GlobalEntry[];
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** Discriminator for the kind of authentication mechanism detected on a page. */
type AuthMethodType =
  | 'cookie-session'
  | 'jwt-localstorage'
  | 'jwt-sessionstorage'
  | 'bearer-header'
  | 'api-key-header'
  | 'csrf-token'
  | 'basic-auth'
  | 'custom-auth-header'
  | 'auth-global';

/** A single detected authentication method with a description and extraction hint for plugin authors. */
interface AuthMethod {
  type: AuthMethodType;
  details: string;
  extractionHint: string;
}

/** Result of authentication detection: whether the page is authenticated and which methods were found. */
interface AuthAnalysis {
  authenticated: boolean;
  methods: AuthMethod[];
}

// ---------------------------------------------------------------------------
// Known session cookie patterns
// ---------------------------------------------------------------------------

const SESSION_COOKIE_PATTERNS = [
  /^d$/,
  /^_session_id$/i,
  /^connect\.sid$/i,
  /^JSESSIONID$/,
  /^__Secure-/,
  /^__Host-/,
  /^sid$/i,
  /^session$/i,
  /^token$/i,
  /^s$/,
  /^sess$/i,
  /^sessionid$/i,
  /^session[_-]?token$/i,
  /^auth[_-]?token$/i,
  /^_csrf$/i,
];

// ---------------------------------------------------------------------------
// JWT detection
// ---------------------------------------------------------------------------

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Returns true if the string looks like a JWT (three dot-separated base64url segments). */
const looksLikeJwt = (value: string): boolean => {
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  return parts.every(p => p.length > 0 && BASE64URL_SEGMENT.test(p));
};

// ---------------------------------------------------------------------------
// Auth-related key pattern (used for globals and storage)
// ---------------------------------------------------------------------------

const AUTH_KEY_PATTERN = /user|session|token|auth|account|profile|login|credential/i;

// ---------------------------------------------------------------------------
// API key header names (case-insensitive matching)
// ---------------------------------------------------------------------------

const API_KEY_HEADERS = new Set(['x-api-key', 'api-key', 'apikey']);

// ---------------------------------------------------------------------------
// Detection functions
// ---------------------------------------------------------------------------

const detectCookieSessions = (cookies: CookieEntry[]): AuthMethod[] => {
  const methods: AuthMethod[] = [];
  for (const cookie of cookies) {
    if (SESSION_COOKIE_PATTERNS.some(p => p.test(cookie.name))) {
      const escapedName = cookie.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      methods.push({
        type: 'cookie-session',
        details: `Session cookie "${cookie.name}" found`,
        extractionHint: `document.cookie.match(/${escapedName}=([^;]+)/)?.[1]`,
      });
    }
  }
  return methods;
};

const detectJwtInStorage = (entries: StorageEntry[], storageType: 'local' | 'session'): AuthMethod[] => {
  const methods: AuthMethod[] = [];
  const type: AuthMethodType = storageType === 'local' ? 'jwt-localstorage' : 'jwt-sessionstorage';
  const apiName = storageType === 'local' ? 'localStorage' : 'sessionStorage';

  for (const entry of entries) {
    if (looksLikeJwt(entry.value)) {
      methods.push({
        type,
        details: `JWT found in ${apiName} key "${entry.key}"`,
        extractionHint: `${apiName}.getItem('${entry.key}')`,
      });
    }
  }
  return methods;
};

/**
 * Detects Authorization: Bearer headers in captured network requests.
 *
 * The network capture preserves the auth scheme prefix while redacting
 * the credential (e.g., "Bearer [REDACTED]"), enabling reliable scheme
 * detection. Falls back to cross-referencing with JWT in storage if
 * the header is fully redacted (legacy "[REDACTED]" format).
 */
const detectBearerHeaders = (requests: NetworkRequest[], hasJwtInStorage: boolean): AuthMethod[] => {
  const requestsWithAuth = requests.filter(r => r.requestHeaders && hasHeader(r.requestHeaders, 'authorization'));
  if (requestsWithAuth.length === 0) return [];

  // Check if any Authorization header starts with "Bearer"
  const hasBearerPrefix = requestsWithAuth.some(r => {
    if (!r.requestHeaders) return false;
    const val = getHeaderValue(r.requestHeaders, 'authorization');
    return val !== undefined && val.startsWith('Bearer ');
  });

  // Check if any Authorization header starts with "Basic"
  const hasBasicPrefix = requestsWithAuth.some(r => {
    if (!r.requestHeaders) return false;
    const val = getHeaderValue(r.requestHeaders, 'authorization');
    return val !== undefined && val.startsWith('Basic ');
  });

  // If all auth headers are Basic (no Bearer), skip bearer detection
  if (hasBasicPrefix && !hasBearerPrefix && !hasJwtInStorage) return [];

  // Classify as bearer-header if: explicit Bearer prefix, JWT in storage,
  // or fully-redacted header with no Basic prefix (default assumption)
  const firstWithAuth = requestsWithAuth[0];
  const hasFullyRedacted = requestsWithAuth.some(r => {
    const val = r.requestHeaders ? getHeaderValue(r.requestHeaders, 'authorization') : undefined;
    return val === '[REDACTED]';
  });

  if (firstWithAuth && (hasBearerPrefix || hasJwtInStorage || (hasFullyRedacted && !hasBasicPrefix))) {
    const sampleUrl = firstWithAuth.url;
    return [
      {
        type: 'bearer-header',
        details: `Authorization header detected on ${requestsWithAuth.length} request(s), e.g., ${truncateUrl(sampleUrl)}`,
        extractionHint: hasJwtInStorage
          ? '// Token likely from storage — see jwt-localstorage or jwt-sessionstorage entries above'
          : '// Intercept fetch to capture the token:\n// const origFetch = window.fetch;\n// window.fetch = (...args) => { console.log(args); return origFetch(...args); }',
      },
    ];
  }

  return [];
};

/** Detects API key headers (X-API-Key, Api-Key, apikey) in network requests. */
const detectApiKeyHeaders = (requests: NetworkRequest[]): AuthMethod[] => {
  const methods: AuthMethod[] = [];
  const seen = new Set<string>();

  for (const req of requests) {
    if (!req.requestHeaders) continue;
    for (const [key] of Object.entries(req.requestHeaders)) {
      const lower = key.toLowerCase();
      if (API_KEY_HEADERS.has(lower) && !seen.has(lower)) {
        seen.add(lower);
        methods.push({
          type: 'api-key-header',
          details: `API key header "${key}" found in requests to ${truncateUrl(req.url)}`,
          extractionHint: `// Intercept fetch to capture the ${key} header value:\n// const origFetch = window.fetch;\n// window.fetch = (...args) => { console.log(args); return origFetch(...args); }`,
        });
      }
    }
  }
  return methods;
};

/** Detects CSRF tokens from DOM elements and network headers. */
const detectCsrfTokens = (csrfDomTokens: CsrfDomToken[], requests: NetworkRequest[]): AuthMethod[] => {
  const methods: AuthMethod[] = [];

  // DOM-based CSRF tokens (meta tags and hidden inputs)
  for (const token of csrfDomTokens) {
    const source = token.source === 'meta' ? `meta tag name="${token.name}"` : `hidden input name="${token.name}"`;
    const extractionHint =
      token.source === 'meta'
        ? `document.querySelector('meta[name="${token.name}"]')?.getAttribute('content')`
        : `document.querySelector('input[name="${token.name}"]')?.value`;

    methods.push({
      type: 'csrf-token',
      details: `CSRF token found in ${source}`,
      extractionHint,
    });
  }

  // CSRF headers in network requests (X-CSRF-Token, X-XSRF-Token)
  const csrfHeaderNames = new Set<string>();
  for (const req of requests) {
    if (!req.requestHeaders) continue;
    for (const key of Object.keys(req.requestHeaders)) {
      const lower = key.toLowerCase();
      if ((lower === 'x-csrf-token' || lower === 'x-xsrf-token') && !csrfHeaderNames.has(lower)) {
        csrfHeaderNames.add(lower);
        methods.push({
          type: 'csrf-token',
          details: `CSRF header "${key}" found in network requests`,
          extractionHint: `// The ${key} header value is typically sourced from a meta tag or cookie`,
        });
      }
    }
  }

  return methods;
};

/**
 * Detects Basic Auth (Authorization: Basic) headers in network requests.
 * The header value is scrubbed to "Basic [REDACTED]", preserving the scheme prefix.
 */
const detectBasicAuth = (requests: NetworkRequest[]): AuthMethod[] => {
  const requestsWithAuth = requests.filter(r => r.requestHeaders && hasHeader(r.requestHeaders, 'authorization'));

  const hasBasicPrefix = requestsWithAuth.some(r => {
    if (!r.requestHeaders) return false;
    const val = getHeaderValue(r.requestHeaders, 'authorization');
    return val !== undefined && val.startsWith('Basic ');
  });

  if (!hasBasicPrefix) return [];

  const basicReq = requestsWithAuth.find(r => {
    if (!r.requestHeaders) return false;
    const val = getHeaderValue(r.requestHeaders, 'authorization');
    return val !== undefined && val.startsWith('Basic ');
  });
  if (!basicReq) return [];
  const sampleUrl = basicReq.url;
  return [
    {
      type: 'basic-auth',
      details: `Basic Auth header detected on request(s) to ${truncateUrl(sampleUrl)}`,
      extractionHint:
        "// Basic Auth uses btoa('username:password')\n// Check if credentials are stored in a page global or prompted via browser dialog",
    },
  ];
};

/**
 * Detects non-standard headers that appear on most requests and contain
 * token-like values (long alphanumeric strings).
 */
const detectCustomAuthHeaders = (requests: NetworkRequest[]): AuthMethod[] => {
  if (requests.length < 2) return [];

  // Count header occurrences across requests
  const headerCounts = new Map<string, number>();
  const headerSampleValues = new Map<string, string>();
  const standardHeaders = new Set([
    'accept',
    'accept-encoding',
    'accept-language',
    'cache-control',
    'connection',
    'content-length',
    'content-type',
    'host',
    'origin',
    'pragma',
    'referer',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'sec-fetch-dest',
    'sec-fetch-mode',
    'sec-fetch-site',
    'user-agent',
    'authorization',
    'cookie',
    'x-csrf-token',
    'x-xsrf-token',
    'x-api-key',
    'api-key',
    'apikey',
  ]);

  for (const req of requests) {
    if (!req.requestHeaders) continue;
    for (const [key, value] of Object.entries(req.requestHeaders)) {
      const lower = key.toLowerCase();
      if (standardHeaders.has(lower)) continue;
      if (value === '[REDACTED]') continue;

      headerCounts.set(lower, (headerCounts.get(lower) ?? 0) + 1);
      if (!headerSampleValues.has(lower)) {
        headerSampleValues.set(lower, value);
      }
    }
  }

  const methods: AuthMethod[] = [];
  const threshold = Math.max(2, Math.floor(requests.length * 0.5));

  for (const [headerName, count] of headerCounts) {
    if (count < threshold) continue;
    const sampleValue = headerSampleValues.get(headerName) ?? '';
    // Token-like: at least 16 chars, mostly alphanumeric/base64
    if (sampleValue.length >= 16 && /^[A-Za-z0-9+/=_-]+$/.test(sampleValue)) {
      methods.push({
        type: 'custom-auth-header',
        details: `Custom header "${headerName}" appears on ${count}/${requests.length} requests with token-like values`,
        extractionHint: `// Intercept fetch to capture the ${headerName} header:\n// const origFetch = window.fetch;\n// window.fetch = (...args) => { console.log(args); return origFetch(...args); }`,
      });
    }
  }

  return methods;
};

/** Detects auth data in well-known window globals (__NEXT_DATA__, __NUXT__, etc.). */
const detectAuthInGlobals = (globals: GlobalEntry[]): AuthMethod[] => {
  const methods: AuthMethod[] = [];
  const authGlobalPaths = ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__APP_STATE__'];

  for (const global of globals) {
    const basePath = global.path.split('.')[0] ?? '';
    if (!authGlobalPaths.includes(basePath)) continue;
    if (typeof global.value !== 'object' || global.value === null) continue;

    const authKeys = findAuthKeys(global.value as Record<string, unknown>, global.path, 0);
    if (authKeys.length > 0) {
      methods.push({
        type: 'auth-global',
        details: `Auth-related data found in window.${global.path}: keys [${authKeys.join(', ')}]`,
        extractionHint: authKeys.map(k => `window.${k}`).join('\n'),
      });
    }
  }

  return methods;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Case-insensitive check for header presence. */
const hasHeader = (headers: Record<string, string>, name: string): boolean => {
  const lower = name.toLowerCase();
  return Object.keys(headers).some(k => k.toLowerCase() === lower);
};

/** Case-insensitive header value lookup. */
const getHeaderValue = (headers: Record<string, string>, name: string): string | undefined => {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
};

/** Truncate a URL for display in details strings. */
const truncateUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.length > 40 ? parsed.pathname.slice(0, 40) + '...' : parsed.pathname;
    return `${parsed.origin}${path}`;
  } catch {
    return url.length > 80 ? url.slice(0, 80) + '...' : url;
  }
};

/**
 * Recursively find keys that match auth-related patterns within an object.
 * Limited to 2 levels of depth.
 */
const findAuthKeys = (obj: Record<string, unknown>, prefix: string, depth: number): string[] => {
  if (depth > 2) return [];
  const keys: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullPath = `${prefix}.${key}`;
    if (AUTH_KEY_PATTERN.test(key)) {
      keys.push(fullPath);
    }
    if (depth < 2 && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...findAuthKeys(value as Record<string, unknown>, fullPath, depth + 1));
    }
  }

  return keys;
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Analyze collected page data and detect authentication methods.
 *
 * This is a pure function: takes data in, returns structured results.
 * The orchestrator (US-005) collects the data via browser tools and
 * passes it here.
 */
const detectAuth = (input: AuthDetectionInput): AuthAnalysis => {
  const methods: AuthMethod[] = [];

  // 1. Cookie-based sessions
  methods.push(...detectCookieSessions(input.cookies));

  // 2. JWT in localStorage
  methods.push(...detectJwtInStorage(input.localStorageEntries, 'local'));

  // 3. JWT in sessionStorage
  methods.push(...detectJwtInStorage(input.sessionStorageEntries, 'session'));

  const hasJwtInStorage =
    methods.some(m => m.type === 'jwt-localstorage') || methods.some(m => m.type === 'jwt-sessionstorage');

  // 4. Bearer headers (cross-referenced with JWT in storage)
  methods.push(...detectBearerHeaders(input.networkRequests, hasJwtInStorage));

  // 5. API key headers
  methods.push(...detectApiKeyHeaders(input.networkRequests));

  // 6. CSRF tokens (DOM + network headers)
  methods.push(...detectCsrfTokens(input.csrfDomTokens, input.networkRequests));

  // 7. Basic Auth
  methods.push(...detectBasicAuth(input.networkRequests));

  // 8. Custom auth headers
  methods.push(...detectCustomAuthHeaders(input.networkRequests));

  // 9. Auth data in window globals
  methods.push(...detectAuthInGlobals(input.windowGlobals));

  return {
    authenticated: methods.length > 0,
    methods,
  };
};

export { detectAuth };
export type {
  AuthDetectionInput,
  AuthAnalysis,
  AuthMethod,
  AuthMethodType,
  NetworkRequest,
  CookieEntry,
  StorageEntry,
  GlobalEntry,
  CsrfDomToken,
};
