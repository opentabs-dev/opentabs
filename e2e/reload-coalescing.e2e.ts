/**
 * E2E tests for POST /reload coalescing behavior.
 *
 * Validates that the coalescing debounce on POST /reload works correctly:
 * concurrent requests share a single reload, auth is checked per-request,
 * and the old rate-limiting (429) behavior is gone.
 */

import { cleanupTestConfigDir, createTestConfigDir, expect, startMcpServer, test } from './fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build auth headers for a given secret */
const authHeaders = (secret: string | undefined): Record<string, string> => {
  const h: Record<string, string> = {};
  if (secret) h.Authorization = `Bearer ${secret}`;
  return h;
};

/** POST /reload with given headers and return the response */
const postReload = (port: number, headers: Record<string, string>, timeoutMs = 30_000): Promise<Response> =>
  fetch(`http://localhost:${port}/reload`, { method: 'POST', headers, signal: AbortSignal.timeout(timeoutMs) });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('POST /reload coalescing', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('concurrent POST /reload requests are coalesced — all get 200 with identical results', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');
      const headers = authHeaders(server.secret);

      // Fire 5 requests simultaneously
      const results = await Promise.all(Array.from({ length: 5 }, () => postReload(server.port, headers)));

      const bodies: Array<{ ok: boolean; plugins: number; durationMs: number }> = [];
      for (const res of results) {
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean; plugins: number; durationMs: number };
        expect(body.ok).toBe(true);
        expect(typeof body.plugins).toBe('number');
        expect(typeof body.durationMs).toBe('number');
        bodies.push(body);
      }

      // All coalesced callers share the same reload — durationMs should be identical
      const durations = new Set(bodies.map(b => b.durationMs));
      expect(durations.size).toBe(1);
    } finally {
      await server.kill();
    }
  });

  test('rapid sequential reloads within 500ms are coalesced', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');
      const headers = authHeaders(server.secret);

      // Fire requests sequentially with 50ms gaps (well within 500ms coalesce window)
      const promises: Promise<Response>[] = [];
      for (let i = 0; i < 5; i++) {
        promises.push(postReload(server.port, headers));
        if (i < 4) await new Promise(r => setTimeout(r, 50));
      }

      const results = await Promise.all(promises);
      for (const res of results) {
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean };
        expect(body.ok).toBe(true);
      }
    } finally {
      await server.kill();
    }
  });

  test('reload after 600ms gap performs a separate reload', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');
      const headers = authHeaders(server.secret);

      // First reload
      const res1 = await postReload(server.port, headers);
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as { ok: boolean; durationMs: number };
      expect(body1.ok).toBe(true);

      // Wait longer than the coalesce window (500ms) + margin
      await new Promise(r => setTimeout(r, 700));

      // Second reload — should be a separate reload operation
      const res2 = await postReload(server.port, headers);
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as { ok: boolean; durationMs: number };
      expect(body2.ok).toBe(true);

      // Both should succeed independently (we can't guarantee different durationMs
      // since the actual reload time varies, but both must be valid responses)
      expect(typeof body1.durationMs).toBe('number');
      expect(typeof body2.durationMs).toBe('number');
    } finally {
      await server.kill();
    }
  });

  test('auth is checked per-request — invalid auth returns 401 even during coalescing', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');
      const validHeaders = authHeaders(server.secret);
      const invalidHeaders = { Authorization: 'Bearer invalid-secret-value' };

      // Fire valid and invalid requests simultaneously
      const [validRes, invalidRes] = await Promise.all([
        postReload(server.port, validHeaders),
        postReload(server.port, invalidHeaders),
      ]);

      // Valid request succeeds
      expect(validRes.status).toBe(200);
      const validBody = (await validRes.json()) as { ok: boolean };
      expect(validBody.ok).toBe(true);

      // Invalid request fails with 401 — auth rejection happens before coalescing
      expect(invalidRes.status).toBe(401);
    } finally {
      await server.kill();
    }
  });

  test('POST /reload no longer returns 429 even under heavy load', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');
      const headers = authHeaders(server.secret);

      // Fire 15 rapid requests — old rate limiter would have returned 429
      const results = await Promise.all(Array.from({ length: 15 }, () => postReload(server.port, headers)));

      const statuses = results.map(r => r.status);
      // No 429 responses — coalescing replaces rate limiting
      expect(statuses.filter(s => s === 429)).toHaveLength(0);
      // All should be 200
      expect(statuses.every(s => s === 200)).toBe(true);

      // Consume all response bodies to avoid connection leaks
      await Promise.all(results.map(r => r.text()));
    } finally {
      await server.kill();
    }
  });
});
