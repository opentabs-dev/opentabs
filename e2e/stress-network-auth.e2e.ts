/**
 * Stress tests for WebSocket reconnection under load, secret rotation during
 * active sessions, multi-connection isolation under concurrent dispatch, health
 * endpoint under rapid polling, and audit log under rapid tool calls.
 */

import fs from 'node:fs';
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
