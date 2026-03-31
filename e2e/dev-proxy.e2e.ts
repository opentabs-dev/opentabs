/**
 * Dev proxy E2E tests — HTTP buffering, timeout, and restart behavior.
 *
 * These tests verify the dev proxy's request buffering and forwarding
 * mechanisms during worker restarts. The proxy buffers incoming HTTP
 * requests via `whenReady()` while the worker is restarting and drains
 * them once the new worker reports ready via IPC.
 *
 * All tests use dynamic ports and isolated config directories.
 */

import { execSync } from 'node:child_process';
import fs, { readFileSync } from 'node:fs';
import {
  cleanupTestConfigDir,
  createMcpClient,
  createMinimalPlugin,
  createTestConfigDir,
  expect,
  fetchWsInfo,
  readPluginToolNames,
  readTestConfig,
  startMcpServer,
  test,
  writeTestConfig,
} from './fixtures.js';
import {
  parseToolResult,
  setupToolTest,
  waitForExtensionConnected,
  waitForLog,
  waitForToolList,
  waitForToolResult,
} from './helpers.js';

/**
 * Checks whether a process is dead (exited or zombie). On Linux, reads
 * /proc/<pid>/status to detect zombie state (State: Z), which
 * process.kill(pid, 0) cannot distinguish from a running process. Falls
 * back to the signal-zero check on platforms without /proc (e.g. macOS).
 */
const isProcessDead = (pid: number): boolean => {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf-8');
    if (/^State:\s+Z/m.test(status)) return true;
    return false;
  } catch {
    // /proc not available (macOS) or process entry gone (fully reaped)
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }
};

