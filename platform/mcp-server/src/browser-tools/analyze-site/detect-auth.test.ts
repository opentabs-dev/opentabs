import { detectAuth } from './detect-auth.js';
import { describe, expect, test } from 'vitest';
import type { AuthDetectionInput, AuthMethod, AuthMethodType } from './detect-auth.js';

const emptyInput: AuthDetectionInput = {
  cookies: [],
  localStorageEntries: [],
  sessionStorageEntries: [],
  networkRequests: [],
  csrfDomTokens: [],
  windowGlobals: [],
};

// A valid JWT structure (header.payload.signature in base64url)
const FAKE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRlc3QiLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

/** Find a method by type and throw if missing (narrows type for subsequent assertions). */
const findMethod = (methods: AuthMethod[], type: AuthMethodType): AuthMethod => {
  const method = methods.find(m => m.type === type);
  if (!method) throw new Error(`Expected to find method of type "${type}"`);
  return method;
};

/** Get the first method in the array or throw. */
const firstMethod = (methods: AuthMethod[]): AuthMethod => {
  const method = methods[0];
  if (!method) throw new Error('Expected at least one method');
  return method;
};

describe('detectAuth', () => {
  test('returns not authenticated when no auth signals found', () => {
    const result = detectAuth(emptyInput);
    expect(result.authenticated).toBe(false);
    expect(result.methods).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Cookie-based sessions
  // -----------------------------------------------------------------------

  describe('cookie-based sessions', () => {
    test('detects connect.sid session cookie', () => {
      const result = detectAuth({
        ...emptyInput,
        cookies: [{ name: 'connect.sid', value: 's:abc123.sig' }],
      });
      expect(result.authenticated).toBe(true);
      const method = findMethod(result.methods, 'cookie-session');
      expect(method.details).toContain('connect.sid');
      expect(method.extractionHint).toContain('connect\\.sid');
    });

    test('detects d= cookie (Slack-style)', () => {
      const result = detectAuth({
        ...emptyInput,
        cookies: [{ name: 'd', value: 'xoxd-abc123' }],
      });
      expect(result.authenticated).toBe(true);
      const method = firstMethod(result.methods);
      expect(method.type).toBe('cookie-session');
      expect(method.details).toContain('"d"');
    });

    test('detects _session_id cookie', () => {
      const result = detectAuth({
        ...emptyInput,
        cookies: [{ name: '_session_id', value: 'abc123' }],
      });
      expect(result.authenticated).toBe(true);
      expect(firstMethod(result.methods).type).toBe('cookie-session');
    });

    test('detects JSESSIONID cookie', () => {
      const result = detectAuth({
        ...emptyInput,
        cookies: [{ name: 'JSESSIONID', value: 'abc123' }],
      });
      expect(result.authenticated).toBe(true);
      expect(firstMethod(result.methods).type).toBe('cookie-session');
    });

    test('detects __Secure- prefixed cookies', () => {
      const result = detectAuth({
        ...emptyInput,
        cookies: [{ name: '__Secure-auth', value: 'abc123' }],
      });
      expect(result.authenticated).toBe(true);
      expect(firstMethod(result.methods).type).toBe('cookie-session');
    });

    test('detects __Host- prefixed cookies', () => {
      const result = detectAuth({
        ...emptyInput,
        cookies: [{ name: '__Host-session', value: 'abc123' }],
      });
      expect(result.authenticated).toBe(true);
      expect(firstMethod(result.methods).type).toBe('cookie-session');
    });

    test('detects sid cookie', () => {
      const result = detectAuth({
        ...emptyInput,
        cookies: [{ name: 'sid', value: 'abc123' }],
      });
      expect(result.authenticated).toBe(true);
    });

    test('detects session cookie', () => {
      const result = detectAuth({
        ...emptyInput,
        cookies: [{ name: 'session', value: 'abc123' }],
      });
      expect(result.authenticated).toBe(true);
    });

    test('detects token cookie', () => {
      const result = detectAuth({
        ...emptyInput,
        cookies: [{ name: 'token', value: 'abc123' }],
      });
      expect(result.authenticated).toBe(true);
    });

    test('does NOT flag non-session cookies', () => {
      const result = detectAuth({
        ...emptyInput,
        cookies: [
          { name: '_ga', value: 'GA1.2.123' },
          { name: 'theme', value: 'dark' },
        ],
      });
      expect(result.authenticated).toBe(false);
    });

    test('extractionHint provides working JS code', () => {
      const result = detectAuth({
        ...emptyInput,
        cookies: [{ name: 'connect.sid', value: 's:abc' }],
      });
      const hint = firstMethod(result.methods).extractionHint;
      expect(hint).toMatch(/document\.cookie\.match/);
      expect(hint).toContain('connect\\.sid');
    });
  });

  // -----------------------------------------------------------------------
  // JWT in localStorage
  // -----------------------------------------------------------------------

  describe('JWT in localStorage', () => {
    test('detects JWT stored in localStorage', () => {
      const result = detectAuth({
        ...emptyInput,
        localStorageEntries: [{ key: 'auth_token', value: FAKE_JWT }],
      });
      expect(result.authenticated).toBe(true);
      const method = findMethod(result.methods, 'jwt-localstorage');
      expect(method.details).toContain('auth_token');
      expect(method.extractionHint).toContain("localStorage.getItem('auth_token')");
    });

    test('does NOT flag non-JWT localStorage values', () => {
      const result = detectAuth({
        ...emptyInput,
        localStorageEntries: [
          { key: 'theme', value: 'dark' },
          { key: 'lang', value: 'en-US' },
        ],
      });
      expect(result.methods.filter(m => m.type === 'jwt-localstorage')).toHaveLength(0);
    });

    test('detects multiple JWTs in localStorage', () => {
      const result = detectAuth({
        ...emptyInput,
        localStorageEntries: [
          { key: 'access_token', value: FAKE_JWT },
          { key: 'refresh_token', value: FAKE_JWT },
        ],
      });
      expect(result.methods.filter(m => m.type === 'jwt-localstorage')).toHaveLength(2);
    });

    test('does NOT detect base64-padded segments as JWT (no = padding in base64url)', () => {
      // A three-segment dot-separated string where one segment has base64 standard padding (=)
      // Per RFC 7515, base64url does not use padding — this should not match
      const paddedValue =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0=.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const result = detectAuth({
        ...emptyInput,
        localStorageEntries: [{ key: 'token', value: paddedValue }],
      });
      expect(result.methods.filter(m => m.type === 'jwt-localstorage')).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // JWT in sessionStorage
  // -----------------------------------------------------------------------

  describe('JWT in sessionStorage', () => {
    test('detects JWT stored in sessionStorage', () => {
      const result = detectAuth({
        ...emptyInput,
        sessionStorageEntries: [{ key: 'jwt', value: FAKE_JWT }],
      });
      expect(result.authenticated).toBe(true);
      const method = findMethod(result.methods, 'jwt-sessionstorage');
      expect(method.details).toContain('sessionStorage');
      expect(method.extractionHint).toContain("sessionStorage.getItem('jwt')");
    });
  });

  // -----------------------------------------------------------------------
  // Bearer headers
  // -----------------------------------------------------------------------

  describe('Bearer headers', () => {
    test('detects redacted Authorization header when JWT in storage', () => {
      const result = detectAuth({
        ...emptyInput,
        localStorageEntries: [{ key: 'token', value: FAKE_JWT }],
        networkRequests: [
          {
            url: 'https://api.example.com/data',
            method: 'GET',
            requestHeaders: { Authorization: '[REDACTED]' },
          },
        ],
      });
      expect(result.authenticated).toBe(true);
      const bearer = findMethod(result.methods, 'bearer-header');
      expect(bearer.details).toContain('Authorization header');
    });

    test('detects unredacted Bearer header', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://api.example.com/data',
            method: 'GET',
            requestHeaders: { Authorization: `Bearer ${FAKE_JWT}` },
          },
        ],
      });
      expect(result.methods.find(m => m.type === 'bearer-header')).toBeDefined();
    });

    test('detects redacted Authorization header even without JWT in storage', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://api.example.com/data',
            method: 'GET',
            requestHeaders: { Authorization: '[REDACTED]' },
          },
        ],
      });
      expect(result.methods.find(m => m.type === 'bearer-header')).toBeDefined();
    });

    test('reports request count in details', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://api.example.com/a',
            method: 'GET',
            requestHeaders: { Authorization: '[REDACTED]' },
          },
          {
            url: 'https://api.example.com/b',
            method: 'GET',
            requestHeaders: { Authorization: '[REDACTED]' },
          },
        ],
      });
      const bearer = findMethod(result.methods, 'bearer-header');
      expect(bearer.details).toContain('2 request(s)');
    });
  });

  // -----------------------------------------------------------------------
  // API key headers
  // -----------------------------------------------------------------------

  describe('API key headers', () => {
    test('detects X-API-Key header', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://api.example.com/data',
            method: 'GET',
            requestHeaders: { 'X-API-Key': 'abc123def456' },
          },
        ],
      });
      expect(result.authenticated).toBe(true);
      const method = findMethod(result.methods, 'api-key-header');
      expect(method.details).toContain('X-API-Key');
    });

    test('detects Api-Key header (case-insensitive)', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://api.example.com/data',
            method: 'GET',
            requestHeaders: { 'Api-Key': 'mykey' },
          },
        ],
      });
      expect(result.methods.find(m => m.type === 'api-key-header')).toBeDefined();
    });

    test('deduplicates same header across multiple requests', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://api.example.com/a',
            method: 'GET',
            requestHeaders: { 'X-API-Key': 'key1' },
          },
          {
            url: 'https://api.example.com/b',
            method: 'GET',
            requestHeaders: { 'X-API-Key': 'key1' },
          },
        ],
      });
      expect(result.methods.filter(m => m.type === 'api-key-header')).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // CSRF tokens
  // -----------------------------------------------------------------------

  describe('CSRF tokens', () => {
    test('detects CSRF meta tag', () => {
      const result = detectAuth({
        ...emptyInput,
        csrfDomTokens: [{ source: 'meta', name: 'csrf-token', value: 'abc123' }],
      });
      expect(result.authenticated).toBe(true);
      const method = findMethod(result.methods, 'csrf-token');
      expect(method.details).toContain('meta tag');
      expect(method.extractionHint).toContain('meta[name="csrf-token"]');
    });

    test('detects CSRF hidden input (authenticity_token)', () => {
      const result = detectAuth({
        ...emptyInput,
        csrfDomTokens: [{ source: 'hidden-input', name: 'authenticity_token', value: 'abc' }],
      });
      const method = findMethod(result.methods, 'csrf-token');
      expect(method.details).toContain('hidden input');
      expect(method.extractionHint).toContain('input[name="authenticity_token"]');
    });

    test('detects X-CSRF-Token header in network requests', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://example.com/api',
            method: 'POST',
            requestHeaders: { 'X-CSRF-Token': '[REDACTED]' },
          },
        ],
      });
      const csrfMethods = result.methods.filter(m => m.type === 'csrf-token' && m.details.includes('header'));
      expect(csrfMethods).toHaveLength(1);
      expect(csrfMethods.some(m => m.details.includes('X-CSRF-Token'))).toBe(true);
    });

    test('detects X-XSRF-Token header', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://example.com/api',
            method: 'POST',
            requestHeaders: { 'X-XSRF-Token': '[REDACTED]' },
          },
        ],
      });
      const csrfMethods = result.methods.filter(m => m.type === 'csrf-token' && m.details.includes('X-XSRF-Token'));
      expect(csrfMethods).toHaveLength(1);
    });

    test('detects both DOM and header CSRF tokens', () => {
      const result = detectAuth({
        ...emptyInput,
        csrfDomTokens: [{ source: 'meta', name: 'csrf-token', value: 'abc' }],
        networkRequests: [
          {
            url: 'https://example.com/api',
            method: 'POST',
            requestHeaders: { 'X-CSRF-Token': '[REDACTED]' },
          },
        ],
      });
      const csrfMethods = result.methods.filter(m => m.type === 'csrf-token');
      expect(csrfMethods).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Basic Auth
  // -----------------------------------------------------------------------

  describe('Basic Auth', () => {
    test('detects Authorization: Basic header', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://api.example.com/data',
            method: 'GET',
            requestHeaders: { Authorization: 'Basic dXNlcjpwYXNz' },
          },
        ],
      });
      const method = findMethod(result.methods, 'basic-auth');
      expect(method.details).toContain('Basic Auth');
    });

    test('detects Basic Auth from scheme-preserving redacted header', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://api.example.com/data',
            method: 'GET',
            requestHeaders: { Authorization: 'Basic [REDACTED]' },
          },
        ],
      });
      const method = findMethod(result.methods, 'basic-auth');
      expect(method.details).toContain('Basic Auth');
    });

    test('does NOT detect Basic Auth when header is fully redacted', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://api.example.com/data',
            method: 'GET',
            requestHeaders: { Authorization: '[REDACTED]' },
          },
        ],
      });
      const method = result.methods.find(m => m.type === 'basic-auth');
      expect(method).toBeUndefined();
    });

    test('samples URL from the first Basic auth request, not from a Bearer request that appears first', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://api.example.com/bearer-endpoint',
            method: 'GET',
            requestHeaders: { Authorization: `Bearer ${FAKE_JWT}` },
          },
          {
            url: 'https://api.example.com/basic-endpoint',
            method: 'GET',
            requestHeaders: { Authorization: 'Basic dXNlcjpwYXNz' },
          },
        ],
      });
      const method = findMethod(result.methods, 'basic-auth');
      expect(method.details).toContain('basic-endpoint');
      expect(method.details).not.toContain('bearer-endpoint');
    });
  });

  // -----------------------------------------------------------------------
  // Custom auth headers
  // -----------------------------------------------------------------------

  describe('custom auth headers', () => {
    test('detects non-standard header with token-like value on most requests', () => {
      const requests = Array.from({ length: 4 }, (_, i) => ({
        url: `https://api.example.com/endpoint${i}`,
        method: 'GET',
        requestHeaders: {
          'X-Custom-Auth': 'abcdef1234567890abcdef',
          'Content-Type': 'application/json',
        },
      }));
      const result = detectAuth({
        ...emptyInput,
        networkRequests: requests,
      });
      const method = findMethod(result.methods, 'custom-auth-header');
      expect(method.details).toContain('x-custom-auth');
    });

    test('does NOT flag header with short values', () => {
      const requests = Array.from({ length: 4 }, (_, i) => ({
        url: `https://api.example.com/endpoint${i}`,
        method: 'GET',
        requestHeaders: { 'X-Request-Id': 'abc' },
      }));
      const result = detectAuth({
        ...emptyInput,
        networkRequests: requests,
      });
      expect(result.methods.filter(m => m.type === 'custom-auth-header')).toHaveLength(0);
    });

    test('does NOT flag headers that appear on too few requests', () => {
      const result = detectAuth({
        ...emptyInput,
        networkRequests: [
          {
            url: 'https://api.example.com/a',
            method: 'GET',
            requestHeaders: { 'X-Rare-Header': 'abcdef1234567890abcdef' },
          },
          {
            url: 'https://api.example.com/b',
            method: 'GET',
            requestHeaders: {},
          },
          {
            url: 'https://api.example.com/c',
            method: 'GET',
            requestHeaders: {},
          },
          {
            url: 'https://api.example.com/d',
            method: 'GET',
            requestHeaders: {},
          },
        ],
      });
      expect(result.methods.filter(m => m.type === 'custom-auth-header')).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Auth data in window globals
  // -----------------------------------------------------------------------

  describe('auth data in window globals', () => {
    test('detects auth keys in __NEXT_DATA__', () => {
      const result = detectAuth({
        ...emptyInput,
        windowGlobals: [
          {
            path: '__NEXT_DATA__',
            value: {
              props: {
                pageProps: {
                  session: { user: { id: '1' }, accessToken: 'fake' },
                },
              },
            },
          },
        ],
      });
      expect(result.authenticated).toBe(true);
      const method = findMethod(result.methods, 'auth-global');
      expect(method.details).toContain('__NEXT_DATA__');
    });

    test('detects auth keys in __NUXT__', () => {
      const result = detectAuth({
        ...emptyInput,
        windowGlobals: [
          {
            path: '__NUXT__',
            value: { state: { auth: { token: 'abc', user: { name: 'test' } } } },
          },
        ],
      });
      const method = findMethod(result.methods, 'auth-global');
      expect(method.details).toContain('__NUXT__');
    });

    test('detects auth keys in __INITIAL_STATE__', () => {
      const result = detectAuth({
        ...emptyInput,
        windowGlobals: [
          {
            path: '__INITIAL_STATE__',
            value: { user: { id: '1', name: 'Test' } },
          },
        ],
      });
      expect(result.methods.find(m => m.type === 'auth-global')).toBeDefined();
    });

    test('does NOT detect non-auth globals', () => {
      const result = detectAuth({
        ...emptyInput,
        windowGlobals: [
          {
            path: '__NEXT_DATA__',
            value: { buildId: 'abc', runtimeConfig: {} },
          },
        ],
      });
      expect(result.methods.filter(m => m.type === 'auth-global')).toHaveLength(0);
    });

    test('ignores non-recognized globals', () => {
      const result = detectAuth({
        ...emptyInput,
        windowGlobals: [
          {
            path: 'myCustomGlobal',
            value: { user: { id: '1' } },
          },
        ],
      });
      expect(result.methods.filter(m => m.type === 'auth-global')).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Combined / complex scenarios
  // -----------------------------------------------------------------------

  describe('combined scenarios', () => {
    test('detects multiple auth methods simultaneously', () => {
      const result = detectAuth({
        cookies: [{ name: 'session', value: 'abc' }],
        localStorageEntries: [{ key: 'jwt', value: FAKE_JWT }],
        sessionStorageEntries: [],
        networkRequests: [
          {
            url: 'https://api.example.com/data',
            method: 'GET',
            requestHeaders: { Authorization: '[REDACTED]' },
          },
        ],
        csrfDomTokens: [{ source: 'meta', name: 'csrf-token', value: 'xyz' }],
        windowGlobals: [],
      });

      expect(result.authenticated).toBe(true);
      const types = result.methods.map(m => m.type);
      expect(types).toContain('cookie-session');
      expect(types).toContain('jwt-localstorage');
      expect(types).toContain('bearer-header');
      expect(types).toContain('csrf-token');
    });

    test('bearer-header extractionHint references storage when JWT found', () => {
      const result = detectAuth({
        ...emptyInput,
        localStorageEntries: [{ key: 'token', value: FAKE_JWT }],
        networkRequests: [
          {
            url: 'https://api.example.com/data',
            method: 'GET',
            requestHeaders: { Authorization: '[REDACTED]' },
          },
        ],
      });
      const bearer = findMethod(result.methods, 'bearer-header');
      expect(bearer.extractionHint).toContain('storage');
    });

    test('every method has type, details, and extractionHint', () => {
      const result = detectAuth({
        cookies: [{ name: 'connect.sid', value: 'abc' }],
        localStorageEntries: [{ key: 'jwt', value: FAKE_JWT }],
        sessionStorageEntries: [{ key: 'auth', value: FAKE_JWT }],
        networkRequests: [
          {
            url: 'https://api.example.com/data',
            method: 'GET',
            requestHeaders: { 'X-API-Key': 'my-key-12345' },
          },
        ],
        csrfDomTokens: [{ source: 'meta', name: '_csrf', value: 'token' }],
        windowGlobals: [
          {
            path: '__NEXT_DATA__',
            value: { props: { session: { user: { id: '1' } } } },
          },
        ],
      });

      expect(result.methods.length).toBeGreaterThan(0);
      for (const method of result.methods) {
        expect(typeof method.type).toBe('string');
        expect(method.type.length).toBeGreaterThan(0);
        expect(typeof method.details).toBe('string');
        expect(method.details.length).toBeGreaterThan(0);
        expect(typeof method.extractionHint).toBe('string');
        expect(method.extractionHint.length).toBeGreaterThan(0);
      }
    });
  });
});
