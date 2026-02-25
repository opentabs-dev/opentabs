/**
 * Lifecycle hooks E2E tests — verifies that plugin lifecycle hooks fire
 * correctly with the expected arguments through the full dispatch stack.
 *
 * Hooks tested:
 *   - onActivate: fires when adapter is injected
 *   - onDeactivate: fires when adapter is removed (on re-injection)
 *   - onNavigate: fires on pushState URL changes
 *   - onToolInvocationStart / onToolInvocationEnd: fire around tool.handle()
 *
 * Prerequisites (all pre-built, not created at test time):
 *   - `bun run build` has been run (platform dist/ files exist)
 *   - `plugins/e2e-test` has been built (`cd plugins/e2e-test && bun run build`)
 *   - Chromium is installed for Playwright
 *
 * All tests use dynamic ports and are safe for parallel execution.
 */

import { test, expect } from './fixtures.js';
import { waitForLog, setupToolTest, callToolExpectSuccess, waitFor, waitForToolResult } from './helpers.js';

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

test.describe('Lifecycle hooks', () => {
  test('onActivate fires when adapter is injected', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const activated = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_onActivate_called);
    expect(activated).toBe(true);
  });

  test('onNavigate fires on pushState URL change', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Perform a pushState navigation.
    // The monkey-patched pushState fires checkUrl() synchronously, which calls
    // plugin.onNavigate(newUrl), pushing the URL into the global array before
    // page.evaluate resolves. The subsequent waitFor should succeed on its
    // first poll — the generous timeout is purely defensive against CDP latency
    // under heavy parallel test load.
    await page.evaluate(() => history.pushState({}, '', '/navigated-path'));

    // Wait for the hook to fire and record the URL
    await waitFor(
      async () => {
        const urls = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls);
        return Array.isArray(urls) && urls.length > 0;
      },
      10_000,
      200,
      'onNavigate hook to record URL',
    );

    const urls = await page.evaluate(
      () => (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls as string[],
    );
    expect(urls).toEqual(expect.arrayContaining([expect.stringContaining('/navigated-path')]));
  });

  test('onToolInvocationStart and onToolInvocationEnd fire around tool calls', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Call a tool through the full MCP stack
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'hooks-test' });

    // Wait for invocation hooks to fire
    await waitFor(
      async () => {
        const starts = await page.evaluate(
          () => (globalThis as Record<string, unknown>).__opentabs_tool_invocation_start,
        );
        const ends = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_tool_invocation_end);
        return Array.isArray(starts) && starts.length > 0 && Array.isArray(ends) && ends.length > 0;
      },
      5_000,
      200,
      'tool invocation hooks to fire',
    );

    // Verify onToolInvocationStart recorded the tool name
    const starts = await page.evaluate(
      () => (globalThis as Record<string, unknown>).__opentabs_tool_invocation_start as string[],
    );
    expect(starts).toContain('echo');

    // Verify onToolInvocationEnd recorded the correct arguments
    const ends = await page.evaluate(
      () =>
        (globalThis as Record<string, unknown>).__opentabs_tool_invocation_end as Array<{
          toolName: string;
          success: boolean;
          durationMs: number;
        }>,
    );
    expect(ends).toEqual(expect.arrayContaining([expect.objectContaining({ toolName: 'echo', success: true })]));
    // Duration should be a non-negative number
    const echoEnd = ends.find(e => e.toolName === 'echo');
    expect(echoEnd).toBeDefined();
    expect(echoEnd?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('onToolInvocationEnd reports failure for failing tools', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Call the failing tool — it returns an error through tool dispatch
    await mcpClient.callTool('e2e-test_failing_tool', {});

    // Wait for the invocation end hook to record the failure
    await waitFor(
      async () => {
        const ends = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_tool_invocation_end);
        if (!Array.isArray(ends)) return false;
        return ends.some((e: Record<string, unknown>) => e.toolName === 'failing_tool' && e.success === false);
      },
      5_000,
      200,
      'onToolInvocationEnd to record failure',
    );

    const ends = await page.evaluate(
      () =>
        (globalThis as Record<string, unknown>).__opentabs_tool_invocation_end as Array<{
          toolName: string;
          success: boolean;
          durationMs: number;
        }>,
    );
    expect(ends).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: 'failing_tool', success: false })]),
    );
    const failEnd = ends.find(e => e.toolName === 'failing_tool');
    expect(failEnd).toBeDefined();
    expect(failEnd?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('onDeactivate fires on adapter re-injection via hot reload', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify onActivate fired on initial injection
    const activated = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_onActivate_called);
    expect(activated).toBe(true);

    // Clear the onDeactivate flag right before triggering hot reload.
    // A re-injection during setup (e.g., from a second tab.syncAll) may have
    // already set this flag — clearing it isolates our assertion to the hot
    // reload we're about to trigger.
    await page.evaluate(() => {
      delete (globalThis as Record<string, unknown>).__opentabs_onDeactivate_called;
    });

    // Trigger a hot reload — this causes sync.full → extension re-injects adapters
    // with forceReinject=true → old adapter's teardown fires (which calls
    // onDeactivate first) → new adapter registered → new onActivate fires
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();

    // Wait for the hot reload + re-injection to complete
    await waitForLog(mcpServer, 'tab.syncAll received', 20_000);

    // Wait for the adapter to be re-injected
    await waitFor(
      async () => {
        const present = await page.evaluate(() => {
          const ot = (globalThis as Record<string, unknown>).__openTabs as
            | { adapters?: Record<string, unknown> }
            | undefined;
          return ot?.adapters?.['e2e-test'] !== undefined;
        });
        return present;
      },
      15_000,
      500,
      'e2e-test adapter to be re-injected after hot reload',
    );

    // Verify onDeactivate was called (by the old adapter during teardown)
    await waitFor(
      async () => {
        const deactivated = await page.evaluate(
          () => (globalThis as Record<string, unknown>).__opentabs_onDeactivate_called,
        );
        return deactivated === true;
      },
      5_000,
      200,
      'onDeactivate to be called after re-injection',
    );

    // Verify tools still work after re-injection
    await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'after-reload' }, { isError: false }, 15_000);
  });
});