test.describe('Dev proxy request buffering', () => {
  test('HTTP request during worker restart is buffered and succeeds after drain', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      // Verify server is healthy before triggering hot reload
      const initialHealth = await server.health();
      expect(initialHealth).not.toBeNull();
      if (!initialHealth) throw new Error('health returned null');
      expect(initialHealth.status).toBe('ok');

      // Clear logs to isolate hot-reload output
      server.logs.length = 0;

      // Trigger hot reload — the proxy kills the old worker and forks a new one.
      // During the restart window, workerPort is null and requests are buffered
      // in the pending[] array via whenReady().
      server.triggerHotReload();

      // Immediately fire a health request BEFORE the worker reports ready.
      // The proxy's whenReady() buffers this request and forwards it once
      // the new worker sends the IPC 'ready' message with its port.
      const headers: Record<string, string> = {};
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      const response = await fetch(`http://localhost:${server.port}/health`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      // The request should succeed — the proxy buffered it during the restart
      // window and forwarded it to the new worker after drain.
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const body = (await response.json()) as { status: string };
      expect(body.status).toBe('ok');

      // Verify the hot reload actually completed (the request wasn't just
      // served by the old worker before it died)
      await waitForLog(server, 'Hot reload complete', 10_000);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Dev proxy concurrent overlapping reloads', () => {
  test('two rapid SIGUSR1 signals resolve without deadlock or state corruption', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      // Verify server is healthy before triggering overlapping reloads
      const initialHealth = await server.health();
      expect(initialHealth).not.toBeNull();
      if (!initialHealth) throw new Error('health returned null');
      expect(initialHealth.status).toBe('ok');

      // Create an MCP client and initialize a session to verify tools/list
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Verify tools are available before the overlapping reloads
      const toolsBefore = await client.listTools();
      const expectedToolNames = readPluginToolNames();
      for (const name of expectedToolNames) {
        expect(toolsBefore.some(t => t.name === name)).toBe(true);
      }

      // Clear logs to isolate hot-reload output
      server.logs.length = 0;

      // Fire two SIGUSR1 signals in rapid succession (< 100ms apart).
      // The first signal calls startWorker(), which kills the current worker
      // and forks child1. The second signal calls startWorker() again, which
      // kills child1 (before it reports ready) and forks child2. The pending[]
      // callbacks from the first restart are still queued and will be drained
      // when child2 sends its 'ready' IPC message.
      server.triggerHotReload();
      server.triggerHotReload();

      // Wait for the final reload to complete. Only the last worker's 'ready'
      // message triggers "Hot reload complete" — the first worker was killed
      // before it could report ready.
      await waitForLog(server, 'Hot reload complete', 15_000);

      // Verify the server is healthy after overlapping reloads
      const healthAfter = await server.health();
      expect(healthAfter).not.toBeNull();
      if (!healthAfter) throw new Error('health returned null after overlapping reloads');
      expect(healthAfter.status).toBe('ok');

      // Verify tools/list still returns the expected tools. The MCP client
      // auto-reinitializes the session after a worker restart (the new worker
      // has no knowledge of the old session).
      const toolsAfter = await client.listTools();
      for (const name of expectedToolNames) {
        expect(toolsAfter.some(t => t.name === name)).toBe(true);
      }

      // Verify no error logs related to process management or state corruption.
      // Look for unexpected error patterns (not normal proxy log messages).
      const errorPatterns = ['ECONNREFUSED', 'deadlock', 'state corruption', 'uncaughtException'];
      const joinedLogs = server.logs.join('\n');
      for (const pattern of errorPatterns) {
        expect(joinedLogs).not.toContain(pattern);
      }

      await client.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Dev proxy graceful shutdown', () => {
  test('SIGTERM kills worker and proxy exits cleanly', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      // Verify server is healthy before sending SIGTERM
      const initialHealth = await server.health();
      expect(initialHealth).not.toBeNull();
      if (!initialHealth) throw new Error('health returned null');
      expect(initialHealth.status).toBe('ok');

      const port = server.port;
      const proxyPid = server.proc.pid;
      if (proxyPid === undefined) throw new Error('proxy PID is undefined');

      // Find the worker child process before sending SIGTERM so we can
      // verify it is also cleaned up.
      const pgrepOutput = execSync(`pgrep -P ${proxyPid}`, { encoding: 'utf-8' }).trim();
      const workerPids = pgrepOutput
        .split('\n')
        .map(s => Number(s.trim()))
        .filter(n => !Number.isNaN(n) && n > 0);
      expect(workerPids.length).toBeGreaterThan(0);

      // Create a promise that resolves when the proxy process exits.
      // We listen on the ChildProcess 'exit' event directly to capture
      // the exit code and signal.
      const exitPromise = new Promise<{ code: number | null; signal: string | null }>(resolve => {
        server.proc.once('exit', (code, signal) => {
          resolve({ code, signal: signal as string | null });
        });
      });

      // Send SIGTERM directly to the proxy process (not via the fixture's
      // kill() method). The proxy's SIGTERM handler calls worker?.kill('SIGTERM')
      // then process.exit(0).
      process.kill(proxyPid, 'SIGTERM');

      // Wait for the proxy to exit (should be nearly immediate since
      // process.exit(0) is called synchronously in the SIGTERM handler)
      const exitResult = await exitPromise;

      // Verify the proxy exited cleanly. process.exit(0) produces code=0.
      // On some platforms the signal field may also be set.
      expect(exitResult.code === 0 || exitResult.signal === 'SIGTERM').toBe(true);

      // Verify the port is no longer listening — the proxy's HTTP server
      // should be closed. A fetch should fail with ECONNREFUSED.
      const headers: Record<string, string> = {};
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      await expect(
        fetch(`http://localhost:${port}/health`, {
          headers,
          signal: AbortSignal.timeout(3_000),
        }),
      ).rejects.toThrow();

      // Verify no orphaned worker processes remain. After the proxy sends
      // SIGTERM to the worker and calls process.exit(0), the worker should
      // also be dead. Poll each worker PID until it exits (up to 5 seconds)
      // to accommodate slower process teardown in Docker containers.
      // Uses isProcessDead() to detect zombie processes, which linger in
      // the process table in Docker containers without an init process.
      for (const workerPid of workerPids) {
        let dead = false;
        for (let attempt = 0; attempt < 50 && !dead; attempt++) {
          dead = isProcessDead(workerPid);
          if (!dead) await new Promise(r => setTimeout(r, 100));
        }
        expect(dead).toBe(true);
      }
    } finally {
      // The proxy is already dead from SIGTERM, but call kill() defensively
      // in case the test failed before sending SIGTERM. killProcess handles
      // already-exited processes gracefully.
      await server.kill().catch(() => {});
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Dev proxy health during worker restart window', () => {
  test('health returns degraded state during restart, then 200 after worker is ready', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      // Verify server is healthy before the restart transition
      const initialHealth = await server.health();
      expect(initialHealth).not.toBeNull();
      if (!initialHealth) throw new Error('health returned null');
      expect(initialHealth.status).toBe('ok');

      const proxyPid = server.proc.pid;
      if (proxyPid === undefined) throw new Error('proxy PID is undefined');

      // Find the worker child process. Killing it directly (not via SIGUSR1)
      // lets us control the timing: the proxy detects the death and sets
      // workerPort = null.
      const pgrepOutput = execSync(`pgrep -P ${proxyPid}`, { encoding: 'utf-8' }).trim();
      const workerPids = pgrepOutput
        .split('\n')
        .map(s => Number(s.trim()))
        .filter(n => !Number.isNaN(n) && n > 0);
      expect(workerPids.length).toBeGreaterThan(0);

      const headers: Record<string, string> = {};
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      // Kill the worker directly with SIGKILL.
      for (const pid of workerPids) {
        process.kill(pid, 'SIGKILL');
      }

      // Wait for the proxy to detect the worker exit (workerPort = null)
      await waitForLog(server, 'Worker exited', 5_000);

      // With the worker dead and no hot reload triggered, the proxy's
      // whenReady() buffers requests until READY_TIMEOUT_MS (5s). A
      // short client-side abort fires before the server timeout, so the
      // fetch throws and we record status 0 (connection-level failure).
      // This reliably observes the degraded state without depending on a
      // tight race window.
      let degradedStatus: number;
      try {
        const res = await fetch(`http://localhost:${server.port}/health`, {
          headers,
          signal: AbortSignal.timeout(500),
        });
        degradedStatus = res.status;
      } catch {
        degradedStatus = 0;
      }
      expect([0, 502, 503]).toContain(degradedStatus);

      // Trigger a hot reload so a new worker starts.
      server.triggerHotReload();

      // Wait for the new worker to be ready
      await waitForLog(server, 'Hot reload complete', 15_000);

      // Confirm the server is fully healthy after the transition
      const finalHealth = await server.health();
      expect(finalHealth).not.toBeNull();
      if (!finalHealth) throw new Error('health returned null after transition');
      expect(finalHealth.status).toBe('ok');
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Dev proxy 503 timeout', () => {
  test('returns 503 when worker is dead and no restart is triggered', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      // Verify server is healthy before killing the worker
      const initialHealth = await server.health();
      expect(initialHealth).not.toBeNull();
      if (!initialHealth) throw new Error('health returned null');
      expect(initialHealth.status).toBe('ok');

      // Find the worker child process. The proxy (server.proc) forks a worker
      // via child_process.fork(). Use pgrep to find child PIDs of the proxy.
      const proxyPid = server.proc.pid;
      if (proxyPid === undefined) throw new Error('proxy PID is undefined');

      const pgrepOutput = execSync(`pgrep -P ${proxyPid}`, { encoding: 'utf-8' }).trim();
      const workerPids = pgrepOutput
        .split('\n')
        .map(s => Number(s.trim()))
        .filter(n => !Number.isNaN(n) && n > 0);
      expect(workerPids.length).toBeGreaterThan(0);

      // Kill the worker with SIGKILL so it dies immediately. The proxy's exit
      // handler sets worker = null and workerPort = null but does NOT call
      // startWorker() — only SIGUSR1 or file changes trigger a restart.
      for (const pid of workerPids) {
        process.kill(pid, 'SIGKILL');
      }

      // Wait for the proxy to detect the worker exit
      await waitForLog(server, 'Worker exited', 5_000);

      // Send an HTTP request. With no worker running and no restart triggered,
      // the proxy's whenReady() buffers the request for READY_TIMEOUT_MS (5s)
      // then calls the onTimeout callback, returning 503.
      const headers: Record<string, string> = {};
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      const start = Date.now();
      const response = await fetch(`http://localhost:${server.port}/health`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      const elapsed = Date.now() - start;

      expect(response.status).toBe(503);

      // The 503 should arrive after approximately READY_TIMEOUT_MS (5s).
      // Allow margin for scheduling variance: at least 4s, at most 8s.
      expect(elapsed).toBeGreaterThanOrEqual(4_000);
      expect(elapsed).toBeLessThan(8_000);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('POST /reload in non-hot (production) mode', () => {
  test('config rediscovery adds new plugin tools after POST /reload', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);

    try {
      // Verify server is healthy in non-hot mode
      const initialHealth = await server.health();
      expect(initialHealth).not.toBeNull();
      if (!initialHealth) throw new Error('health returned null');
      expect(initialHealth.status).toBe('ok');

      // Create an MCP client and initialize a session
      const client = createMcpClient(server.port, server.secret);
      await client.initialize();

      // Verify only the e2e-test plugin tools are registered initially
      const toolsBefore = await client.listTools();
      const expectedToolNames = readPluginToolNames();
      for (const name of expectedToolNames) {
        expect(toolsBefore.some(t => t.name === name)).toBe(true);
      }

      // Create a minimal plugin in a temp directory. The plugin has a single
      // tool and is fully discoverable by the MCP server after config reload.
      const pluginName = 'reload-test';
      const pluginDir = createMinimalPlugin(configDir, pluginName, [{ name: 'ping', description: 'Returns pong' }]);

      // Update config.json to include the new plugin in localPlugins.
      const config = readTestConfig(configDir);
      config.localPlugins.push(pluginDir);
      writeTestConfig(configDir, config);

      // Read the auth secret for the Bearer token
      const authPath = `${configDir}/extension/auth.json`;
      const authData = JSON.parse(fs.readFileSync(authPath, 'utf-8')) as { secret?: string };
      const secret = authData.secret ?? '';

      // POST /reload triggers performConfigReload(), which re-reads
      // config.json, discovers the new plugin, and rebuilds the registry.
      const reloadResponse = await fetch(`http://localhost:${server.port}/reload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(10_000),
      });

      expect(reloadResponse.ok).toBe(true);
      const reloadBody = (await reloadResponse.json()) as { ok: boolean; plugins: number };
      expect(reloadBody.ok).toBe(true);
      // The reload should discover at least 2 plugins (e2e-test + reload-test)
      expect(reloadBody.plugins).toBeGreaterThanOrEqual(2);

      // After reload, tools/list should include the new plugin's tool.
      // Use waitForToolList to poll until the tool appears (the MCP server
      // sends a listChanged notification, but the client may need to
      // re-initialize the session first).
      const toolsAfter = await waitForToolList(
        client,
        tools => tools.some(t => t.name === `${pluginName}_ping`),
        10_000,
        300,
        `${pluginName}_ping tool to appear`,
      );

      // Verify the new plugin's tool is present
      expect(toolsAfter.some(t => t.name === `${pluginName}_ping`)).toBe(true);

      // Verify the original e2e-test tools are still present
      for (const name of expectedToolNames) {
        expect(toolsAfter.some(t => t.name === name)).toBe(true);
      }

      await client.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe
  .serial('Dev proxy SSE mid-stream worker restart', () => {
    test('SSE tool call gets clean error or completes when worker restarts mid-stream', async ({
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    }) => {
      test.slow();

      const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

      try {
        // Baseline: verify the slow_with_progress tool works normally
        const baseline = await mcpClient.callToolWithProgress(
          'e2e-test_slow_with_progress',
          { durationMs: 500, steps: 2 },
          { timeout: 15_000 },
        );
        expect(baseline.isError).toBe(false);
        const baselineOutput = parseToolResult(baseline.content);
        expect(baselineOutput.completed).toBe(true);

        // Start a slow tool call that produces an SSE stream with progress
        // notifications over 5 seconds. The proxy pipes the response via
        // proxyRes.pipe(res) — when the worker dies mid-stream, the pipe
        // breaks and the client receives either a partial/error response
        // or a connection reset.
        const slowCallPromise = mcpClient.callToolWithProgress(
          'e2e-test_slow_with_progress',
          { durationMs: 5_000, steps: 10 },
          { timeout: 30_000 },
        );

        // Wait for the request to reach the worker and start producing
        // progress events, then trigger hot reload. The proxy kills the
        // old worker with SIGTERM, severing the piped SSE connection.
        await new Promise(r => setTimeout(r, 1_000));
        mcpServer.logs.length = 0;
        mcpServer.triggerHotReload();

        // The SSE stream may complete successfully (if the tool finished
        // before the worker was killed) or fail with 502/connection reset
        // (if the pipe was severed mid-stream). Both outcomes are acceptable
        // — the proxy should not hang indefinitely.
        try {
          const slowResult = await slowCallPromise;
          // If it completed, verify the content is valid
          if (!slowResult.isError) {
            const output = parseToolResult(slowResult.content);
            expect(output.completed).toBe(true);
          }
        } catch {
          // 502 Bad Gateway, connection reset, or partial SSE stream — expected
          // when the worker is killed mid-stream. The proxy's proxyRes.pipe(res)
          // connection breaks when the upstream worker dies.
        }

        // Wait for the hot reload to complete
        await waitForLog(mcpServer, 'Hot reload complete', 20_000);

        // Wait for the extension to reconnect to the new worker. The proxy
        // kills old WebSocket connections during restart, so the extension
        // detects the close and reconnects.
        await waitForExtensionConnected(mcpServer, 30_000);

        // Verify subsequent tool calls work after the reload. The MCP client
        // auto-reinitializes the session (new worker has no session memory).
        const afterResult = await mcpClient.callTool('e2e-test_echo', { message: 'after-sse-reload' });
        expect(afterResult.isError).toBe(false);
        const afterOutput = parseToolResult(afterResult.content);
        expect(afterOutput.message).toBe('after-sse-reload');
      } finally {
        await page.close();
      }
    });

    test('rapid successive hot reloads during active SSE stream resolve without deadlock', async ({
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    }) => {
      test.slow();

      const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

      try {
        // Baseline: verify the slow_with_progress tool works normally
        const baseline = await mcpClient.callToolWithProgress(
          'e2e-test_slow_with_progress',
          { durationMs: 500, steps: 2 },
          { timeout: 15_000 },
        );
        expect(baseline.isError).toBe(false);
        const baselineOutput = parseToolResult(baseline.content);
        expect(baselineOutput.completed).toBe(true);

        // Start a slow tool call that produces an SSE stream with progress
        // notifications over 5 seconds. This exercises the proxy's piped SSE
        // connection path, which breaks when the worker is killed mid-stream.
        const slowCallPromise = mcpClient.callToolWithProgress(
          'e2e-test_slow_with_progress',
          { durationMs: 5_000, steps: 10 },
          { timeout: 30_000 },
        );

        // Wait for the request to reach the worker and start producing
        // progress events before triggering the rapid reloads.
        await new Promise(r => setTimeout(r, 500));

        // Fire 3 hot reloads in rapid succession without awaiting between them.
        // Each reload kills the current worker and forks a new one — the last
        // worker becomes the final worker. The proxy must not deadlock or corrupt
        // state even when multiple restarts overlap with an active SSE stream.
        mcpServer.logs.length = 0;
        mcpServer.triggerHotReload();
        mcpServer.triggerHotReload();
        mcpServer.triggerHotReload();

        // The slow SSE call may complete, error cleanly with 502/connection reset,
        // or time out — all outcomes are acceptable. The proxy must not hang.
        try {
          const slowResult = await slowCallPromise;
          if (!slowResult.isError) {
            const output = parseToolResult(slowResult.content);
            expect(output.completed).toBe(true);
          }
        } catch {
          // 502 Bad Gateway, connection reset, or partial SSE stream — expected
          // when the worker is killed mid-stream by rapid successive reloads.
        }

        // Wait for the final hot reload to complete (the last worker reports ready)
        await waitForLog(mcpServer, 'Hot reload complete', 20_000);

        // Wait for the extension to reconnect to the new worker
        await waitForExtensionConnected(mcpServer, 30_000);

        // Wait for the extension to resync plugin/tool state with the new worker
        await waitForLog(mcpServer, 'tab.syncAll received', 20_000);

        // Poll until the tool is callable end-to-end through the extension
        await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'poll-check' }, { isError: false }, 20_000);

        // Verify end-to-end tool dispatch works after all rapid hot reloads.
        // This confirms the proxy's full relay path is functional after multiple
        // overlapping worker restarts during an active SSE stream.
        const afterResult = await mcpClient.callTool('e2e-test_echo', { message: 'after-rapid-reload' });
        expect(afterResult.isError).toBe(false);
        expect(parseToolResult(afterResult.content).message).toBe('after-rapid-reload');

        // Verify no deadlock, state corruption, or uncaught exceptions in logs.
        // ECONNREFUSED is intentionally excluded — it may appear legitimately
        // when the proxy tries to forward to a worker that was already killed by
        // a subsequent rapid reload.
        const errorPatterns = ['deadlock', 'state corruption', 'uncaughtException'];
        const joinedLogs = mcpServer.logs.join('\n');
        for (const pattern of errorPatterns) {
          expect(joinedLogs).not.toContain(pattern);
        }
      } finally {
        await page.close();
      }
    });
  });

test.describe('Dev proxy WebSocket upgrade during worker restart', () => {
  test('WebSocket upgrade during restart is buffered or cleanly rejected, and works after reload', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      // Verify server is healthy before triggering hot reload
      const initialHealth = await server.health();
      expect(initialHealth).not.toBeNull();
      if (!initialHealth) throw new Error('health returned null');
      expect(initialHealth.status).toBe('ok');

      // Get the WebSocket URL and secret for authenticated connections
      const { wsUrl, wsSecret } = await fetchWsInfo(server.port, server.secret);

      // Build the protocol list for authenticated WebSocket connections.
      // The server expects 'opentabs' as the first protocol, with the
      // secret as the second (optional) protocol for auth.
      const buildProtocols = (): string[] => {
        const protocols = ['opentabs'];
        if (wsSecret) protocols.push(wsSecret);
        return protocols;
      };

      // Clear logs to isolate hot-reload output
      server.logs.length = 0;

      // Trigger hot reload — the proxy kills the old worker and forks a new
      // one. During the restart window, the proxy's upgrade handler uses
      // whenReady() to buffer the upgrade request in pending[].
      server.triggerHotReload();

      // Immediately attempt a WebSocket connection BEFORE the worker reports
      // ready. The proxy's upgrade handler (dev-proxy.ts lines 214-227) calls
      // whenReady() which either:
      //   (a) buffers the upgrade in pending[] and forwards it once the worker
      //       is ready (happy path — connection succeeds after a brief delay)
      //   (b) times out after READY_TIMEOUT_MS and calls socket.destroy()
      //       (timeout path — connection fails cleanly)
      const protocols = buildProtocols();
      const midReloadWs = new WebSocket(wsUrl, protocols);

      // Wait for the mid-reload connection attempt to settle. The WebSocket
      // should either open successfully (buffered and forwarded) or close/error
      // cleanly (socket destroyed by timeout). It must NOT hang indefinitely.
      // Both outcomes are acceptable: the proxy either buffered the upgrade
      // and forwarded it (open) or cleanly rejected it (closed/error).
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => resolve(), 15_000);

        midReloadWs.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        midReloadWs.onclose = () => {
          clearTimeout(timer);
          resolve();
        };
        midReloadWs.onerror = () => {
          clearTimeout(timer);
          resolve();
        };
      });

      // Clean up the mid-reload WebSocket if it opened
      if (midReloadWs.readyState === WebSocket.OPEN || midReloadWs.readyState === WebSocket.CONNECTING) {
        midReloadWs.close();
      }

      // Wait for the hot reload to complete
      await waitForLog(server, 'Hot reload complete', 15_000);

      // After the reload completes, verify a fresh WebSocket connection
      // succeeds. This confirms the proxy's upgrade forwarding is fully
      // functional with the new worker.
      const freshProtocols = buildProtocols();
      const freshWs = new WebSocket(wsUrl, freshProtocols);

      const freshResult = await new Promise<'open' | 'closed' | 'error'>(resolve => {
        const timer = setTimeout(() => resolve('error'), 10_000);

        freshWs.onopen = () => {
          clearTimeout(timer);
          resolve('open');
        };
        freshWs.onclose = () => {
          clearTimeout(timer);
          resolve('closed');
        };
        freshWs.onerror = () => {
          clearTimeout(timer);
          resolve('error');
        };
      });

      expect(freshResult).toBe('open');

      // Verify the fresh WebSocket is functional by sending a ping frame
      // and receiving a pong. The ws library sends pong automatically in
      // response to ping frames at the protocol level.
      if (freshWs.readyState === WebSocket.OPEN) {
        // Send a JSON message and verify it doesn't cause errors.
        // The server processes 'opentabs' protocol messages — sending a
        // well-formed JSON-RPC ping verifies bidirectional communication.
        const pingReceived = await new Promise<boolean>(resolve => {
          const timer = setTimeout(() => resolve(false), 2_000);

          freshWs.onmessage = () => {
            clearTimeout(timer);
            resolve(true);
          };
          freshWs.onerror = () => {
            clearTimeout(timer);
            resolve(false);
          };

          // Send a JSON-RPC notification that the server will process
          freshWs.send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));
        });

        // The server may or may not respond to an unknown method, but the
        // connection should remain open and not error out.
        expect(freshWs.readyState).toBe(WebSocket.OPEN);
        // pingReceived is true only if we got a message response; false means
        // the 2-second timeout elapsed with no response (or an error occurred).
        expect(pingReceived).toBe(true);
      }

      // Clean up
      freshWs.close();
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe('Dev proxy stress: 10 concurrent HTTP requests during restart', () => {
  test('all 10 requests resolve within 15s — either 200 (buffered) or 503 (timeout)', async () => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);

    try {
      // Verify server is healthy before triggering hot reload
      const initialHealth = await server.health();
      expect(initialHealth).not.toBeNull();
      if (!initialHealth) throw new Error('health returned null');
      expect(initialHealth.status).toBe('ok');

      // Clear logs to isolate hot-reload output
      server.logs.length = 0;

      const headers: Record<string, string> = {};
      if (server.secret) headers.Authorization = `Bearer ${server.secret}`;

      // Trigger hot reload — the proxy kills the old worker and forks a new one.
      // During the restart window, incoming HTTP requests are buffered in pending[].
      server.triggerHotReload();

      // Immediately fire 10 concurrent fetch requests to /health. Each request
      // uses AbortSignal.timeout(15_000) to guarantee it settles within 15s.
      // The proxy's whenReady() buffers these requests and forwards them once
      // the new worker reports ready, or times out with 503 after READY_TIMEOUT_MS.
      const requests = Array.from({ length: 10 }, (_, i) =>
        fetch(`http://localhost:${server.port}/health`, {
          headers,
          signal: AbortSignal.timeout(15_000),
        }).then(
          res => ({ index: i, status: res.status, body: res.json() }),
          err => ({ index: i, status: 0, error: err }),
        ),
      );

      // All 10 must resolve — no hangs
      const results = await Promise.all(requests);

      for (const result of results) {
        if ('error' in result) {
          // A fetch-level failure (e.g. abort) means the request didn't resolve
          // to an HTTP response. This is a test failure — all requests must get
          // an HTTP response (200 or 503), not a connection-level error.
          throw new Error(`Request ${result.index} failed at fetch level: ${result.error}`);
        }
        // Each response must be either 200 (buffered and forwarded) or 503 (timeout)
        expect([200, 503]).toContain(result.status);
      }

      // Verify 200 responses have body.status === 'ok'
      for (const result of results) {
        if (!('error' in result) && result.status === 200) {
          const body = (await result.body) as { status: string };
          expect(body.status).toBe('ok');
        }
      }

      // Verify the hot reload completed
      await waitForLog(server, 'Hot reload complete', 20_000);

      // A fresh /health request must succeed after the reload
      const freshHealth = await server.health();
      expect(freshHealth).not.toBeNull();
      if (!freshHealth) throw new Error('health returned null after reload');
      expect(freshHealth.status).toBe('ok');
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  });
});

test.describe
  .serial('Dev proxy multi-client tool dispatch after hot reload', () => {
    test('both MCP clients dispatch tools end-to-end after hot reload', async ({
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    }) => {
      test.slow();

      const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

      // Create a second MCP client to test concurrent multi-client dispatch
      const client2 = createMcpClient(mcpServer.port, mcpServer.secret);
      await client2.initialize();

      try {
        // Baseline: both clients dispatch e2e-test_echo through the extension
        const baseline1 = await mcpClient.callTool('e2e-test_echo', { message: 'client1-before' });
        expect(baseline1.isError).toBe(false);
        expect(parseToolResult(baseline1.content).message).toBe('client1-before');

        const baseline2 = await client2.callTool('e2e-test_echo', { message: 'client2-before' });
        expect(baseline2.isError).toBe(false);
        expect(parseToolResult(baseline2.content).message).toBe('client2-before');

        // Trigger hot reload — the dev proxy kills the old worker and forks a new one
        mcpServer.logs.length = 0;
        mcpServer.triggerHotReload();

        // Wait for the new worker to fully start
        await waitForLog(mcpServer, 'Hot reload complete', 20_000);

        // Wait for the extension to reconnect to the new worker (the proxy kills
        // old WebSocket connections during restart, so the extension detects the
        // close and re-establishes the connection)
        await waitForExtensionConnected(mcpServer, 30_000);

        // Wait for the extension to resync its plugin/tool state with the new worker
        await waitForLog(mcpServer, 'tab.syncAll received', 20_000);

        // Poll until the tool is callable again (tab state = ready after worker restart).
        // Both clients auto-reinitialize their sessions against the new worker.
        await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'poll-check' }, { isError: false }, 20_000);

        // Both clients must be able to dispatch e2e-test_echo end-to-end after hot reload.
        // This exercises the full relay path: MCP client → proxy → new worker → extension
        // WebSocket → adapter IIFE → tool handler → extension → worker → proxy → client.
        const after1 = await mcpClient.callTool('e2e-test_echo', { message: 'client1-after' });
        expect(after1.isError).toBe(false);
        expect(parseToolResult(after1.content).message).toBe('client1-after');

        const after2 = await client2.callTool('e2e-test_echo', { message: 'client2-after' });
        expect(after2.isError).toBe(false);
        expect(parseToolResult(after2.content).message).toBe('client2-after');
      } finally {
        await client2.close();
        await page.close();
      }
    });
  });
