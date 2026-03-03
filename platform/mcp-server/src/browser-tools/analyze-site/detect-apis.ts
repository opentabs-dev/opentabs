/**
 * API pattern detection module for the site analyzer.
 *
 * Pure analysis function: takes captured network requests (the format returned
 * by browser_get_network_requests), classifies by protocol, groups by base
 * path, and filters noise. Does not call browser tools directly.
 */

import type { NetworkRequest } from './detect-auth.js';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** Supported API protocol classifications for captured network requests. */
type ApiProtocol = 'rest' | 'graphql' | 'grpc-web' | 'jsonrpc' | 'trpc' | 'websocket' | 'sse' | 'form-submission';

/** A captured WebSocket frame from the network capture engine. */
interface WsFrame {
  url: string;
  direction: 'sent' | 'received';
  data: string;
  opcode: number;
  timestamp: number;
}

/** A single detected API endpoint with its protocol, auth info, and call frequency. */
interface ApiEndpoint {
  url: string;
  method: string;
  contentType: string | undefined;
  protocol: ApiProtocol;
  authHeader: string | undefined;
  requestBodySample: string | undefined;
  responseStatus: number | undefined;
  callCount: number;
  wsFrameSamples: string[] | undefined;
}

/** Result of API pattern detection: classified endpoints and the primary API base URL. */
interface ApiAnalysis {
  endpoints: ApiEndpoint[];
  primaryApiBaseUrl: string | undefined;
}

// ---------------------------------------------------------------------------
// Noise filtering
// ---------------------------------------------------------------------------

/** File extensions for static assets that are never API calls. */
const STATIC_ASSET_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.map',
  '.webp',
  '.avif',
  '.mp4',
  '.webm',
  '.mp3',
  '.wav',
  '.pdf',
]);

/** Known analytics/tracking domains to ignore. */
const ANALYTICS_DOMAINS = new Set([
  'google-analytics.com',
  'www.google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'www.googletagmanager.com',
  'segment.io',
  'api.segment.io',
  'cdn.segment.com',
  'mixpanel.com',
  'api.mixpanel.com',
  'api-js.mixpanel.com',
  'sentry.io',
  'o0.ingest.sentry.io',
  'hotjar.com',
  'script.hotjar.com',
  'static.hotjar.com',
  'fullstory.com',
  'rs.fullstory.com',
  'amplitude.com',
  'api.amplitude.com',
  'cdn.amplitude.com',
  'heap.io',
  'heapanalytics.com',
  'cdn.heapanalytics.com',
  'intercom.io',
  'api-iam.intercom.io',
  'widget.intercom.io',
  'px.ads.linkedin.com',
  'facebook.com',
  'connect.facebook.net',
  'graph.facebook.com',
  'bat.bing.com',
  'clarity.ms',
  'newrelic.com',
  'bam.nr-data.net',
  'js-agent.newrelic.com',
  'datadog.com',
  'browser-intake-datadoghq.com',
  'rum.browser-intake-datadoghq.com',
  'plausible.io',
  'stats.wp.com',
]);

/** Returns true if the URL points to a static asset based on file extension. */
const isStaticAsset = (url: string): boolean => {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split('/').pop() ?? '';
    const dotIndex = lastSegment.lastIndexOf('.');
    if (dotIndex === -1) return false;
    return STATIC_ASSET_EXTENSIONS.has(lastSegment.slice(dotIndex).toLowerCase());
  } catch {
    return false;
  }
};

