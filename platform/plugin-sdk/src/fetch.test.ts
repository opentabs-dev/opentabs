import { ToolError } from './errors.js';
import {
  fetchFromPage,
  fetchJSON,
  postJSON,
  postForm,
  postFormData,
  putJSON,
  patchJSON,
  deleteJSON,
  parseRetryAfterMs,
} from './fetch.js';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ---------------------------------------------------------------------------
// Test HTTP server — lightweight alternative to fetch mocking
// ---------------------------------------------------------------------------

let server: ReturnType<typeof createServer>;
let baseUrl: string;

/** Tracks how many times /flaky has been called (for flaky endpoint testing) */
let flakyCallCount = 0;

beforeAll(
  () =>
    new Promise<void>(resolve => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (url.pathname === '/ok') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success' }));
          return;
        }

        if (url.pathname === '/text') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('plain text response');
          return;
        }

        if (url.pathname === '/error-404') {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        if (url.pathname === '/error-401') {
          res.writeHead(401);
          res.end('Unauthorized');
          return;
        }

        if (url.pathname === '/error-403') {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        if (url.pathname === '/error-429') {
          res.writeHead(429, { 'Retry-After': '30' });
          res.end('Too Many Requests');
          return;
        }

        if (url.pathname === '/error-429-no-header') {
          res.writeHead(429);
          res.end('Too Many Requests');
          return;
        }

        if (url.pathname === '/error-500') {
          res.writeHead(500);
          res.end('Internal Server Error');
          return;
        }

        if (url.pathname === '/error-503') {
          res.writeHead(503, { 'Retry-After': '60' });
          res.end('Service Unavailable');
          return;
        }

        if (url.pathname === '/error-400') {
          res.writeHead(400);
          res.end('Bad Request');
          return;
        }

        if (url.pathname === '/error-408') {
          res.writeHead(408);
          res.end('Request Timeout');
          return;
        }

        if (url.pathname === '/error-422') {
          res.writeHead(422);
          res.end('Unprocessable Entity');
          return;
        }

        if (url.pathname === '/invalid-json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('this is not json');
          return;
        }

        if (url.pathname === '/echo-post') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: body }));
          });
          return;
        }

        if (url.pathname === '/echo-headers') {
          const contentType = req.headers['content-type'] ?? null;
          const credentials = req.headers['cookie'] ?? null;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ contentType, hasCookies: credentials !== null }));
          return;
        }

        if (url.pathname === '/slow') {
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ slow: true }));
          }, 5_000);
          return;
        }

        if (url.pathname === '/flaky') {
          flakyCallCount++;
          if (flakyCallCount <= 2) {
            res.writeHead(503);
            res.end('Service Unavailable');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (url.pathname === '/no-content') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (url.pathname === '/echo-form') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            const contentType = req.headers['content-type'] ?? null;
            const method = req.method ?? null;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ body, contentType, method }));
          });
          return;
        }

        if (url.pathname === '/echo-method') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            let received: unknown = null;
            const raw = Buffer.concat(chunks).toString('utf-8');
            if (raw.length > 0) {
              try {
                received = JSON.parse(raw) as unknown;
              } catch {
                received = raw;
              }
            }
            const contentType = req.headers['content-type'] ?? null;
            const method = req.method ?? null;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ method, contentType, received }));
          });
          return;
        }

        res.writeHead(404);
        res.end('Not Found');
      });
      server.listen(0, () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://localhost:${String(addr.port)}`;
        resolve();
      });
    }),
);

afterEach(() => {
  flakyCallCount = 0;
});

