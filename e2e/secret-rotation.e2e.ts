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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createTestConfigDir,
  expect,
  fetchHealth,
  startMcpServer,
  test,
} from './fixtures.js';
import { waitForLog } from './helpers.js';

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
      fs.writeFileSync(authPath, `${JSON.stringify({ secret: newSecret })}\n`, 'utf-8');

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
      let oldClientSucceeded = false;
      try {
        await oldClient.initialize();
        oldClientSucceeded = true;
      } catch (err: unknown) {
        // Expected: server rejects the old secret with 401 Unauthorized
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toMatch(/401|Unauthorized/i);
      } finally {
        await oldClient.close();
      }
      if (oldClientSucceeded) {
        throw new Error('Old secret should have been rejected but initialize() succeeded');
      }
    } finally {
      await server.kill();
    }
  });

  test('double rotation (A→B→C): only final secret C is valid, A and B both rejected', async () => {
    const server = await startMcpServer(configDir, true);
    try {
      await server.waitForHealth(h => h.status === 'ok');

      const secretA = server.secret;
      if (!secretA) throw new Error('Expected server to have a secret');

      // Verify secret A works
      const auditA = await fetch(`http://localhost:${server.port}/audit`, {
        headers: { Authorization: `Bearer ${secretA}` },
        signal: AbortSignal.timeout(5_000),
      });
      expect(auditA.status).toBe(200);

      // --- First rotation: A → B ---
      const secretB = `rotated-b-${crypto.randomUUID()}`;
      const authPath = path.join(configDir, 'extension', 'auth.json');
      fs.writeFileSync(authPath, `${JSON.stringify({ secret: secretB })}\n`, 'utf-8');

      server.logs.length = 0;
      const reloadAtoB = await fetch(`http://localhost:${server.port}/reload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretA}` },
        signal: AbortSignal.timeout(10_000),
      });
      expect(reloadAtoB.ok).toBe(true);
      await waitForLog(server, 'Config reload complete', 10_000);

      // After first rotation: A rejected, B works
      const auditAAfterFirst = await fetch(`http://localhost:${server.port}/audit`, {
        headers: { Authorization: `Bearer ${secretA}` },
        signal: AbortSignal.timeout(5_000),
      });
      expect(auditAAfterFirst.status).toBe(401);

      const auditBAfterFirst = await fetch(`http://localhost:${server.port}/audit`, {
        headers: { Authorization: `Bearer ${secretB}` },
        signal: AbortSignal.timeout(5_000),
      });
      expect(auditBAfterFirst.status).toBe(200);

      // --- Second rotation: B → C ---
      const secretC = `rotated-c-${crypto.randomUUID()}`;
      fs.writeFileSync(authPath, `${JSON.stringify({ secret: secretC })}\n`, 'utf-8');

      server.logs.length = 0;
      const reloadBtoC = await fetch(`http://localhost:${server.port}/reload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretB}` },
        signal: AbortSignal.timeout(10_000),
      });
      expect(reloadBtoC.ok).toBe(true);
      await waitForLog(server, 'Config reload complete', 10_000);

      // After second rotation: A rejected, B rejected, C works
      const auditAFinal = await fetch(`http://localhost:${server.port}/audit`, {
        headers: { Authorization: `Bearer ${secretA}` },
        signal: AbortSignal.timeout(5_000),
      });
      expect(auditAFinal.status).toBe(401);

      const auditBFinal = await fetch(`http://localhost:${server.port}/audit`, {
        headers: { Authorization: `Bearer ${secretB}` },
        signal: AbortSignal.timeout(5_000),
      });
      expect(auditBFinal.status).toBe(401);

      const auditCFinal = await fetch(`http://localhost:${server.port}/audit`, {
        headers: { Authorization: `Bearer ${secretC}` },
        signal: AbortSignal.timeout(5_000),
      });
      expect(auditCFinal.status).toBe(200);

      // MCP client with final secret C initializes successfully
      const clientC = createMcpClient(server.port, secretC);
      await clientC.initialize();
      try {
        const tools = await clientC.listTools();
        expect(tools.length).toBeGreaterThan(0);
      } finally {
        await clientC.close();
      }
    } finally {
      await server.kill();
    }
  });
});
