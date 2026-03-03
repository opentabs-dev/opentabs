import { detectApis } from './detect-apis.js';
import { describe, expect, test } from 'vitest';
import type { ApiEndpoint, ApiProtocol, WsFrame } from './detect-apis.js';
import type { NetworkRequest } from './detect-auth.js';

/** Build a minimal network request with defaults. */
const req = (overrides: Partial<NetworkRequest> & { url: string; method: string }): NetworkRequest => ({
  ...overrides,
});

/** Find an endpoint by protocol and throw if missing. */
const findByProtocol = (endpoints: ApiEndpoint[], protocol: ApiProtocol): ApiEndpoint => {
  const ep = endpoints.find(e => e.protocol === protocol);
  if (!ep) throw new Error(`Expected to find endpoint with protocol "${protocol}"`);
  return ep;
};

/** Find an endpoint by URL substring and throw if missing. */
const findByUrl = (endpoints: ApiEndpoint[], substring: string): ApiEndpoint => {
  const ep = endpoints.find(e => e.url.includes(substring));
  if (!ep) throw new Error(`Expected to find endpoint with URL containing "${substring}"`);
  return ep;
};

describe('detectApis', () => {
  test('returns empty when no requests', () => {
    const result = detectApis([]);
    expect(result.endpoints).toEqual([]);
    expect(result.primaryApiBaseUrl).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Noise filtering
  // -----------------------------------------------------------------------

  describe('noise filtering', () => {
    test('filters out static JS assets', () => {
      const result = detectApis([
        req({ url: 'https://example.com/bundle.js', method: 'GET' }),
        req({ url: 'https://example.com/vendor.mjs', method: 'GET' }),
        req({ url: 'https://example.com/main.cjs', method: 'GET' }),
      ]);
      expect(result.endpoints).toHaveLength(0);
    });

    test('filters out static CSS assets', () => {
      const result = detectApis([req({ url: 'https://example.com/style.css', method: 'GET' })]);
      expect(result.endpoints).toHaveLength(0);
    });

    test('filters out images', () => {
      const result = detectApis([
        req({ url: 'https://example.com/logo.png', method: 'GET' }),
        req({ url: 'https://example.com/photo.jpg', method: 'GET' }),
        req({ url: 'https://example.com/icon.svg', method: 'GET' }),
        req({ url: 'https://example.com/hero.webp', method: 'GET' }),
      ]);
      expect(result.endpoints).toHaveLength(0);
    });

    test('filters out font files', () => {
      const result = detectApis([
        req({ url: 'https://example.com/font.woff', method: 'GET' }),
        req({ url: 'https://example.com/font.woff2', method: 'GET' }),
        req({ url: 'https://example.com/font.ttf', method: 'GET' }),
      ]);
      expect(result.endpoints).toHaveLength(0);
    });

    test('filters out Google Analytics', () => {
      const result = detectApis([
        req({
          url: 'https://www.google-analytics.com/collect?v=1',
          method: 'POST',
          mimeType: 'application/json',
        }),
      ]);
      expect(result.endpoints).toHaveLength(0);
    });

    test('filters out Segment', () => {
      const result = detectApis([
        req({
          url: 'https://api.segment.io/v1/track',
          method: 'POST',
          mimeType: 'application/json',
        }),
      ]);
      expect(result.endpoints).toHaveLength(0);
    });

    test('filters out Mixpanel', () => {
      const result = detectApis([
        req({
          url: 'https://api-js.mixpanel.com/track',
          method: 'POST',
          mimeType: 'application/json',
        }),
      ]);
      expect(result.endpoints).toHaveLength(0);
    });

    test('filters out browser extension requests', () => {
      const result = detectApis([
        req({
          url: 'chrome-extension://abc123/background.js',
          method: 'GET',
        }),
      ]);
      expect(result.endpoints).toHaveLength(0);
    });

    test('filters out tracking pixels', () => {
      const result = detectApis([
        req({ url: 'https://example.com/pixel?id=123', method: 'GET' }),
        req({ url: 'https://example.com/track?event=view', method: 'GET' }),
        req({ url: 'https://example.com/beacon?t=1', method: 'GET' }),
      ]);
      expect(result.endpoints).toHaveLength(0);
    });

    test('filters out source maps', () => {
      const result = detectApis([req({ url: 'https://example.com/bundle.js.map', method: 'GET' })]);
      expect(result.endpoints).toHaveLength(0);
    });

    test('keeps actual API requests', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/users',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // REST classification
  // -----------------------------------------------------------------------

  describe('REST classification', () => {
    test('classifies JSON GET as REST', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('rest');
    });

    test('classifies JSON POST as REST', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'POST',
          mimeType: 'application/json',
          status: 201,
          requestBody: '{"title":"New Item"}',
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('rest');
    });

    test('classifies by response content type when request has no type', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/data',
          method: 'GET',
          status: 200,
          responseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('rest');
    });

    test('classifies requests to /api/ path as REST', () => {
      const result = detectApis([
        req({
          url: 'https://example.com/api/users/me',
          method: 'GET',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('rest');
    });

    test('classifies requests to versioned paths as REST', () => {
      const result = detectApis([
        req({
          url: 'https://example.com/v2/resources',
          method: 'GET',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('rest');
    });
  });

  // -----------------------------------------------------------------------
  // GraphQL classification
  // -----------------------------------------------------------------------

  describe('GraphQL classification', () => {
    test('classifies POST to /graphql as GraphQL', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/graphql',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: '{"query":"{ users { id name } }"}',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('graphql');
    });

    test('classifies POST to /graphql/ (trailing slash) as GraphQL', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/graphql/',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: '{"query":"mutation { createUser(name: \\"Test\\") { id } }"}',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('graphql');
    });

    test('classifies POST with query field as GraphQL even on non-standard URL', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/gql',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: '{"query":"{ items { id title } }","variables":{}}',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('graphql');
    });
  });

  // -----------------------------------------------------------------------
  // gRPC-Web classification
  // -----------------------------------------------------------------------

  describe('gRPC-Web classification', () => {
    test('classifies application/grpc-web as gRPC-Web', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/grpc.UserService/GetUser',
          method: 'POST',
          mimeType: 'application/grpc-web+proto',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('grpc-web');
    });
  });

  // -----------------------------------------------------------------------
  // JSON-RPC classification
  // -----------------------------------------------------------------------

  describe('JSON-RPC classification', () => {
    test('classifies POST with jsonrpc 2.0 field as JSON-RPC', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/rpc',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: '{"jsonrpc":"2.0","method":"getItems","params":{},"id":1}',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('jsonrpc');
    });

    test('does NOT classify POST without jsonrpc field as JSON-RPC', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/rpc',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: '{"method":"getItems","params":{}}',
          status: 200,
        }),
      ]);
      // Should be REST, not JSON-RPC
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('rest');
    });
  });

  // -----------------------------------------------------------------------
  // tRPC classification
  // -----------------------------------------------------------------------

  describe('tRPC classification', () => {
    test('classifies GET to /api/trpc/ path as tRPC', () => {
      const result = detectApis([
        req({
          url: 'https://example.com/api/trpc/user.list?input={}',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('trpc');
    });

    test('classifies POST to /trpc/ path as tRPC', () => {
      const result = detectApis([
        req({
          url: 'https://example.com/trpc/item.create',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: '{"title":"New"}',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('trpc');
    });
  });

  // -----------------------------------------------------------------------
  // WebSocket classification
  // -----------------------------------------------------------------------

  describe('WebSocket classification', () => {
    test('classifies WebSocket upgrade request', () => {
      const result = detectApis([
        req({
          url: 'https://example.com/ws',
          method: 'GET',
          requestHeaders: { Upgrade: 'websocket', Connection: 'Upgrade' },
          status: 101,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('websocket');
    });

    test('classifies ws:// URL as WebSocket', () => {
      const result = detectApis([
        req({
          url: 'ws://localhost:8080/ws?token=abc',
          method: 'GET',
          status: 101,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('websocket');
    });

    test('classifies wss:// URL as WebSocket', () => {
      const result = detectApis([
        req({
          url: 'wss://example.com/realtime',
          method: 'GET',
          status: 101,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('websocket');
    });
  });

  // -----------------------------------------------------------------------
  // SSE classification
  // -----------------------------------------------------------------------

  describe('SSE classification', () => {
    test('classifies text/event-stream response as SSE', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/events',
          method: 'GET',
          status: 200,
          responseHeaders: { 'Content-Type': 'text/event-stream' },
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('sse');
    });
  });

  // -----------------------------------------------------------------------
  // Form submission classification
  // -----------------------------------------------------------------------

  describe('form submission classification', () => {
    test('classifies POST with url-encoded body as form submission', () => {
      const result = detectApis([
        req({
          url: 'https://example.com/login',
          method: 'POST',
          mimeType: 'application/x-www-form-urlencoded',
          requestBody: 'username=test&password=pass',
          status: 302,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('form-submission');
    });

    test('classifies POST with multipart/form-data as form submission', () => {
      const result = detectApis([
        req({
          url: 'https://example.com/upload',
          method: 'POST',
          mimeType: 'multipart/form-data; boundary=----WebKitFormBoundary',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('form-submission');
    });
  });

  // -----------------------------------------------------------------------
  // Grouping and deduplication
  // -----------------------------------------------------------------------

  describe('grouping', () => {
    test('groups duplicate calls to same endpoint', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items?page=1',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
        req({
          url: 'https://api.example.com/v1/items?page=2',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
        req({
          url: 'https://api.example.com/v1/items?page=3',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.callCount).toBe(3);
    });

    test('keeps different methods to same URL as separate endpoints', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
        req({
          url: 'https://api.example.com/v1/items',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: '{"title":"New"}',
          status: 201,
        }),
      ]);
      expect(result.endpoints).toHaveLength(2);
    });

    test('strips query params from grouped URL', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items?page=1&limit=10',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
      ]);
      expect(result.endpoints[0]?.url).toBe('https://api.example.com/v1/items');
    });
  });

  // -----------------------------------------------------------------------
  // Request body sample
  // -----------------------------------------------------------------------

  describe('request body sample', () => {
    test('captures request body sample', () => {
      const body = '{"title":"New Item","description":"A test item"}';
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: body,
          status: 201,
        }),
      ]);
      expect(result.endpoints[0]?.requestBodySample).toBe(body);
    });

    test('truncates long request body to 500 chars', () => {
      const longBody = '{"data":"' + 'x'.repeat(600) + '"}';
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: longBody,
          status: 201,
        }),
      ]);
      const sample = result.endpoints[0]?.requestBodySample;
      if (!sample) throw new Error('Expected requestBodySample');
      expect(sample.length).toBeLessThanOrEqual(503); // 500 + "..."
      expect(sample.endsWith('...')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Auth header detection
  // -----------------------------------------------------------------------

  describe('auth header detection', () => {
    test('captures Authorization header name', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'GET',
          mimeType: 'application/json',
          requestHeaders: { Authorization: 'Bearer token123' },
          status: 200,
        }),
      ]);
      expect(result.endpoints[0]?.authHeader).toBe('Authorization');
    });

    test('captures X-API-Key header name', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'GET',
          mimeType: 'application/json',
          requestHeaders: { 'X-API-Key': 'my-key' },
          status: 200,
        }),
      ]);
      expect(result.endpoints[0]?.authHeader).toBe('X-API-Key');
    });

    test('returns undefined when no auth header', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
      ]);
      expect(result.endpoints[0]?.authHeader).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Primary API base URL
  // -----------------------------------------------------------------------

  describe('primary API base URL', () => {
    test('detects the most common API base URL', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/users',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
        req({
          url: 'https://api.example.com/v1/items',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
        req({
          url: 'https://api.example.com/v1/orders',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
        req({
          url: 'https://other.example.com/api/data',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
      ]);
      expect(result.primaryApiBaseUrl).toBe('https://api.example.com/v1');
    });

    test('returns undefined when no endpoints', () => {
      const result = detectApis([]);
      expect(result.primaryApiBaseUrl).toBeUndefined();
    });

    test('does not let a single heavily-called endpoint satisfy the multi-endpoint threshold', () => {
      // One endpoint called 10 times + one unrelated endpoint on the same origin.
      // Before the fix, callCount=10 inflated prefix counts so '/api/v1/users' (only
      // contributed to by the first endpoint) appeared to satisfy minCount=2.
      // After the fix, prefix counts are based on distinct endpoint count, so the
      // only prefix with count >= 2 is the shared origin.
      const heavilyCalledReqs = Array.from({ length: 10 }, () =>
        req({ url: 'https://api.example.com/api/v1/users', method: 'GET', mimeType: 'application/json', status: 200 }),
      );
      const result = detectApis([
        ...heavilyCalledReqs,
        req({ url: 'https://api.example.com/health', method: 'GET', mimeType: 'application/json', status: 200 }),
      ]);
      expect(result.primaryApiBaseUrl).toBe('https://api.example.com');
    });

    test('correctly identifies shared prefix from two distinct endpoints', () => {
      const result = detectApis([
        req({ url: 'https://api.example.com/api/v1/users', method: 'GET', mimeType: 'application/json', status: 200 }),
        req({ url: 'https://api.example.com/api/v1/items', method: 'GET', mimeType: 'application/json', status: 200 }),
      ]);
      expect(result.primaryApiBaseUrl).toBe('https://api.example.com/api/v1');
    });

    test('prefers prefix with higher endpoint count over deeper prefix with fewer endpoints', () => {
      // origin (count=3, depth=3) vs /v1 (count=2, depth=4): /v1 is deeper but covers fewer endpoints.
      // Old depth-first algorithm: /v1 (depth=4) wins over origin (depth=3) — WRONG, only 2/3 covered.
      // New count-first algorithm: origin (count=3) wins over /v1 (count=2) — CORRECT.
      const result = detectApis([
        req({ url: 'https://api.example.com/v1/users', method: 'GET', mimeType: 'application/json', status: 200 }),
        req({ url: 'https://api.example.com/v1/items', method: 'GET', mimeType: 'application/json', status: 200 }),
        req({ url: 'https://api.example.com/health', method: 'GET', mimeType: 'application/json', status: 200 }),
      ]);
      expect(result.primaryApiBaseUrl).toBe('https://api.example.com');
    });
  });

  // -----------------------------------------------------------------------
  // Content type capture
  // -----------------------------------------------------------------------

  describe('content type capture', () => {
    test('captures mimeType as content type', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
      ]);
      expect(result.endpoints[0]?.contentType).toBe('application/json');
    });

    test('falls back to Content-Type header when mimeType absent', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'GET',
          requestHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
          status: 200,
          responseHeaders: { 'Content-Type': 'application/json' },
        }),
      ]);
      expect(result.endpoints[0]?.contentType).toBe('application/json; charset=utf-8');
    });
  });

  // -----------------------------------------------------------------------
  // Response status capture
  // -----------------------------------------------------------------------

  describe('response status capture', () => {
    test('captures response status', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
      ]);
      expect(result.endpoints[0]?.responseStatus).toBe(200);
    });

    test('handles missing status', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'GET',
          mimeType: 'application/json',
        }),
      ]);
      expect(result.endpoints[0]?.responseStatus).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Mixed protocol scenario
  // -----------------------------------------------------------------------

  describe('mixed protocols', () => {
    test('classifies multiple protocols in a single page load', () => {
      const result = detectApis([
        // REST
        req({
          url: 'https://api.example.com/v1/items',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
        // GraphQL
        req({
          url: 'https://api.example.com/graphql',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: '{"query":"{ users { id } }"}',
          status: 200,
        }),
        // WebSocket
        req({
          url: 'wss://api.example.com/ws',
          method: 'GET',
          status: 101,
        }),
        // Static asset (filtered)
        req({ url: 'https://cdn.example.com/bundle.js', method: 'GET' }),
        // Analytics (filtered)
        req({
          url: 'https://www.google-analytics.com/collect',
          method: 'POST',
          mimeType: 'application/json',
        }),
      ]);

      expect(result.endpoints).toHaveLength(3);
      findByProtocol(result.endpoints, 'rest');
      findByProtocol(result.endpoints, 'graphql');
      findByProtocol(result.endpoints, 'websocket');
    });
  });

  // -----------------------------------------------------------------------
  // Unclassifiable requests
  // -----------------------------------------------------------------------

  describe('unclassifiable requests', () => {
    test('skips requests that cannot be classified', () => {
      const result = detectApis([
        req({
          url: 'https://example.com/some-page',
          method: 'GET',
          mimeType: 'text/html',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(0);
    });

    test('skips requests with no content type and no api path', () => {
      const result = detectApis([
        req({
          url: 'https://example.com/unknown',
          method: 'GET',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Priority order: more specific protocols win
  // -----------------------------------------------------------------------

  describe('protocol priority', () => {
    test('GraphQL takes priority over REST for /graphql endpoint', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/graphql',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: '{"query":"{ items { id } }"}',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('graphql');
    });

    test('JSON-RPC takes priority over REST for jsonrpc body', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/rpc',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: '{"jsonrpc":"2.0","method":"test","id":1}',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('jsonrpc');
    });

    test('tRPC takes priority over REST for /api/trpc/ path', () => {
      const result = detectApis([
        req({
          url: 'https://example.com/api/trpc/user.list',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('trpc');
    });

    test('gRPC-Web takes priority over everything for grpc content type', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/service/Method',
          method: 'POST',
          mimeType: 'application/grpc-web+proto',
          requestBody: '<binary>',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.protocol).toBe('grpc-web');
    });
  });

  // -----------------------------------------------------------------------
  // WebSocket frame samples
  // -----------------------------------------------------------------------

  describe('WebSocket frame samples', () => {
    const wsRequest = req({
      url: 'wss://example.com/realtime',
      method: 'GET',
      status: 101,
    });

    const frame = (overrides: Partial<WsFrame> = {}): WsFrame => ({
      url: 'wss://example.com/realtime',
      direction: 'received',
      data: '{"type":"message","payload":"hello"}',
      opcode: 1,
      timestamp: Date.now(),
      ...overrides,
    });

    test('attaches frame samples to WebSocket endpoints', () => {
      const result = detectApis([wsRequest], [frame()]);
      const wsEp = findByProtocol(result.endpoints, 'websocket');
      expect(wsEp.wsFrameSamples).toEqual(['{"type":"message","payload":"hello"}']);
    });

    test('only includes received text frames (opcode 1)', () => {
      const frames: WsFrame[] = [
        frame({ direction: 'sent', data: 'sent-data' }),
        frame({ direction: 'received', opcode: 2, data: 'binary-data' }),
        frame({ direction: 'received', opcode: 1, data: 'text-data' }),
      ];
      const result = detectApis([wsRequest], frames);
      const wsEp = findByProtocol(result.endpoints, 'websocket');
      expect(wsEp.wsFrameSamples).toEqual(['text-data']);
    });

    test('limits to 5 unique frame samples', () => {
      const frames: WsFrame[] = Array.from({ length: 10 }, (_, i) => frame({ data: `message-${i}` }));
      const result = detectApis([wsRequest], frames);
      const wsEp = findByProtocol(result.endpoints, 'websocket');
      expect(wsEp.wsFrameSamples).toHaveLength(5);
    });

    test('deduplicates frame payloads', () => {
      const frames: WsFrame[] = [frame({ data: 'duplicate' }), frame({ data: 'duplicate' }), frame({ data: 'unique' })];
      const result = detectApis([wsRequest], frames);
      const wsEp = findByProtocol(result.endpoints, 'websocket');
      expect(wsEp.wsFrameSamples).toEqual(['duplicate', 'unique']);
    });

    test('truncates long frame payloads to 500 chars', () => {
      const longPayload = 'x'.repeat(600);
      const result = detectApis([wsRequest], [frame({ data: longPayload })]);
      const wsEp = findByProtocol(result.endpoints, 'websocket');
      const samples = wsEp.wsFrameSamples;
      if (!samples || samples.length === 0) throw new Error('Expected wsFrameSamples');
      const sample = samples[0];
      if (!sample) throw new Error('Expected at least one sample');
      expect(sample.length).toBeLessThanOrEqual(503); // 500 + "..."
      expect(sample.endsWith('...')).toBe(true);
    });

    test('returns undefined wsFrameSamples when no frames provided', () => {
      const result = detectApis([wsRequest]);
      const wsEp = findByProtocol(result.endpoints, 'websocket');
      expect(wsEp.wsFrameSamples).toBeUndefined();
    });

    test('returns undefined wsFrameSamples when frames array is empty', () => {
      const result = detectApis([wsRequest], []);
      const wsEp = findByProtocol(result.endpoints, 'websocket');
      expect(wsEp.wsFrameSamples).toBeUndefined();
    });

    test('matches frames to endpoints by URL', () => {
      const otherWsRequest = req({
        url: 'wss://other.example.com/ws',
        method: 'GET',
        status: 101,
      });
      const frames: WsFrame[] = [
        frame({ url: 'wss://example.com/realtime', data: 'realtime-msg' }),
        frame({ url: 'wss://other.example.com/ws', data: 'other-msg' }),
      ];
      const result = detectApis([wsRequest, otherWsRequest], frames);
      const realtimeEp = findByUrl(result.endpoints, 'realtime');
      const otherEp = findByUrl(result.endpoints, 'other.example.com');
      expect(realtimeEp.wsFrameSamples).toEqual(['realtime-msg']);
      expect(otherEp.wsFrameSamples).toEqual(['other-msg']);
    });

    test('matches frames to endpoints when frame URL has query params', () => {
      const wsRequestWithQuery = req({
        url: 'wss://example.com/ws?token=abc',
        method: 'GET',
        status: 101,
      });
      const frames: WsFrame[] = [frame({ url: 'wss://example.com/ws?token=abc', data: 'ws-msg' })];
      const result = detectApis([wsRequestWithQuery], frames);
      const wsEp = findByProtocol(result.endpoints, 'websocket');
      // Endpoint URL is normalized (no query params), frame URL has query params — must still match
      expect(wsEp.url).toBe('wss://example.com/ws');
      expect(wsEp.wsFrameSamples).toEqual(['ws-msg']);
    });

    test('attaches wss:// frame samples to https:// endpoint from HTTP upgrade request', () => {
      // WebSocket endpoints detected via HTTP upgrade headers have https:// in their URL,
      // but frame URLs reported by the browser use wss://. The scheme mismatch must be
      // normalized so frame samples are correctly attached to the endpoint.
      const upgradeRequest = req({
        url: 'https://example.com/ws',
        method: 'GET',
        requestHeaders: { Upgrade: 'websocket', Connection: 'Upgrade' },
        status: 101,
      });
      const wssFrame: WsFrame = {
        url: 'wss://example.com/ws',
        direction: 'received',
        data: '{"type":"update","id":1}',
        opcode: 1,
        timestamp: Date.now(),
      };
      const result = detectApis([upgradeRequest], [wssFrame]);
      const wsEp = findByProtocol(result.endpoints, 'websocket');
      expect(wsEp.wsFrameSamples).toEqual(['{"type":"update","id":1}']);
    });

    test('non-WebSocket endpoints have undefined wsFrameSamples', () => {
      const restRequest = req({
        url: 'https://api.example.com/v1/items',
        method: 'GET',
        mimeType: 'application/json',
        status: 200,
      });
      const result = detectApis([restRequest, wsRequest], [frame()]);
      const restEp = findByProtocol(result.endpoints, 'rest');
      expect(restEp.wsFrameSamples).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    test('handles malformed URLs gracefully', () => {
      const result = detectApis([
        req({
          url: 'not-a-valid-url',
          method: 'GET',
          mimeType: 'application/json',
        }),
      ]);
      // Should not throw — may or may not classify
      expect(result).toBeDefined();
    });

    test('handles requests with no headers', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0]?.authHeader).toBeUndefined();
    });

    test('handles empty request body', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/items',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: '',
          status: 201,
        }),
      ]);
      expect(result.endpoints).toHaveLength(1);
    });

    // Verify it uses the helper functions correctly
    test('uses findByUrl and findByProtocol helpers', () => {
      const result = detectApis([
        req({
          url: 'https://api.example.com/v1/users',
          method: 'GET',
          mimeType: 'application/json',
          status: 200,
        }),
        req({
          url: 'https://api.example.com/graphql',
          method: 'POST',
          mimeType: 'application/json',
          requestBody: '{"query":"{ items { id } }"}',
          status: 200,
        }),
      ]);

      const restEndpoint = findByUrl(result.endpoints, '/v1/users');
      expect(restEndpoint.protocol).toBe('rest');

      const graphqlEndpoint = findByProtocol(result.endpoints, 'graphql');
      expect(graphqlEndpoint.url).toContain('/graphql');
    });
  });
});
