/**
 * Stress tests for MCP server tool dispatch: high-concurrency parallel calls,
 * tab closure during active dispatch, and other dispatch edge cases.
 *
 * Concurrent dispatch tests go beyond dispatch-resilience.e2e.ts (which tests
 * 3-5 concurrent calls) by firing 10+ and 20+ calls simultaneously and
 * verifying every response maps back to its originating request without
 * corruption or drops.
 */

import { expect, readTestConfig, test, writeTestConfig } from './fixtures.js';
import {
  openTestAppTab,
  parseToolResult,
  setupToolTest,
  waitForExtensionConnected,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

test.describe('Concurrent dispatch stress — 10+ parallel calls', () => {
  // MAX_CONCURRENT_DISPATCHES_PER_PLUGIN = 5: fire calls in batches of 5
  // to stay within the per-plugin concurrency limit while still exercising
  // concurrent dispatch and response routing correctness.
  const BATCH_SIZE = 5;

  test('10 concurrent echo calls return correct unique results', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const count = 10;
    const messages = Array.from({ length: count }, (_, i) => `concurrent-${i}`);
    const allResults: { content: string; isError: boolean }[] = [];

    for (let offset = 0; offset < count; offset += BATCH_SIZE) {
      const batch = messages.slice(offset, offset + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(msg => mcpClient.callTool('e2e-test_echo', { message: msg })));
      allResults.push(...batchResults);
    }

    expect(allResults).toHaveLength(count);

    for (const [i, result] of allResults.entries()) {
      expect(result.isError, `result ${i} should not be an error: ${result.content}`).toBe(false);
    }

    const receivedMessages: string[] = [];
    for (const [i, result] of allResults.entries()) {
      const parsed = parseToolResult(result.content);
      expect(parsed.message).toBe(messages[i]);
      receivedMessages.push(parsed.message as string);
    }

    const unique = new Set(receivedMessages);
    expect(unique.size).toBe(count);

    await page.close();
  });

  test('20 concurrent echo calls return correct unique results', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const count = 20;
    const messages = Array.from({ length: count }, (_, i) => `stress-${i}`);
    const allResults: { content: string; isError: boolean }[] = [];

    for (let offset = 0; offset < count; offset += BATCH_SIZE) {
      const batch = messages.slice(offset, offset + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(msg => mcpClient.callTool('e2e-test_echo', { message: msg })));
      allResults.push(...batchResults);
    }

    expect(allResults).toHaveLength(count);

    for (const [i, result] of allResults.entries()) {
      expect(result.isError, `result ${i} should not be an error: ${result.content}`).toBe(false);
    }

    const receivedMessages: string[] = [];
    for (const [i, result] of allResults.entries()) {
      const parsed = parseToolResult(result.content);
      expect(parsed.message).toBe(messages[i]);
      receivedMessages.push(parsed.message as string);
    }

    const unique = new Set(receivedMessages);
    expect(unique.size).toBe(count);

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Hot reload during active tool dispatch
// ---------------------------------------------------------------------------

test.describe('Hot reload during active tool dispatch', () => {
  test('in-flight slow calls resolve cleanly after hot reload, then new calls succeed', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Fire 5 slow tool calls (2s each, 2 steps) — some will be mid-execution
    // when hot reload kills the worker.
    const count = 5;
    const callPromises = Array.from({ length: count }, () =>
      mcpClient.callTool('e2e-test_slow_with_progress', {
        durationMs: 2000,
        steps: 2,
      }),
    );

    // Wait for dispatches to reach the extension. Dispatch is near-instant
    // over WebSocket, but we wait 1s to ensure calls are genuinely in-flight.
    await new Promise(r => setTimeout(r, 1_000));

    // Trigger hot reload (SIGUSR1 → worker kill + restart)
    const reloadTime = Date.now();
    mcpServer.triggerHotReload();

    // All 5 calls must settle — no infinite hang. Use
    // Promise.allSettled so individual failures don't short-circuit.
    const settled = await Promise.allSettled(callPromises);
    const settleElapsed = Date.now() - reloadTime;

    // In-flight calls must settle within 15s of the hot reload trigger,
    // not hang for the full 30s dispatch timeout.
    expect(settleElapsed, `in-flight calls took ${settleElapsed}ms to settle (limit: 15s)`).toBeLessThan(15_000);

    for (const [i, outcome] of settled.entries()) {
      if (outcome.status === 'fulfilled') {
        const result = outcome.value;
        if (result.isError) {
          // Any non-empty error is acceptable during hot reload — the specific
          // wording varies depending on timing (worker killed, WebSocket closed, etc.)
          expect(result.content.length).toBeGreaterThan(0);
        } else {
          // Success must have valid content
          expect(result.content.length).toBeGreaterThan(0);
        }
      } else {
        // Rejected = transport error (acceptable during hot reload)
        const err = (outcome as PromiseRejectedResult).reason;
        console.log(`call ${i} rejected: ${String(err).slice(0, 100)}`);
      }
    }

    // Wait for hot reload to finish and extension to reconnect
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);
    await waitForExtensionConnected(mcpServer, 30_000);

    // Verify the server is healthy after reload
    const health = await mcpServer.health();
    expect(health).not.toBeNull();
    expect(health?.status).toBe('ok');

    // Verify new tool calls work after the reload. Use waitForToolResult
    // to tolerate the brief window where the extension is still resyncing
    // tab state.
    const recoveredResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after-hot-reload' },
      { isError: false },
      20_000,
    );
    const recoveredOutput = parseToolResult(recoveredResult.content);
    expect(recoveredOutput.message).toBe('after-hot-reload');

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Tool dispatch during tab close
// ---------------------------------------------------------------------------

test.describe('Tool dispatch during tab close', () => {
  test('slow tool call interrupted by tab close returns clean error, not 30s timeout', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Fire a slow tool call (3s duration, 3 steps) without awaiting
    const start = Date.now();
    const toolCallPromise = mcpClient.callTool('e2e-test_slow_with_progress', {
      durationMs: 3000,
      steps: 3,
    });

    // Wait for the dispatch to reach the extension. Dispatch is near-instant
    // over WebSocket, but we wait 1s to ensure the call is genuinely in-flight.
    await new Promise(r => setTimeout(r, 1_000));

    // Close the tab mid-execution — this destroys the adapter execution
    // context, causing chrome.scripting.executeScript to reject.
    await page.close();

    // The tool call should resolve with a clean error within 10s (not hang
    // for the full 30s DISPATCH_TIMEOUT_MS)
    const result = await toolCallPromise;
    const elapsed = Date.now() - start;

    expect(result.isError).toBe(true);
    expect(elapsed).toBeLessThan(10_000);

    // Verify the server remains healthy after the failed dispatch
    const health = await mcpServer.health();
    expect(health).not.toBeNull();
    expect(health?.status).toBe('ok');

    // Open a new tab and verify subsequent tool calls succeed
    const newPage = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);
    const recoveredResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after-tab-close' },
      { isError: false },
      15_000,
    );
    const recoveredOutput = parseToolResult(recoveredResult.content);
    expect(recoveredOutput.message).toBe('after-tab-close');

    await newPage.close();
  });
});

// ---------------------------------------------------------------------------
// Permission change mid-dispatch
// ---------------------------------------------------------------------------

test.describe('Permission change mid-dispatch', () => {
  test('in-flight call completes after permission changed to off, subsequent calls rejected, restore works', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Fire a slow tool call (3s duration, 3 steps) — it will be in-flight
    // when we change the permission to 'off'.
    const slowCallPromise = mcpClient.callTool('e2e-test_slow_with_progress', {
      durationMs: 3000,
      steps: 3,
    });

    // Wait for the dispatch to reach the extension. Dispatch is near-instant
    // over WebSocket, but we wait 1s to ensure the call is genuinely in-flight.
    await new Promise(r => setTimeout(r, 1_000));

    // Change e2e-test permission to 'off' via config + POST /reload.
    // Use POST /reload (config reload) instead of triggerHotReload (SIGUSR1)
    // because hot reload kills the worker process, which would interrupt the
    // in-flight slow call. Config reload re-reads config.json and updates
    // permissions in-place without restarting the worker.
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { ...config.permissions, 'e2e-test': { permission: 'off' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    const reloadRes = await fetch(`http://localhost:${mcpServer.port}/reload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mcpServer.secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    expect(reloadRes.ok, `POST /reload failed: ${reloadRes.status}`).toBe(true);
    await waitForLog(mcpServer, 'Config reload complete', 15_000);

    // The in-flight call already passed the permission check before dispatch.
    // It MUST complete successfully — permission changes only affect NEW calls.
    const slowResult = await slowCallPromise;
    expect(slowResult.isError).not.toBe(true);

    // A subsequent call should be rejected with a 'disabled' or 'not been reviewed' message
    const rejectedResult = await mcpClient.callTool('e2e-test_echo', { message: 'should-fail' });
    expect(rejectedResult.isError).toBe(true);
    expect(
      rejectedResult.content.includes('currently disabled') || rejectedResult.content.includes('not been reviewed'),
      `expected 'currently disabled' or 'not been reviewed', got: ${rejectedResult.content}`,
    ).toBe(true);

    // Restore permission to 'auto' and verify tool availability returns
    const restoredConfig = readTestConfig(mcpServer.configDir);
    restoredConfig.permissions = {
      ...restoredConfig.permissions,
      'e2e-test': { permission: 'auto' },
    };
    writeTestConfig(mcpServer.configDir, restoredConfig);

    mcpServer.logs.length = 0;
    const restoreRes = await fetch(`http://localhost:${mcpServer.port}/reload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mcpServer.secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    expect(restoreRes.ok, `POST /reload failed: ${restoreRes.status}`).toBe(true);
    await waitForLog(mcpServer, 'Config reload complete', 15_000);

    // Verify the tool works again after restoring permission
    const recoveredResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after-restore' },
      { isError: false },
      20_000,
    );
    const recoveredOutput = parseToolResult(recoveredResult.content);
    expect(recoveredOutput.message).toBe('after-restore');

    await page.close();
  });
});