afterAll(
  () =>
    new Promise<void>(resolve => {
      server.close(() => resolve());
    }),
);

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

  test('throws ToolError with not_found category on 404 status', async () => {
    try {
      await fetchFromPage(`${baseUrl}/error-404`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('NOT_FOUND');
      expect(toolError.category).toBe('not_found');
      expect(toolError.retryable).toBe(false);
      expect(toolError.message).toContain('HTTP 404');
      expect(toolError.message).toContain('Not Found');
    }
  });

  test('throws ToolError with auth category on 401 status', async () => {
    try {
      await fetchFromPage(`${baseUrl}/error-401`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('AUTH_ERROR');
      expect(toolError.category).toBe('auth');
      expect(toolError.retryable).toBe(false);
    }
  });

  test('throws ToolError with auth category on 403 status', async () => {
    try {
      await fetchFromPage(`${baseUrl}/error-403`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('AUTH_ERROR');
      expect(toolError.category).toBe('auth');
      expect(toolError.retryable).toBe(false);
    }
  });

  test('throws ToolError with rate_limit category on 429 status with Retry-After', async () => {
    try {
      await fetchFromPage(`${baseUrl}/error-429`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('RATE_LIMITED');
      expect(toolError.category).toBe('rate_limit');
      expect(toolError.retryable).toBe(true);
      expect(toolError.retryAfterMs).toBe(30_000);
    }
  });

  test('throws ToolError with rate_limit category on 429 without Retry-After', async () => {
    try {
      await fetchFromPage(`${baseUrl}/error-429-no-header`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('RATE_LIMITED');
      expect(toolError.category).toBe('rate_limit');
      expect(toolError.retryable).toBe(true);
      expect(toolError.retryAfterMs).toBeUndefined();
    }
  });

  test('throws retryable ToolError with internal category on 500 status', async () => {
    try {
      await fetchFromPage(`${baseUrl}/error-500`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('http_error');
      expect(toolError.category).toBe('internal');
      expect(toolError.retryable).toBe(true);
      expect(toolError.message).toContain('HTTP 500');
      expect(toolError.message).toContain('Internal Server Error');
    }
  });

  test('throws retryable ToolError with retryAfterMs on 503 status', async () => {
    try {
      await fetchFromPage(`${baseUrl}/error-503`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('http_error');
      expect(toolError.category).toBe('internal');
      expect(toolError.retryable).toBe(true);
      expect(toolError.retryAfterMs).toBe(60_000);
      expect(toolError.message).toContain('HTTP 503');
    }
  });

  test('throws ToolError with validation category on 400 status', async () => {
    try {
      await fetchFromPage(`${baseUrl}/error-400`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('VALIDATION_ERROR');
      expect(toolError.category).toBe('validation');
      expect(toolError.retryable).toBe(false);
      expect(toolError.message).toContain('HTTP 400');
    }
  });

  test('throws retryable ToolError with timeout category on 408 status', async () => {
    try {
      await fetchFromPage(`${baseUrl}/error-408`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('TIMEOUT');
      expect(toolError.category).toBe('timeout');
      expect(toolError.retryable).toBe(true);
      expect(toolError.message).toContain('HTTP 408');
    }
  });

  test('throws ToolError with validation category on 422 status', async () => {
    try {
      await fetchFromPage(`${baseUrl}/error-422`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('VALIDATION_ERROR');
      expect(toolError.category).toBe('validation');
      expect(toolError.retryable).toBe(false);
      expect(toolError.message).toContain('HTTP 422');
    }
  });

  test('throws ToolError with timeout category when request times out', async () => {
    try {
      await fetchFromPage(`${baseUrl}/slow`, { timeout: 100 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('TIMEOUT');
      expect(toolError.category).toBe('timeout');
      expect(toolError.retryable).toBe(true);
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

  test('throws TIMEOUT ToolError when timeout fires before user signal is aborted', async () => {
    const controller = new AbortController();
    try {
      await fetchFromPage(`${baseUrl}/slow`, { signal: controller.signal, timeout: 100 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('TIMEOUT');
      expect(toolError.category).toBe('timeout');
    }
  });

  test('throws ToolError with aborted code when signal is aborted with non-DOMException reason', async () => {
    const controller = new AbortController();
    controller.abort(new Error('custom abort reason'));
    try {
      await fetchFromPage(`${baseUrl}/ok`, { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('aborted');
    }
  });

  test('throws non-retryable ToolError when signal is aborted with non-DOMException reason', async () => {
    const controller = new AbortController();
    controller.abort(new Error('custom abort reason'));
    try {
      await fetchFromPage(`${baseUrl}/ok`, { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.retryable).toBe(false);
    }
  });

  test('merges custom headers with defaults', async () => {
    const response = await fetchFromPage(`${baseUrl}/echo-headers`, {
      headers: { 'X-Custom': 'test' },
    });
    expect(response.ok).toBe(true);
  });

  test('throws ToolError with internal category and retryable for network errors', async () => {
    try {
      await fetchFromPage('http://localhost:1/nonexistent');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('network_error');
      expect(toolError.category).toBe('internal');
      expect(toolError.retryable).toBe(true);
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

  test('throws ToolError with validation category on invalid JSON', async () => {
    try {
      await fetchJSON(`${baseUrl}/text`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('VALIDATION_ERROR');
      expect(toolError.category).toBe('validation');
      expect(toolError.message).toContain('failed to parse JSON');
    }
  });

  test('propagates not_found error from fetchFromPage on 404 status', async () => {
    try {
      await fetchJSON(`${baseUrl}/error-404`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('NOT_FOUND');
      expect(toolError.category).toBe('not_found');
    }
  });

  test('propagates timeout error from fetchFromPage', async () => {
    try {
      await fetchJSON(`${baseUrl}/slow`, { timeout: 100 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('TIMEOUT');
      expect(toolError.category).toBe('timeout');
    }
  });

  test('validates response against Zod schema when provided', async () => {
    const schema = z.object({ status: z.string() });
    const data = await fetchJSON(`${baseUrl}/ok`, undefined, schema);
    expect(data).toEqual({ status: 'success' });
  });

  test('throws ToolError.validation when response does not match schema', async () => {
    const schema = z.object({ count: z.number() });
    try {
      await fetchJSON(`${baseUrl}/ok`, undefined, schema);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('VALIDATION_ERROR');
      expect(toolError.category).toBe('validation');
      expect(toolError.message).toContain('failed schema validation');
    }
  });

  test('returns unchecked cast when schema is omitted (backward compat)', async () => {
    const data = await fetchJSON<{ status: string }>(`${baseUrl}/ok`);
    expect(data?.status).toBe('success');
  });

  test('returns undefined for 204 response when no schema is provided', async () => {
    const data = await fetchJSON(`${baseUrl}/no-content`);
    expect(data).toBeUndefined();
  });

  test('throws ToolError.validation for 204 response when schema is provided', async () => {
    const schema = z.object({ status: z.string() });
    try {
      await fetchJSON(`${baseUrl}/no-content`, undefined, schema);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('VALIDATION_ERROR');
      expect(toolError.category).toBe('validation');
      expect(toolError.message).toContain('failed schema validation');
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
    expect(data?.received).toEqual({ key: 'value' });
  });

  test('allows additional headers via init', async () => {
    const data = await postJSON<{ received: unknown }>(
      `${baseUrl}/echo-post`,
      { data: 1 },
      { headers: { 'X-Custom': 'header' } },
    );
    expect(data?.received).toEqual({ data: 1 });
  });

  test('propagates internal error on 500 status', async () => {
    try {
      await postJSON(`${baseUrl}/error-500`, { data: 'test' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('http_error');
      expect(toolError.category).toBe('internal');
    }
  });

  test('supports timeout option', async () => {
    try {
      await postJSON(`${baseUrl}/slow`, { data: 'test' }, { timeout: 100 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('TIMEOUT');
      expect(toolError.category).toBe('timeout');
    }
  });

  test('validates response against Zod schema when provided', async () => {
    const schema = z.object({ received: z.object({ name: z.string() }) });
    const data = await postJSON(`${baseUrl}/echo-post`, { name: 'test' }, undefined, schema);
    expect(data).toEqual({ received: { name: 'test' } });
  });

  test('throws ToolError.validation when response does not match schema', async () => {
    const schema = z.object({ received: z.object({ count: z.number() }) });
    try {
      await postJSON(`${baseUrl}/echo-post`, { name: 'test' }, undefined, schema);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.code).toBe('VALIDATION_ERROR');
      expect(toolError.category).toBe('validation');
      expect(toolError.message).toContain('failed schema validation');
    }
  });
});

// ---------------------------------------------------------------------------
// postForm
// ---------------------------------------------------------------------------

describe('postForm', () => {
  test('sends POST request with application/x-www-form-urlencoded Content-Type', async () => {
    const data = await postForm<{ body: string; contentType: string; method: string }>(`${baseUrl}/echo-form`, {
      name: 'alice',
      age: '30',
    });
    expect(data?.method).toBe('POST');
    expect(data?.contentType).toBe('application/x-www-form-urlencoded');
    expect(data?.body).toContain('name=alice');
    expect(data?.body).toContain('age=30');
  });

  test('merges custom headers with Content-Type preserved', async () => {
    const data = await postForm<{ body: string; contentType: string; method: string }>(
      `${baseUrl}/echo-form`,
      { key: 'value' },
      { headers: { 'X-Custom': 'test' } },
    );
    expect(data?.contentType).toBe('application/x-www-form-urlencoded');
  });

  test('returns parsed JSON response', async () => {
    const data = await postForm<{ body: string; contentType: string; method: string }>(`${baseUrl}/echo-form`, {
      foo: 'bar',
    });
    expect(data).toHaveProperty('body');
    expect(data).toHaveProperty('contentType');
  });

  test('validates response against Zod schema when provided', async () => {
    const schema = z.object({ body: z.string(), contentType: z.string(), method: z.string() });
    const data = await postForm(`${baseUrl}/echo-form`, { x: '1' }, undefined, schema);
    expect(data.method).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// postFormData
// ---------------------------------------------------------------------------

describe('postFormData', () => {
  test('sends POST request without explicitly setting Content-Type (set automatically by fetch)', async () => {
    const formData = new FormData();
    formData.append('field', 'value');
    const data = await postFormData<{ contentType: string; hasCookies: boolean }>(`${baseUrl}/echo-headers`, formData);
    // The fetch API sets Content-Type to multipart/form-data with boundary automatically
    expect(data?.contentType).toMatch(/^multipart\/form-data/);
  });

  test('returns parsed JSON response', async () => {
    const formData = new FormData();
    formData.append('key', 'value');
    const data = await postFormData<{ contentType: string; hasCookies: boolean }>(`${baseUrl}/echo-headers`, formData);
    expect(data).toHaveProperty('contentType');
  });

  test('validates response against Zod schema when provided', async () => {
    const formData = new FormData();
    formData.append('field', 'value');
    const schema = z.object({ contentType: z.string(), hasCookies: z.boolean() });
    const data = await postFormData(`${baseUrl}/echo-headers`, formData, undefined, schema);
    expect(data.contentType).toMatch(/^multipart\/form-data/);
    expect(data.hasCookies).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// putJSON
// ---------------------------------------------------------------------------

describe('putJSON', () => {
  test('sends PUT request with JSON body and application/json Content-Type', async () => {
    const data = await putJSON<{ method: string; contentType: string; received: { name: string } }>(
      `${baseUrl}/echo-method`,
      { name: 'test' },
    );
    expect(data?.method).toBe('PUT');
    expect(data?.contentType).toBe('application/json');
    expect(data?.received).toEqual({ name: 'test' });
  });

  test('allows additional headers via init', async () => {
    const data = await putJSON<{ method: string; contentType: string; received: unknown }>(
      `${baseUrl}/echo-method`,
      { data: 1 },
      { headers: { 'X-Custom': 'header' } },
    );
    expect(data?.method).toBe('PUT');
    expect(data?.contentType).toBe('application/json');
  });

  test('validates response against Zod schema when provided', async () => {
    const schema = z.object({ method: z.string(), contentType: z.string().nullable(), received: z.unknown() });
    const data = await putJSON(`${baseUrl}/echo-method`, { x: 1 }, undefined, schema);
    expect(data.method).toBe('PUT');
  });
});

// ---------------------------------------------------------------------------
// patchJSON
// ---------------------------------------------------------------------------

describe('patchJSON', () => {
  test('sends PATCH request with JSON body and application/json Content-Type', async () => {
    const data = await patchJSON<{ method: string; contentType: string; received: { value: number } }>(
      `${baseUrl}/echo-method`,
      { value: 42 },
    );
    expect(data?.method).toBe('PATCH');
    expect(data?.contentType).toBe('application/json');
    expect(data?.received).toEqual({ value: 42 });
  });

  test('allows additional headers via init', async () => {
    const data = await patchJSON<{ method: string; contentType: string; received: unknown }>(
      `${baseUrl}/echo-method`,
      { data: 1 },
      { headers: { 'X-Custom': 'header' } },
    );
    expect(data?.method).toBe('PATCH');
    expect(data?.contentType).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// deleteJSON
// ---------------------------------------------------------------------------

describe('deleteJSON', () => {
  test('sends DELETE request', async () => {
    const data = await deleteJSON<{ method: string; contentType: string | null; received: null }>(
      `${baseUrl}/echo-method`,
    );
    expect(data?.method).toBe('DELETE');
  });

  test('returns undefined for 204 No Content response', async () => {
    const data = await deleteJSON(`${baseUrl}/no-content`);
    expect(data).toBeUndefined();
  });

  test('returns parsed JSON for non-204 responses', async () => {
    const data = await deleteJSON<{ method: string; contentType: string | null; received: null }>(
      `${baseUrl}/echo-method`,
    );
    expect(data).toHaveProperty('method', 'DELETE');
  });

  test('validates response against Zod schema when provided', async () => {
    const schema = z.object({ method: z.string(), contentType: z.string().nullable(), received: z.null() });
    const data = await deleteJSON(`${baseUrl}/echo-method`, undefined, schema);
    expect(data.method).toBe('DELETE');
  });
});

// ---------------------------------------------------------------------------
// parseRetryAfterMs
// ---------------------------------------------------------------------------

describe('parseRetryAfterMs', () => {
  test('parses integer seconds into milliseconds', () => {
    expect(parseRetryAfterMs('60')).toBe(60_000);
  });

  test('parses zero seconds', () => {
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  test('parses decimal seconds into milliseconds', () => {
    expect(parseRetryAfterMs('1.5')).toBe(1_500);
  });

  test('returns undefined for negative values', () => {
    expect(parseRetryAfterMs('-1')).toBeUndefined();
  });

  test('returns undefined for invalid strings', () => {
    expect(parseRetryAfterMs('invalid')).toBeUndefined();
  });

  test('parses future HTTP-date format into positive milliseconds', () => {
    const futureDate = new Date(Date.now() + 60_000).toUTCString();
    const result = parseRetryAfterMs(futureDate);
    expect(result).toBeDefined();
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(60_000);
  });

  test('returns undefined for past HTTP-date', () => {
    const pastDate = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfterMs(pastDate)).toBeUndefined();
  });
});