/** Returns true if the URL belongs to a known analytics/tracking domain. */
const isAnalyticsDomain = (url: string): boolean => {
  try {
    const hostname = new URL(url).hostname;
    // Check exact match and parent domain match
    if (ANALYTICS_DOMAINS.has(hostname)) return true;
    // Check if any analytics domain is a suffix of the hostname
    for (const domain of ANALYTICS_DOMAINS) {
      if (hostname.endsWith(`.${domain}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
};

/** Returns true if the URL looks like a browser extension request. */
const isExtensionRequest = (url: string): boolean =>
  url.startsWith('chrome-extension://') || url.startsWith('moz-extension://');

/** Returns true if the request should be filtered out as noise. */
const isNoise = (req: NetworkRequest): boolean => {
  if (isExtensionRequest(req.url)) return true;
  if (isAnalyticsDomain(req.url)) return true;
  if (isStaticAsset(req.url)) return true;

  // Tracking pixels: GET requests for 1x1 images or /pixel paths
  if (req.method === 'GET') {
    try {
      const pathname = new URL(req.url).pathname;
      if (pathname.includes('/pixel') || pathname.includes('/track') || pathname.includes('/beacon')) return true;
    } catch {
      // Ignore parse errors
    }
  }

  return false;
};

// ---------------------------------------------------------------------------
// Protocol classification
// ---------------------------------------------------------------------------

/** Case-insensitive header value lookup. */
const getHeaderValue = (headers: Record<string, string>, name: string): string | undefined => {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
};

/** Detect the auth header name used on a request (for reporting). */
const detectAuthHeader = (headers: Record<string, string> | undefined): string | undefined => {
  if (!headers) return undefined;
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization') return key;
    if (lower === 'x-api-key' || lower === 'api-key' || lower === 'apikey') return key;
  }
  return undefined;
};

/** Classify the protocol of a network request. */
const classifyProtocol = (req: NetworkRequest): ApiProtocol | undefined => {
  const contentType = (req.mimeType ?? getHeaderValue(req.requestHeaders ?? {}, 'content-type') ?? '').toLowerCase();
  const url = req.url.toLowerCase();

  // gRPC-Web: check content type
  if (contentType.includes('application/grpc-web')) return 'grpc-web';

  // SSE: text/event-stream response
  if (req.responseHeaders) {
    const responseContentType = getHeaderValue(req.responseHeaders, 'content-type') ?? '';
    if (responseContentType.toLowerCase().includes('text/event-stream')) return 'sse';
  }

  // WebSocket: upgrade requests
  if (req.requestHeaders) {
    const upgrade = getHeaderValue(req.requestHeaders, 'upgrade');
    if (upgrade && upgrade.toLowerCase() === 'websocket') return 'websocket';
  }
  // Also detect WebSocket from URL scheme
  if (url.startsWith('wss://') || url.startsWith('ws://')) return 'websocket';

  // tRPC: requests to /api/trpc/ or /trpc/ paths
  try {
    const pathname = new URL(req.url).pathname;
    if (/\/(api\/)?trpc\//i.test(pathname)) return 'trpc';
  } catch {
    // Ignore parse errors
  }

  // GraphQL: POST to /graphql path with query field in body
  if (req.method === 'POST') {
    try {
      const pathname = new URL(req.url).pathname;
      if (pathname.endsWith('/graphql') || pathname.endsWith('/graphql/')) {
        return 'graphql';
      }
    } catch {
      // Ignore parse errors
    }
    // Also check request body for GraphQL queries
    if (req.requestBody) {
      try {
        const body = JSON.parse(req.requestBody) as Record<string, unknown>;
        if ('query' in body && typeof body.query === 'string') {
          return 'graphql';
        }
      } catch {
        // Not JSON
      }
    }
  }

  // JSON-RPC: body with jsonrpc field
  if (req.method === 'POST' && req.requestBody) {
    try {
      const body = JSON.parse(req.requestBody) as Record<string, unknown>;
      if (body.jsonrpc === '2.0') {
        return 'jsonrpc';
      }
    } catch {
      // Not JSON
    }
  }

  // Form submission: POST with form content type
  if (
    req.method === 'POST' &&
    (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data'))
  ) {
    return 'form-submission';
  }

  // REST: JSON content type or standard HTTP methods with JSON-like responses
  if (contentType.includes('application/json') || contentType.includes('text/json')) {
    return 'rest';
  }

  // Check response content type for JSON
  if (req.responseHeaders) {
    const responseContentType = getHeaderValue(req.responseHeaders, 'content-type') ?? '';
    if (responseContentType.toLowerCase().includes('application/json')) return 'rest';
  }

  // Remaining XHR/fetch requests that don't match a specific protocol
  // Only classify if it looks like an API call (not a page navigation)
  if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    try {
      const pathname = new URL(req.url).pathname;
      if (
        pathname.includes('/api/') ||
        pathname.includes('/v1/') ||
        pathname.includes('/v2/') ||
        pathname.includes('/v3/')
      ) {
        return 'rest';
      }
    } catch {
      // Ignore parse errors
    }
  }

  return undefined;
};

// ---------------------------------------------------------------------------
// WebSocket URL normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes a WebSocket URL for comparison by converting wss:// to https://
 * and ws:// to http://, then returning origin + pathname (no query string).
 * This allows matching frame URLs (wss://) against endpoint URLs derived from
 * HTTP upgrade requests (https://).
 */
const normalizeWsUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
    else if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
};

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** Generate a grouping key for deduplication: method + normalized URL path. */
const groupKey = (req: NetworkRequest): string => {
  try {
    const parsed = new URL(req.url);
    // Remove query params and fragments for grouping
    return `${req.method} ${parsed.origin}${parsed.pathname}`;
  } catch {
    return `${req.method} ${req.url}`;
  }
};

/** Truncate a request body to a maximum length for sampling. */
const truncateBody = (body: string | undefined, maxLen: number): string | undefined => {
  if (!body) return undefined;
  if (body.length <= maxLen) return body;
  return body.slice(0, maxLen) + '...';
};

// ---------------------------------------------------------------------------
// Primary API base URL detection
// ---------------------------------------------------------------------------

/** Find the most common origin+path prefix among classified API requests. */
const detectPrimaryApiBaseUrl = (endpoints: ApiEndpoint[]): string | undefined => {
  if (endpoints.length === 0) return undefined;

  // Collect all origin+path prefixes at varying depths (1 segment, 2 segments, etc.)
  // and find the deepest prefix shared by the most endpoints.
  const prefixCounts = new Map<string, number>();

  for (const endpoint of endpoints) {
    try {
      const parsed = new URL(endpoint.url);
      const pathSegments = parsed.pathname.split('/').filter(Boolean);
      // Register origin alone and each incremental path prefix (count each endpoint once)
      prefixCounts.set(parsed.origin, (prefixCounts.get(parsed.origin) ?? 0) + 1);
      for (let depth = 1; depth <= Math.min(pathSegments.length, 3); depth++) {
        const prefix = `${parsed.origin}/${pathSegments.slice(0, depth).join('/')}`;
        prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
      }
    } catch {
      // Ignore parse errors
    }
  }

  if (prefixCounts.size === 0) return undefined;

  // Find the deepest prefix that is shared by at least 2 endpoints (or all if only 1)
  const minCount = endpoints.length > 1 ? 2 : 1;

  let bestPrefix: string | undefined;
  let bestDepth = -1;
  let bestCount = 0;

  for (const [prefix, count] of prefixCounts) {
    if (count < minCount) continue;
    const depth = prefix.split('/').length;
    // Prefer prefixes with higher endpoint coverage, break ties by depth
    if (count > bestCount || (count === bestCount && depth > bestDepth)) {
      bestDepth = depth;
      bestCount = count;
      bestPrefix = prefix;
    }
  }

  return bestPrefix;
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const MAX_BODY_SAMPLE_LENGTH = 500;

/** Maximum number of WebSocket frame samples to include per endpoint. */
const MAX_WS_FRAME_SAMPLES = 5;

/** Maximum length per WebSocket frame sample payload. */
const MAX_WS_FRAME_SAMPLE_LENGTH = 500;

/**
 * Analyze captured network requests and detect API patterns.
 *
 * This is a pure function: takes an array of captured network requests and
 * optionally captured WebSocket frames, classifies by protocol, groups by
 * endpoint, and filters noise. When WebSocket frames are provided, the first
 * few unique received text frame payloads are attached to WebSocket endpoints
 * as wsFrameSamples.
 */
const detectApis = (requests: NetworkRequest[], wsFrames?: WsFrame[]): ApiAnalysis => {
  // Phase 1: Filter noise
  const apiRequests = requests.filter(req => !isNoise(req));

  // Phase 2: Classify and group
  const groups = new Map<string, ApiEndpoint>();

  for (const req of apiRequests) {
    const protocol = classifyProtocol(req);
    if (!protocol) continue;

    const key = groupKey(req);
    const existing = groups.get(key);

    if (existing) {
      existing.callCount += 1;
      // Keep the first response status and body sample
    } else {
      const contentType = req.mimeType ?? getHeaderValue(req.requestHeaders ?? {}, 'content-type') ?? undefined;
      groups.set(key, {
        url: (() => {
          try {
            const parsed = new URL(req.url);
            return `${parsed.origin}${parsed.pathname}`;
          } catch {
            return req.url;
          }
        })(),
        method: req.method,
        contentType,
        protocol,
        authHeader: detectAuthHeader(req.requestHeaders),
        requestBodySample: truncateBody(req.requestBody, MAX_BODY_SAMPLE_LENGTH),
        responseStatus: req.status,
        callCount: 1,
        wsFrameSamples: undefined,
      });
    }
  }

  const endpoints = [...groups.values()];

  // Enrich WebSocket endpoints with frame samples when frames are available
  if (wsFrames && wsFrames.length > 0) {
    for (const ep of endpoints) {
      if (ep.protocol !== 'websocket') continue;

      // Collect unique received text frames (opcode 1) for this endpoint URL
      const seen = new Set<string>();
      const samples: string[] = [];
      for (const frame of wsFrames) {
        if (samples.length >= MAX_WS_FRAME_SAMPLES) break;
        if (frame.direction !== 'received' || frame.opcode !== 1) continue;
        if (normalizeWsUrl(frame.url) !== normalizeWsUrl(ep.url)) continue;
        const payload =
          frame.data.length > MAX_WS_FRAME_SAMPLE_LENGTH
            ? frame.data.slice(0, MAX_WS_FRAME_SAMPLE_LENGTH) + '...'
            : frame.data;
        if (seen.has(payload)) continue;
        seen.add(payload);
        samples.push(payload);
      }
      if (samples.length > 0) {
        ep.wsFrameSamples = samples;
      }
    }
  }

  return {
    endpoints,
    primaryApiBaseUrl: detectPrimaryApiBaseUrl(endpoints),
  };
};

export { detectApis };
export type { ApiProtocol, ApiEndpoint, ApiAnalysis, WsFrame };
