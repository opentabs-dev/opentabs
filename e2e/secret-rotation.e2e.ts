/**
 * E2E test for secret rotation via POST /reload.
 *
 * Reproduces the exact flow of `opentabs config rotate-secret`:
 *   1. Write new secret to auth.json
 *   2. POST /reload with the OLD secret (server still has old secret in memory)
 *   3. Server reloads and picks up the new secret
 *   4. Old secret is rejected, new secret works
 *
 * This is a server-only test — no browser/extension required.
 */

import {
  test,
  expect,
  startMcpServer,
  createTestConfigDir,
  cleanupTestConfigDir,
  createMcpClient,
  fetchHealth,
} from './fixtures.js';
import { waitForLog } from './helpers.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

test.describe('POST /reload authentication enforcement', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('POST /reload without Bearer auth returns 401', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://localhost:${server.port}/reload`, {
        method: 'POST',
        signal: AbortSignal.timeout(5_000),
      });
      expect(res.status).toBe(401);
    } finally {
      await server.kill();
    }
  });

  test('POST /reload with incorrect Bearer token returns 401', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const res = await fetch(`http://localhost:${server.port}/reload`, {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token-that-is-not-valid' },
        signal: AbortSignal.timeout(5_000),
      });
      expect(res.status).toBe(401);
    } finally {
      await server.kill();
    }
  });
});

test.describe('Secret rotation via POST /reload', () => {
  let configDir = '';

  test.beforeEach(() => {
    configDir = createTestConfigDir();
  });

  test.afterEach(() => {
    if (configDir) cleanupTestConfigDir(configDir);
  });

  test('server accepts new secret and rejects old secret after rotation', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const oldSecret = server.secret;
      if (!oldSecret) throw new Error('Expected server to have a secret');

      // Verify the old secret works: authenticated /health returns full details
      const healthBefore = await fetchHealth(server.port, oldSecret);
      expect(healthBefore).not.toBeNull();
      expect(healthBefore?.status).toBe('ok');
      expect(healthBefore?.plugins).toBeDefined();

      // Verify the old secret works: /audit requires auth and returns 200
      const auditBefore = await fetch(`http://localhost:${server.port}/audit`, {
        headers: { Authorization: `Bearer ${oldSecret}` },
        signal: AbortSignal.timeout(5_000),
      });
      expect(auditBefore.status).toBe(200);

      // --- Rotate the secret (same steps as `opentabs config rotate-secret`) ---

      // Step 1: Write new secret to auth.json
      const newSecret = `rotated-${crypto.randomUUID()}`;
      expect(newSecret).not.toBe(oldSecret);
      const authPath = path.join(configDir, 'extension', 'auth.json');
      fs.writeFileSync(authPath, JSON.stringify({ secret: newSecret }) + '\n', 'utf-8');

      // Step 2: POST /reload using the OLD secret (server still has old in memory)
      server.logs.length = 0;
      const reloadRes = await fetch(`http://localhost:${server.port}/reload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${oldSecret}` },
        signal: AbortSignal.timeout(10_000),
      });
      expect(reloadRes.ok).toBe(true);

      // Wait for reload to complete
      await waitForLog(server, 'Config reload complete', 10_000);

      // --- Verify the rotation took effect ---

      // The OLD secret should now be rejected on strict-auth endpoints (401)
      const auditAfterOld = await fetch(`http://localhost:${server.port}/audit`, {
        headers: { Authorization: `Bearer ${oldSecret}` },
        signal: AbortSignal.timeout(5_000),
      });
      expect(auditAfterOld.status).toBe(401);

      // The OLD secret should get only minimal /health (no plugins field)
      const healthOld = await fetch(`http://localhost:${server.port}/health`, {
        headers: { Authorization: `Bearer ${oldSecret}` },
        signal: AbortSignal.timeout(5_000),
      });
      expect(healthOld.status).toBe(200);
      const healthOldBody = (await healthOld.json()) as Record<string, unknown>;
      expect(healthOldBody.plugins).toBeUndefined();

      // The NEW secret should get full /health (with plugins field)
      const healthAfter = await fetchHealth(server.port, newSecret);
      expect(healthAfter).not.toBeNull();
      expect(healthAfter?.status).toBe('ok');
      expect(healthAfter?.plugins).toBeDefined();

      // The NEW secret should work on strict-auth endpoints
      const auditAfterNew = await fetch(`http://localhost:${server.port}/audit`, {
        headers: { Authorization: `Bearer ${newSecret}` },
        signal: AbortSignal.timeout(5_000),
      });
      expect(auditAfterNew.status).toBe(200);

      // MCP client with new secret can initialize and list tools
      const newClient = createMcpClient(server.port, newSecret);
      await newClient.initialize();
      try {
        const tools = await newClient.listTools();
        expect(tools.length).toBeGreaterThan(0);
      } finally {
        await newClient.close();
      }

      // MCP client with old secret is rejected
      const oldClient = createMcpClient(server.port, oldSecret);
      try {
        await oldClient.initialize();
        throw new Error('Expected old-secret client to be rejected during initialize');
      } catch (err: unknown) {
        // Expected: server rejects the old secret with 401 Unauthorized
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toMatch(/401|Unauthorized/i);
      } finally {
        await oldClient.close();
      }
    } finally {
      await server.kill();
    }
  });
});
