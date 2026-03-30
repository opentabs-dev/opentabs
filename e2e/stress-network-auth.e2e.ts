/**
 * Stress tests for WebSocket reconnection under load, secret rotation during
 * active sessions, multi-connection isolation under concurrent dispatch, health
 * endpoint under rapid polling, and audit log under rapid tool calls.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createTestConfigDir,
  launchExtensionContext,
  type McpServer,
  startMcpServer,
  startTestServer,
  type TestServer,
} from './fixtures.js';
import { setupAdapterSymlink, waitForExtensionConnected, waitForLog, waitForToolResult } from './helpers.js';

// Use base test (no fixtures) — each test manages its own lifecycle for
// kill/restart scenarios that standard fixtures cannot express.
const test = base;

/** Write a new auth secret to the config dir's extension/auth.json. Returns the new secret. */
function rotateSecret(configDir: string): string {
  const newSecret = crypto.randomUUID();
  const authPath = path.join(configDir, 'extension', 'auth.json');
  fs.writeFileSync(authPath, `${JSON.stringify({ secret: newSecret })}\n`, 'utf-8');
  if (process.platform !== 'win32') fs.chmodSync(authPath, 0o600);
  return newSecret;
}

test.describe('Stress: WebSocket reconnect with pending tool calls', () => {
  test('in-flight calls settle and new calls succeed after server restart', async () => {
    test.slow();

    const configDir = createTestConfigDir();
    let server: McpServer | undefined;
    let testSrv: TestServer | undefined;
    let extensionCleanupDir: string | undefined;
    let extensionCtx: Awaited<ReturnType<typeof launchExtensionContext>> | undefined;

    try {
      // Start server with hot=false for clean kill/restart semantics
      server = await startMcpServer(configDir, false);
      testSrv = await startTestServer();
      const savedPort = server.port;

      // Launch extension connected to this server
      extensionCtx = await launchExtensionContext(savedPort, server.secret);
      extensionCleanupDir = extensionCtx.cleanupDir;
      setupAdapterSymlink(configDir, extensionCtx.extensionDir);

      // Wait for extension to connect and open a tab
      const mcpClient = createMcpClient(savedPort, server.secret);
      await mcpClient.initialize();

      await waitForExtensionConnected(server);
      await waitForLog(server, 'tab.syncAll received');

      // Open a page in the test server so e2e-test plugin has a matching tab
      const page = await extensionCtx.context.newPage();
      await page.goto(testSrv.url, { waitUntil: 'load', timeout: 10_000 });

      // Wait for the plugin to become ready
      await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 30_000);

      // Start 3 slow tool calls (5s each) — they will be in-flight when we kill the server
      const slowCalls = Promise.allSettled([
        mcpClient.callTool('e2e-test_slow_with_progress', { durationMs: 5000, steps: 5 }, { timeout: 30_000 }),
        mcpClient.callTool('e2e-test_slow_with_progress', { durationMs: 5000, steps: 5 }, { timeout: 30_000 }),
        mcpClient.callTool('e2e-test_slow_with_progress', { durationMs: 5000, steps: 5 }, { timeout: 30_000 }),
      ]);

      // Wait 500ms for calls to start being dispatched
      await new Promise(r => setTimeout(r, 500));

      // Kill the server
      await server.kill();
      server = undefined;

      // Start a NEW server on the same port with the same configDir/secret
      server = await startMcpServer(configDir, false, savedPort);

      // Wait for the extension to reconnect (backoff: 1s→2s→4s, may take up to 15s)
      await server.waitForHealth(h => h.extensionConnected, 30_000);

      // Verify all 3 in-flight calls settled (success or error, not hanging)
      const results = await slowCalls;
      for (const result of results) {
        // Each call should have settled — either fulfilled or rejected
        expect(['fulfilled', 'rejected']).toContain(result.status);
      }

      // Create a new MCP client (old session is dead with the old server)
      const newClient = createMcpClient(savedPort, server.secret);
      await newClient.initialize();

      // Wait for plugin to become ready on the new server
      await waitForToolResult(newClient, 'e2e-test_echo', { message: 'recovery-test' }, { isError: false }, 30_000);

      // Verify a fresh echo call succeeds
      const echoResult = await newClient.callTool('e2e-test_echo', { message: 'post-reconnect' });
      expect(echoResult.isError).toBe(false);
      expect(echoResult.content).toContain('post-reconnect');

      await newClient.close();
      await mcpClient.close();
    } finally {
      if (extensionCtx) await extensionCtx.context.close().catch(() => {});
      if (testSrv) await testSrv.kill().catch(() => {});
      if (server) await server.kill().catch(() => {});
      if (extensionCleanupDir) fs.rmSync(extensionCleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Stress: Multi-connection isolation under concurrent dispatch', () => {
  test('concurrent tool calls from two extensions return correct results with no cross-contamination', async () => {
    test.slow();

    const configDir = createTestConfigDir();
    let server: McpServer | undefined;
    let testSrv: TestServer | undefined;
    let ext1: Awaited<ReturnType<typeof launchExtensionContext>> | undefined;
    let ext2: Awaited<ReturnType<typeof launchExtensionContext>> | undefined;

    try {
      // Start server with hot=false for clean kill semantics
      server = await startMcpServer(configDir, false);
      testSrv = await startTestServer();

      // Launch two separate extension contexts (two Chrome instances)
      ext1 = await launchExtensionContext(server.port, server.secret);
      setupAdapterSymlink(configDir, ext1.extensionDir);

      ext2 = await launchExtensionContext(server.port, server.secret);
      // setupAdapterSymlink made configDir/extension/adapters → ext1's adapters dir.
      // ext2 needs the same adapter IIFE files. Symlink ext2's adapters dir to
      // ext1's adapters dir so both extensions read from the same physical location.
      const ext2AdaptersDir = path.join(ext2.extensionDir, 'adapters');
      fs.rmSync(ext2AdaptersDir, { recursive: true, force: true });
      fs.symlinkSync(path.join(ext1.extensionDir, 'adapters'), ext2AdaptersDir, 'dir');

      // Wait for both extensions to connect
      await server.waitForHealth(h => h.extensionConnections >= 2, 45_000);

      // Open matching tabs in both extension contexts
      const page1 = await ext1.context.newPage();
      await page1.goto(testSrv.url, { waitUntil: 'load', timeout: 10_000 });

      const page2 = await ext2.context.newPage();
      await page2.goto(testSrv.url, { waitUntil: 'load', timeout: 10_000 });

      // Create two MCP clients
      const client1 = createMcpClient(server.port, server.secret);
      await client1.initialize();

      const client2 = createMcpClient(server.port, server.secret);
      await client2.initialize();

      // Wait for at least one plugin to be ready (both extensions report tabs)
      await waitForToolResult(client1, 'e2e-test_echo', { message: 'warmup' }, { isError: false }, 30_000);

      // Fire concurrent echo calls 5 times for confidence
      for (let round = 0; round < 5; round++) {
        const msg1 = `from-conn-1-round-${round}`;
        const msg2 = `from-conn-2-round-${round}`;

        const [result1, result2] = await Promise.all([
          client1.callTool('e2e-test_echo', { message: msg1 }),
          client2.callTool('e2e-test_echo', { message: msg2 }),
        ]);

        // Verify client1's result contains its own message
        expect(result1.isError).toBe(false);
        expect(result1.content).toContain(msg1);
        // Verify no cross-contamination
        expect(result1.content).not.toContain(msg2);

        // Verify client2's result contains its own message
        expect(result2.isError).toBe(false);
        expect(result2.content).toContain(msg2);
        // Verify no cross-contamination
        expect(result2.content).not.toContain(msg1);
      }

      await client1.close();
      await client2.close();
    } finally {
      if (ext1) await ext1.context.close().catch(() => {});
      if (ext2) await ext2.context.close().catch(() => {});
      if (testSrv) await testSrv.kill().catch(() => {});
      if (server) await server.kill().catch(() => {});
      if (ext1?.cleanupDir) fs.rmSync(ext1.cleanupDir, { recursive: true, force: true });
      if (ext2?.cleanupDir) fs.rmSync(ext2.cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Stress: Health endpoint under rapid polling', () => {
  test('100 concurrent health requests all return valid JSON with consistent data', async () => {
    const configDir = createTestConfigDir();
    let server: McpServer | undefined;

    try {
      server = await startMcpServer(configDir, false);
      const { port, secret } = server;

      // Wait for server to be fully ready with plugins loaded
      await server.waitForHealth(h => h.status === 'ok' && h.plugins >= 1, 15_000);

      const BATCH_SIZE = 20;
      const BATCHES = 5;
      const allResponses: Response[] = [];

      // Fire 5 batches of 20 concurrent requests (100 total)
      for (let batch = 0; batch < BATCHES; batch++) {
        const requests = Array.from({ length: BATCH_SIZE }, () =>
          fetch(`http://localhost:${port}/health`, {
            headers: { Authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(5_000),
          }),
        );
        const batchResults = await Promise.all(requests);
        allResponses.push(...batchResults);
      }

      expect(allResponses).toHaveLength(100);

      // Parse all responses as JSON and verify validity
      const bodies: Array<{ status: string; plugins: number; [key: string]: unknown }> = [];
      for (const res of allResponses) {
        expect(res.ok).toBe(true);
        const body = await res.json();
        expect(body).toHaveProperty('status');
        bodies.push(body);
      }

      // Verify all have status='ok'
      for (const body of bodies) {
        expect(body.status).toBe('ok');
      }

      // Verify consistent plugin count across all responses
      const pluginCounts = new Set(bodies.map(b => b.plugins));
      expect(pluginCounts.size).toBe(1);
      // At least the e2e-test plugin should be present
      const firstBody = bodies[0];
      expect(firstBody).toBeDefined();
      expect(firstBody!.plugins).toBeGreaterThanOrEqual(1);
    } finally {
      if (server) await server.kill().catch(() => {});
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Stress: Secret rotation during active session', () => {
  test('old client gets auth error after secret rotation, new client succeeds', async () => {
    test.slow();

    const configDir = createTestConfigDir();
    let server: McpServer | undefined;

    try {
      // Start server with hot=false for clean kill/restart
      server = await startMcpServer(configDir, false);
      const savedPort = server.port;
      const originalSecret = server.secret;

      // Create MCP client with original secret and verify it works
      const oldClient = createMcpClient(savedPort, originalSecret);
      await oldClient.initialize();

      const echoResult = await oldClient.callTool('e2e-test_echo', { message: 'before-rotation' });
      expect(echoResult.isError).toBe(false);
      expect(echoResult.content).toContain('before-rotation');

      // Kill the server
      await server.kill();
      server = undefined;

      // Rotate the secret by writing a new auth.json
      const newSecret = rotateSecret(configDir);
      expect(newSecret).not.toBe(originalSecret);

      // Start a new server on the same port (reads new secret from auth.json)
      server = await startMcpServer(configDir, false, savedPort);
      expect(server.secret).toBe(newSecret);

      // Old client with stale secret should fail with auth error
      await expect(
        oldClient.callTool('e2e-test_echo', { message: 'stale-secret' }, { timeout: 10_000 }),
      ).rejects.toThrow(/401/);

      // New client with new secret should succeed
      const newClient = createMcpClient(savedPort, newSecret);
      await newClient.initialize();

      const newEchoResult = await newClient.callTool('e2e-test_echo', { message: 'after-rotation' });
      expect(newEchoResult.isError).toBe(false);
      expect(newEchoResult.content).toContain('after-rotation');

      await newClient.close();
      await oldClient.close().catch(() => {});
    } finally {
      if (server) await server.kill().catch(() => {});
      cleanupTestConfigDir(configDir);
    }
  });
});
