/**
 * Stress tests for MCP server tool dispatch: high-concurrency parallel calls,
 * tab closure during active dispatch, and other dispatch edge cases.
 *
 * Concurrent dispatch tests go beyond dispatch-resilience.e2e.ts (which tests
 * 3-5 concurrent calls) by firing 10+ and 20+ calls simultaneously and
 * verifying every response maps back to its originating request without
 * corruption or drops.
 */

import { expect, test } from './fixtures.js';
import { openTestAppTab, parseToolResult, setupToolTest, waitFor, waitForToolResult } from './helpers.js';

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
