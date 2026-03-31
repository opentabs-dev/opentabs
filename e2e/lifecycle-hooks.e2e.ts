/**
 * Lifecycle hooks E2E tests — verifies that plugin lifecycle hooks fire
 * correctly with the expected arguments through the full dispatch stack.
 *
 * Hooks tested:
 *   - onActivate: fires when adapter is injected
 *   - onDeactivate: does NOT fire when hot reload skips re-injection (hash match)
 *   - onNavigate: fires on pushState URL changes
 *   - onToolInvocationStart / onToolInvocationEnd: fire around tool.handle()
 *
 * Prerequisites (all pre-built, not created at test time):
 *   - `npm run build` has been run (platform dist/ files exist)
 *   - `plugins/e2e-test` has been built (`cd plugins/e2e-test && npm run build`)
 *   - Chromium is installed for Playwright
 *
 * All tests use dynamic ports and are safe for parallel execution.
 */

import { expect, test } from './fixtures.js';
import { callToolExpectSuccess, setupToolTest, waitFor, waitForLog, waitForToolResult } from './helpers.js';

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

  test('onNavigate fires on hashchange', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Clear any URLs recorded during setup
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls = [];
    });

    // Trigger a hashchange
    await page.evaluate(() => {
      window.location.hash = '#test-section';
    });

    await waitFor(
      async () => {
        const urls = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls);
        return Array.isArray(urls) && urls.length > 0;
      },
      10_000,
      200,
      'onNavigate hook to record hashchange URL',
    );

    const urls = await page.evaluate(
      () => (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls as string[],
    );
    expect(urls).toEqual(expect.arrayContaining([expect.stringContaining('#test-section')]));
  });

  test('onNavigate fires on replaceState URL change', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Clear any URLs recorded during setup
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls = [];
    });

    await page.evaluate(() => history.replaceState({}, '', '/replaced-path'));

    // The monkey-patched replaceState fires synchronously, but under heavy
    // parallel load the CDP round-trip to read page globals can be slow.
    await waitFor(
      async () => {
        const urls = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls);
        return Array.isArray(urls) && urls.length > 0;
      },
      15_000,
      200,
      'onNavigate hook to record replaceState URL',
    );

    const urls = await page.evaluate(
      () => (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls as string[],
    );
    expect(urls).toEqual(expect.arrayContaining([expect.stringContaining('/replaced-path')]));
  });

  test('onNavigate fires on popstate (browser back)', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Capture the original URL before pushing state
    const originalUrl = await page.evaluate(() => window.location.href);

    // Clear any URLs recorded during setup
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls = [];
    });

    // Push a history entry — this itself fires onNavigate, so we clear again after
    await page.evaluate(() => history.pushState({}, '', '/popstate-target'));

    // Clear URLs triggered by the pushState call
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls = [];
    });

    // Go back — this fires a popstate event, which the adapter listens to and
    // calls plugin.onNavigate with the restored URL. The popstate event fires
    // asynchronously after history.back() returns, so waitFor handles it.
    await page.evaluate(() => history.back());

    await waitFor(
      async () => {
        const urls = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls);
        return Array.isArray(urls) && urls.length > 0;
      },
      10_000,
      200,
      'onNavigate hook to record popstate URL',
    );

    const urls = await page.evaluate(
      () => (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls as string[],
    );
    // After going back, the URL should be the original URL (without /popstate-target)
    expect(urls).toEqual(expect.arrayContaining([expect.stringContaining(originalUrl)]));
  });

  test('20 rapid pushState calls — all 20 onNavigate hooks fire in order', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Clear any URLs recorded during setup
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls = [];
    });

    // Execute 20 pushState calls synchronously in a tight loop.
    // The adapter monkey-patches pushState to fire onNavigate synchronously,
    // so all 20 should be recorded without drops or reordering.
    await page.evaluate(() => {
      for (let i = 0; i < 20; i++) {
        history.pushState({}, '', `/burst-${i}`);
      }
    });

    // Wait for all 20 URLs to be recorded
    await waitFor(
      async () => {
        const urls = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls);
        return Array.isArray(urls) && urls.length === 20;
      },
      10_000,
      200,
      '__opentabs_onNavigate_urls.length === 20',
    );

    const urls = await page.evaluate(
      () => (globalThis as Record<string, unknown>).__opentabs_onNavigate_urls as string[],
    );

    // Exactly 20 entries — no duplicates, no drops
    expect(urls).toHaveLength(20);

    // Each URL ends with /burst-${i} in order
    for (let i = 0; i < 20; i++) {
      expect(urls[i]).toContain(`/burst-${i}`);
    }
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

    // Wait for invocation hooks to fire. The hooks are set by the adapter
    // after the tool handler completes — under heavy parallel load, the CDP
    // round-trip to read page globals can take several seconds.
    await waitFor(
      async () => {
        const starts = await page.evaluate(
          () => (globalThis as Record<string, unknown>).__opentabs_tool_invocation_start,
        );
        const ends = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_tool_invocation_end);
        return Array.isArray(starts) && starts.length > 0 && Array.isArray(ends) && ends.length > 0;
      },
      15_000,
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

    // Wait for the invocation end hook to record the failure. The hooks are
    // set by the adapter after the tool handler completes — under heavy
    // parallel load, the full dispatch round-trip can take several seconds.
    await waitFor(
      async () => {
        const ends = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_tool_invocation_end);
        if (!Array.isArray(ends)) return false;
        return ends.some((e: Record<string, unknown>) => e.toolName === 'failing_tool' && e.success === false);
      },
      15_000,
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

  test('onDeactivate does NOT fire on hot reload when adapter hash matches (skip)', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify onActivate fired on initial injection
    const activated = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_onActivate_called);
    expect(activated).toBe(true);

    // Clear both lifecycle flags before triggering hot reload
    await page.evaluate(() => {
      delete (globalThis as Record<string, unknown>).__opentabs_onActivate_called;
      delete (globalThis as Record<string, unknown>).__opentabs_onDeactivate_called;
    });

    // Trigger a hot reload — this sends sync.full with the same adapter hash.
    // The extension's hash-based skip logic detects the adapter is already
    // present with a matching hash and skips re-injection entirely.
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();

    // Wait for sync.full to be processed
    await waitForLog(mcpServer, 'tab.syncAll received', 20_000);

    // Give the extension time to process (injection skip is synchronous)
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
      'e2e-test adapter to remain present after hot reload',
    );

    // Neither onDeactivate nor onActivate should have fired — the adapter
    // was not torn down or re-injected because the hash matched.
    const deactivated = await page.evaluate(
      () => (globalThis as Record<string, unknown>).__opentabs_onDeactivate_called,
    );
    expect(deactivated).toBeUndefined();

    const reActivated = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_onActivate_called);
    expect(reActivated).toBeUndefined();

    // Verify tools still work after the skipped hot reload
    await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'after-reload' }, { isError: false }, 15_000);
  });
});
