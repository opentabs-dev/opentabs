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
  waitFor,
  waitForExtensionConnected,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

test.describe('Concurrent dispatch stress — 10+ parallel calls', () => {
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

    const results = await Promise.all(messages.map(msg => mcpClient.callTool('e2e-test_echo', { message: msg })));

    expect(results).toHaveLength(count);

    // All 10 results must be non-error
    for (const [i, result] of results.entries()) {
      expect(result.isError, `result ${i} should not be an error: ${result.content}`).toBe(false);
    }

    // Each result must contain the correct echo response matching its input
    const receivedMessages: string[] = [];
    for (const [i, result] of results.entries()) {
      const parsed = parseToolResult(result.content);
      expect(parsed.message).toBe(messages[i]);
      receivedMessages.push(parsed.message as string);
    }

    // No two results contain the same message (no response routing corruption)
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

    const results = await Promise.all(messages.map(msg => mcpClient.callTool('e2e-test_echo', { message: msg })));

    expect(results).toHaveLength(count);

    // All 20 results must be non-error
    for (const [i, result] of results.entries()) {
      expect(result.isError, `result ${i} should not be an error: ${result.content}`).toBe(false);
    }

    // Each result must match its input (1:1 positional mapping)
    const receivedMessages: string[] = [];
    for (const [i, result] of results.entries()) {
      const parsed = parseToolResult(result.content);
      expect(parsed.message).toBe(messages[i]);
      receivedMessages.push(parsed.message as string);
    }

    // No duplicates — Set.size must equal count
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
    const callPromises = Array.from({ length: count }, (_, i) =>
      mcpClient.callTool('e2e-test_slow_with_progress', {
        durationMs: 2000,
        steps: 2,
        message: `hot-reload-${i}`,
      }),
    );

    // Wait until at least one dispatch is in-flight before triggering reload
    await waitFor(
      () => mcpServer.logs.some(line => line.includes('tool.dispatch') && line.includes('slow_with_progress')),
      5_000,
      100,
      'slow_with_progress dispatch to reach extension',
    );

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
          // Error must identify the failure cause — not empty or generic
          expect(
            /disconnected|timed out|dispatch|worker/i.test(result.content),
            `call ${i}: error message must identify the failure cause, got: ${result.content.slice(0, 100)}`,
          ).toBe(true);
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

    // Wait until the dispatch is in flight — poll MCP server logs for the
    // tool.dispatch message that confirms the server sent the request to the
    // extension.
    await waitFor(
      () => mcpServer.logs.some(line => line.includes('tool.dispatch') && line.includes('slow_with_progress')),
      5_000,
      100,
      'slow_with_progress dispatch to reach extension',
    );

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

    // Wait until the dispatch is in-flight (server sent it to the extension)
    await waitFor(
      () => mcpServer.logs.some(line => line.includes('tool.dispatch') && line.includes('slow_with_progress')),
      5_000,
      100,
      'slow_with_progress dispatch to reach extension',
    );

    // Change e2e-test permission to 'off' via config + hot reload
    const config = readTestConfig(mcpServer.configDir);
    config.permissions = { ...config.permissions, 'e2e-test': { permission: 'off' } };
    writeTestConfig(mcpServer.configDir, config);

    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);
    await waitForExtensionConnected(mcpServer, 30_000);

    // The in-flight call should complete (either success or clean error) —
    // it already passed the permission check before dispatch.
    const slowResult = await slowCallPromise;
    expect(typeof slowResult.isError === 'boolean').toBe(true);

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
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'Hot reload complete', 20_000);
    await waitForExtensionConnected(mcpServer, 30_000);

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
