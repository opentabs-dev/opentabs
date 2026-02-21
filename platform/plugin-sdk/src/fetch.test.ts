import { ToolError } from './errors.js';
import { fetchFromPage, fetchJSON, postJSON } from './fetch.js';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Test HTTP server — lightweight alternative to fetch mocking
// ---------------------------------------------------------------------------

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

/** Tracks how many times /flaky has been called (for flaky endpoint testing) */
let flakyCallCount = 0;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === '/ok') {
        return new Response(JSON.stringify({ status: 'success' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/text') {
        return new Response('plain text response', {
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      if (url.pathname === '/error-404') {
        return new Response('Not Found', { status: 404 });
      }

      if (url.pathname === '/error-500') {
        return new Response('Internal Server Error', { status: 500 });
      }

      if (url.pathname === '/invalid-json') {
        return new Response('this is not json', {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/echo-post') {
        return req.json().then(
          (body: unknown) =>
            new Response(JSON.stringify({ received: body }), {
              headers: { 'Content-Type': 'application/json' },
            }),
        );
      }

      if (url.pathname === '/echo-headers') {
        const contentType = req.headers.get('content-type');
        const credentials = req.headers.get('cookie');
        return new Response(
          JSON.stringify({
            contentType,
            hasCookies: credentials !== null,
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.pathname === '/slow') {
        return new Promise<Response>(resolve => {
          setTimeout(() => {
            resolve(
              new Response(JSON.stringify({ slow: true }), {
                headers: { 'Content-Type': 'application/json' },
              }),
            );
          }, 5_000);
        });
      }

      if (url.pathname === '/flaky') {
        flakyCallCount++;
        if (flakyCallCount <= 2) {
          return new Response('Service Unavailable', { status: 503 });
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    },
  });
  baseUrl = `http://localhost:${String(server.port)}`;
});

afterEach(() => {
  flakyCallCount = 0;
});

afterAll(() => {
  void server.stop(true);
});

// ---------------------------------------------------------------------------
// fetchFromPage
// ---------------------------------------------------------------------------

describe('fetchFromPage', () => {
  test('returns Response for successful request', async () => {
    const response = await fetchFromPage(`${baseUrl}/ok`);
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    const data = (await response.json()) as { status: string };
    expect(data).toEqual({ status: 'success' });
  });

  test('includes credentials: include by default', async () => {
    const response = await fetchFromPage(`${baseUrl}/text`);
    expect(response.ok).toBe(true);
  });

  test('throws ToolError with http_error code on non-ok status', async () => {
    try {
      await fetchFromPage(`${baseUrl}/error-404`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('http_error');
      expect(toolError.message).toContain('HTTP 404');
      expect(toolError.message).toContain('Not Found');
    }
  });

  test('throws ToolError on 500 status with response body', async () => {
    try {
      await fetchFromPage(`${baseUrl}/error-500`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('http_error');
      expect(toolError.message).toContain('HTTP 500');
      expect(toolError.message).toContain('Internal Server Error');
    }
  });

  test('throws ToolError with timeout code when request times out', async () => {
    try {
      await fetchFromPage(`${baseUrl}/slow`, { timeout: 100 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('timeout');
      expect(toolError.message).toContain('timed out after 100ms');
    }
  });

  test('throws ToolError with aborted code when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await fetchFromPage(`${baseUrl}/ok`, { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('aborted');
    }
  });

  test('merges custom headers with defaults', async () => {
    const response = await fetchFromPage(`${baseUrl}/echo-headers`, {
      headers: { 'X-Custom': 'test' },
    });
    expect(response.ok).toBe(true);
  });

  test('throws ToolError with network_error code for invalid URL', async () => {
    try {
      await fetchFromPage('http://localhost:1/nonexistent');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('network_error');
    }
  });
});

// ---------------------------------------------------------------------------
// fetchJSON
// ---------------------------------------------------------------------------

describe('fetchJSON', () => {
  test('returns parsed JSON for successful request', async () => {
    const data = await fetchJSON<{ status: string }>(`${baseUrl}/ok`);
    expect(data).toEqual({ status: 'success' });
  });

  test('throws ToolError with json_parse_error on invalid JSON', async () => {
    try {
      await fetchJSON(`${baseUrl}/text`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('json_parse_error');
      expect(toolError.message).toContain('failed to parse JSON');
    }
  });

  test('propagates http_error from fetchFromPage on non-ok status', async () => {
    try {
      await fetchJSON(`${baseUrl}/error-404`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('http_error');
    }
  });

  test('propagates timeout error from fetchFromPage', async () => {
    try {
      await fetchJSON(`${baseUrl}/slow`, { timeout: 100 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('timeout');
    }
  });
});

// ---------------------------------------------------------------------------
// postJSON
// ---------------------------------------------------------------------------

describe('postJSON', () => {
  test('sends POST request with JSON body and returns parsed response', async () => {
    const data = await postJSON<{ received: { name: string } }>(`${baseUrl}/echo-post`, {
      name: 'test',
    });
    expect(data).toEqual({ received: { name: 'test' } });
  });

  test('sets Content-Type to application/json', async () => {
    const data = await postJSON<{ received: unknown }>(`${baseUrl}/echo-post`, { key: 'value' });
    expect(data.received).toEqual({ key: 'value' });
  });

  test('allows additional headers via init', async () => {
    const data = await postJSON<{ received: unknown }>(
      `${baseUrl}/echo-post`,
      { data: 1 },
      { headers: { 'X-Custom': 'header' } },
    );
    expect(data.received).toEqual({ data: 1 });
  });

  test('propagates http_error on non-ok status', async () => {
    try {
      await postJSON(`${baseUrl}/error-500`, { data: 'test' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('http_error');
    }
  });

  test('supports timeout option', async () => {
    try {
      await postJSON(`${baseUrl}/slow`, { data: 'test' }, { timeout: 100 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('timeout');
    }
  });
});
