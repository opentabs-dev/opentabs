/**
 * E2E tests for progress reporting — verifies the full notification chain:
 * adapter → extension → MCP server → MCP client (SSE stream).
 *
 * Tests cover:
 *   - Progress notifications flow through the pipeline and are captured by the client
 *   - Progress fields (progress, total, message) are preserved end-to-end
 *   - Indeterminate progress (progress=0, total=0, message-only) flows through correctly
 *   - Progress resets the dispatch timeout, allowing tools to run past 30s
 *   - Tools without progress still time out at the default 30s/25s
 *
 * Prerequisites:
 *   - `npm run build` has been run (platform dist/ files exist)
 *   - `plugins/e2e-test` has been built with slow_with_progress and indeterminate_progress tools
 *   - Chromium is installed for Playwright
 */

import { expect, test } from './fixtures.js';
import { parseToolResult, setupToolTest } from './helpers.js';

// ---------------------------------------------------------------------------
// Progress notifications — full pipeline
// ---------------------------------------------------------------------------

test.describe('Progress reporting — full pipeline', () => {
  test('slow_with_progress reports progress notifications captured by MCP client', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Call the tool with progress tracking — 3 steps over 3 seconds
    const result = await mcpClient.callToolWithProgress(
      'e2e-test__slow_with_progress',
      { durationMs: 3000, steps: 3 },
      { timeout: 30_000 },
    );

    // Tool should succeed
    expect(result.isError).toBe(false);
    const output = parseToolResult(result.content);
    expect(output.completed).toBe(true);
    expect(output.stepsReported).toBe(3);

    // Verify progress notifications were received
    expect(result.progressNotifications.length).toBe(3);

    // Verify each notification has correct progress/total values
    for (let i = 0; i < 3; i++) {
      const notif = result.progressNotifications[i];
      expect(notif).toBeDefined();
      if (!notif) throw new Error(`Missing progress notification at index ${i}`);
      expect(notif.progress).toBe(i + 1);
      expect(notif.total).toBe(3);
      expect(notif.message).toBe(`Step ${String(i + 1)} of 3`);
    }

    await page.close();
  });

  test('progress notification fields are correct for varying step counts', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Call with 5 steps over 2 seconds
    const result = await mcpClient.callToolWithProgress(
      'e2e-test__slow_with_progress',
      { durationMs: 2000, steps: 5 },
      { timeout: 30_000 },
    );

    expect(result.isError).toBe(false);
    const output = parseToolResult(result.content);
    expect(output.completed).toBe(true);
    expect(output.stepsReported).toBe(5);

    // All 5 progress notifications should be present
    expect(result.progressNotifications.length).toBe(5);

    // First notification: progress=1, total=5
    const first = result.progressNotifications[0];
    expect(first).toBeDefined();
    if (!first) throw new Error('Missing first notification');
    expect(first.progress).toBe(1);
    expect(first.total).toBe(5);

    // Last notification: progress=5, total=5
    const last = result.progressNotifications[4];
    expect(last).toBeDefined();
    if (!last) throw new Error('Missing last notification');
    expect(last.progress).toBe(5);
    expect(last.total).toBe(5);

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Indeterminate progress (no progress/total — message only)
// ---------------------------------------------------------------------------

test.describe('Indeterminate progress reporting', () => {
  test('indeterminate_progress sends notifications with progress=0, total=0', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callToolWithProgress('e2e-test__indeterminate_progress', {}, { timeout: 30_000 });

    // Tool should succeed
    expect(result.isError).toBe(false);
    const output = parseToolResult(result.content);
    expect(output.ok).toBe(true);

    // All 3 indeterminate progress notifications should be received
    expect(result.progressNotifications.length).toBe(3);

    // Each notification should have the indeterminate sentinel values (0, 0) and a message
    expect(result.progressNotifications[0]?.message).toBe('Step 1: Initializing...');
    expect(result.progressNotifications[1]?.message).toBe('Step 2: Processing...');
    expect(result.progressNotifications[2]?.message).toBe('Step 3: Finishing...');

    for (const notif of result.progressNotifications) {
      expect(notif.progress).toBe(0);
      expect(notif.total).toBe(0);
    }

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Progress-based timeout extension
// ---------------------------------------------------------------------------

test.describe('Progress-based timeout extension', () => {
  test('tool running 35s with progress completes successfully (progress resets dispatch timeout)', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // This test runs for ~35 seconds — well past the default 30s dispatch timeout
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // 5 steps over 35 seconds — each step at 7s intervals.
    // Without progress timeout reset, the tool would time out at 25s (extension)
    // or 30s (server). With progress, each notification resets the timer.
    const start = Date.now();
    const result = await mcpClient.callToolWithProgress(
      'e2e-test__slow_with_progress',
      { durationMs: 35_000, steps: 5 },
      { timeout: 60_000 },
    );
    const elapsed = Date.now() - start;

    // Tool should succeed despite running past 30s
    expect(result.isError).toBe(false);
    const output = parseToolResult(result.content);
    expect(output.completed).toBe(true);
    expect(output.stepsReported).toBe(5);

    // Verify it actually ran for ~35s (proving the timeout was extended)
    expect(elapsed).toBeGreaterThan(30_000);
    expect(elapsed).toBeLessThan(50_000);

    // All 5 progress notifications should have been received
    expect(result.progressNotifications.length).toBe(5);

    await page.close();
  });

  test('tool WITHOUT progress still times out at the default timeout', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // This test waits for the 25s extension-side timeout to fire
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Set the test server to a 35s delay — echo tool does not report progress,
    // so it should time out at the extension-side SCRIPT_TIMEOUT_MS (25s)
    await testServer.setSlow(35_000);

    const start = Date.now();
    const result = await mcpClient.callTool('e2e-test__echo', { message: 'should-timeout' });
    const elapsed = Date.now() - start;

    // Should time out with an error
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('timed out');

    // Should fire around 25s (SCRIPT_TIMEOUT_MS), not be extended
    expect(elapsed).toBeGreaterThan(20_000);
    expect(elapsed).toBeLessThan(35_000);

    // Reset slow mode for clean teardown
    await testServer.setSlow(0);
    await page.close();
  });
});
