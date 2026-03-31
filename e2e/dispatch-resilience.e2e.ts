/**
 * Edge-case E2E tests — concurrent dispatch, extension reload, multi-tab,
 * tab navigation away, and tool calls during reconnect.
 *
 * These tests cover critical untested scenarios that verify the platform
 * handles real-world edge cases gracefully.
 *
 * Prerequisites (all pre-built, not created at test time):
 *   - `npm run build` has been run (platform dist/ files exist)
 *   - `plugins/e2e-test` has been built (`cd plugins/e2e-test && npm run build`)
 *   - Chromium is installed for Playwright
 *
 * All tests use dynamic ports and are safe for parallel execution.
 */

import { createMcpClient, expect, fetchWsInfo, test } from './fixtures.js';
import {
  callToolExpectSuccess,
  openTestAppTab,
  parseToolResult,
  setupToolTest,
  waitFor,
  waitForExtensionConnected,
  waitForExtensionDisconnected,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Concurrent tool dispatch
// ---------------------------------------------------------------------------

test.describe('Concurrent tool dispatch', () => {
  test('3-5 concurrent tool calls via Promise.all return correct results without interleaving', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Fire 5 different tool calls concurrently
    const results = await Promise.all([
      mcpClient.callTool('e2e-test_echo', { message: 'concurrent-1' }),
      mcpClient.callTool('e2e-test_echo', { message: 'concurrent-2' }),
      mcpClient.callTool('e2e-test_greet', { name: 'Concurrent' }),
      mcpClient.callTool('e2e-test_get_status', {}),
      mcpClient.callTool('e2e-test_list_items', { limit: 2 }),
    ]);

    // All should succeed
    for (const result of results) {
      expect(result.isError).toBe(false);
    }

    // Verify each result matches its specific tool call (no interleaving)
    const echo1 = parseToolResult(results[0].content);
    expect(echo1.message).toBe('concurrent-1');

    const echo2 = parseToolResult(results[1].content);
    expect(echo2.message).toBe('concurrent-2');

    const greet = parseToolResult(results[2].content);
    expect(greet.greeting).toBe('Hello, Concurrent!');

    const status = parseToolResult(results[3].content);
    expect(status.version).toBe('1.0.0-test');

    const list = parseToolResult(results[4].content);
    expect(Array.isArray(list.items)).toBe(true);
    expect((list.items as unknown[]).length).toBe(2);

    // Verify the test server recorded all invocations
    const invocations = await testServer.invocations();
    const toolInvocations = invocations.filter(i => i.path !== '/api/auth.check');
    const echoCalls = toolInvocations.filter(i => i.path === '/api/echo');
    const greetCalls = toolInvocations.filter(i => i.path === '/api/greet');
    const statusCalls = toolInvocations.filter(i => i.path === '/api/status');
    const listCalls = toolInvocations.filter(i => i.path === '/api/list-items');

    expect(echoCalls.length).toBeGreaterThanOrEqual(2);
    expect(greetCalls.length).toBeGreaterThanOrEqual(1);
    expect(statusCalls.length).toBeGreaterThanOrEqual(1);
    expect(listCalls.length).toBeGreaterThanOrEqual(1);

    await page.close();
  });

  test('concurrent calls to the same tool with different args return distinct results', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Fire 4 echo calls concurrently with unique messages
    const messages = ['alpha', 'bravo', 'charlie', 'delta'];
    const results = await Promise.all(messages.map(msg => mcpClient.callTool('e2e-test_echo', { message: msg })));

    // All should succeed
    for (const result of results) {
      expect(result.isError).toBe(false);
    }

    // Each result should contain the correct message (no cross-contamination)
    const receivedMessages = results.map(r => (parseToolResult(r.content) as { message: string }).message);

    for (const msg of messages) {
      expect(receivedMessages).toContain(msg);
    }

    // Verify 1:1 mapping (each position returns its own message)
    for (let i = 0; i < messages.length; i++) {
      const result = results[i];
      if (!result) throw new Error(`Missing result at index ${i}`);
      const parsed = parseToolResult(result.content);
      expect(parsed.message).toBe(messages[i]);
    }

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// extension_reload tool
// ---------------------------------------------------------------------------

test.describe('extension_reload tool', () => {
  test('extension_reload: sends reload signal and extension disconnects', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify tools work before reload
    const beforeOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
      message: 'before reload',
    });
    expect(beforeOutput.message).toBe('before reload');

    // Call extension_reload — the extension sends a response then reloads after 100ms
    const reloadResult = await mcpClient.callTool('extension_reload');
    expect(reloadResult.isError).toBe(false);

    // The extension should disconnect after receiving the reload signal.
    // chrome.runtime.reload() terminates the service worker; Playwright's
    // Chromium does not restart it, so we only verify the disconnect.
    await waitForExtensionDisconnected(mcpServer, 15_000);

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Multi-tab — same plugin, two tabs
// ---------------------------------------------------------------------------

test.describe('Multi-tab same plugin', () => {
  test('two tabs matching same plugin URL are both tracked, dispatch works on either', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');
    await testServer.reset();

    // Open first tab
    const page1 = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);
    await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

    // Tool works with first tab
    const output1 = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'tab-1' });
    expect(output1.message).toBe('tab-1');

    // Open second tab to same URL
    const page2 = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    // Tool should still work (dispatches to one of the matching tabs)
    const output2 = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'multi-tab' });
    expect(output2.message).toBe('multi-tab');

    // Close first tab — tool should still work via second tab
    await page1.close();

    // Poll until the tool succeeds via the second tab
    const afterClose = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after-close-tab1' },
      { isError: false },
      15_000,
    );
    const afterCloseOutput = parseToolResult(afterClose.content);
    expect(afterCloseOutput.message).toBe('after-close-tab1');

    // Close second tab — tool should now fail (no matching tabs)
    await page2.close();

    // Poll until the tool fails
    const afterCloseAll = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after-close-all' },
      { isError: true },
      15_000,
    );
    expect(afterCloseAll.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tab navigates away from matching URL
// ---------------------------------------------------------------------------

test.describe('Tab navigates away', () => {
  test('navigate matched tab to non-matching URL, tool becomes unavailable', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Tool works while tab is on matching URL
    const okOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'before-nav' });
    expect(okOutput.message).toBe('before-nav');

    // Navigate the tab to a non-matching URL (127.0.0.1 does not match the plugin's http://localhost/* pattern)
    await page.goto(`${testServer.url.replace('localhost', '127.0.0.1')}/non-matching`, {
      waitUntil: 'load',
      timeout: 15_000,
    });

    // Poll until the tool fails (tab no longer matches plugin URL pattern)
    const failResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after-nav-away' },
      { isError: true },
      15_000,
    );
    expect(failResult.isError).toBe(true);

    // Navigate back to the test server URL
    await page.goto(testServer.url, { waitUntil: 'load', timeout: 15_000 });

    // Wait for the adapter to be re-injected
    await page.waitForFunction(
      () => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      },
      { timeout: 15_000 },
    );

    // Poll until the tool works again
    const recoveredResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after-nav-back' },
      { isError: false },
      15_000,
    );
    const recoveredOutput = parseToolResult(recoveredResult.content);
    expect(recoveredOutput.message).toBe('after-nav-back');

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Tool call during extension reconnect window
// ---------------------------------------------------------------------------

test.describe('Tool call during reconnect window', () => {
  test('tool call when extension is disconnected returns clean error, not 30s timeout', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // Replace the extension's WebSocket slot with a fake client to disconnect the real extension.
    mcpServer.logs.length = 0;
    const { wsUrl, wsSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
    const stealProtocols = ['opentabs'];
    if (wsSecret) stealProtocols.push(wsSecret);
    const fakeWs = stealProtocols.length > 1 ? new WebSocket(wsUrl, stealProtocols) : new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5_000);
      fakeWs.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      fakeWs.onerror = () => {
        clearTimeout(timer);
        reject(new Error('WebSocket connect failed'));
      };
    });

    // Wait for server to recognize the replacement, then close the fake WS
    try {
      await waitForLog(mcpServer, 'Closing previous extension WebSocket', 5_000);
    } finally {
      // Always close the fake WS so orphaned connections don't accumulate on failure
      fakeWs.close();
    }

    // Wait until the server reports no extension connected
    await waitForExtensionDisconnected(mcpServer, 5_000);

    // Call a tool while the extension is disconnected.
    // Should return a clean error quickly (not hang for 30s dispatch timeout).
    const start = Date.now();
    const result = await mcpClient.callTool('e2e-test_echo', { message: 'during-reconnect' });
    const elapsed = Date.now() - start;

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Extension not connected');

    // The error should come back quickly (well under the 30s dispatch timeout)
    expect(elapsed).toBeLessThan(10_000);

    // Wait for the real extension to reconnect for clean teardown
    await waitForExtensionConnected(mcpServer, 45_000);
  });

  test('browser_list_tabs during reconnect returns Extension not connected', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // Disconnect the extension by replacing the WS slot
    mcpServer.logs.length = 0;
    const { wsUrl: fakeUrl, wsSecret: fakeSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
    const fakeProtocols = ['opentabs'];
    if (fakeSecret) fakeProtocols.push(fakeSecret);
    const fakeWs = fakeProtocols.length > 1 ? new WebSocket(fakeUrl, fakeProtocols) : new WebSocket(fakeUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5_000);
      fakeWs.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      fakeWs.onerror = () => {
        clearTimeout(timer);
        reject(new Error('WebSocket connect failed'));
      };
    });
    try {
      await waitForLog(mcpServer, 'Closing previous extension WebSocket', 5_000);
    } finally {
      // Always close the fake WS so orphaned connections don't accumulate on failure
      fakeWs.close();
    }
    await waitForExtensionDisconnected(mcpServer, 5_000);

    // Browser tool should also fail cleanly when extension is disconnected
    const result = await mcpClient.callTool('browser_list_tabs');
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Extension not connected');

    // Wait for extension to reconnect for clean teardown
    await waitForExtensionConnected(mcpServer, 45_000);
  });
});

// ---------------------------------------------------------------------------
// Tool dispatch timeout (extension-side 25s script timeout)
// ---------------------------------------------------------------------------

test.describe('Tool dispatch timeout', () => {
  test('tool call exceeding SCRIPT_TIMEOUT_MS returns a clean timeout error', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // This test waits 25+ seconds for the timeout to fire
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify the tool works normally before adding the delay
    const okOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'pre-timeout' });
    expect(okOutput.message).toBe('pre-timeout');

    // Set the test server delay to 27 seconds — longer than SCRIPT_TIMEOUT_MS (25s)
    // but shorter than DISPATCH_TIMEOUT_MS (30s), so the extension timeout fires first
    await testServer.setSlow(27_000);

    const start = Date.now();
    const result = await mcpClient.callTool('e2e-test_echo', { message: 'should-timeout' });
    const elapsed = Date.now() - start;

    // The extension-side timeout (25s) should produce a clean error
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('timed out');

    // Should take ~25s (the extension timeout), not 30s (the server timeout)
    expect(elapsed).toBeGreaterThan(20_000);
    expect(elapsed).toBeLessThan(29_000);

    // Reset slow mode for clean teardown
    await testServer.setSlow(0);
    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Concurrent tool dispatch timeouts
// ---------------------------------------------------------------------------

test.describe('Concurrent tool dispatch timeouts', () => {
  test('3 concurrent tool calls that all time out return clean errors without interfering', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // This test waits ~25s for the extension-side SCRIPT_TIMEOUT_MS to fire
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify tools work normally before adding the delay
    const okOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
      message: 'pre-concurrent-timeout',
    });
    expect(okOutput.message).toBe('pre-concurrent-timeout');

    // Set the test server delay to 27s — longer than SCRIPT_TIMEOUT_MS (25s)
    await testServer.setSlow(27_000);

    // Fire 3 concurrent tool calls that will all time out
    const start = Date.now();
    const results = await Promise.allSettled([
      mcpClient.callTool('e2e-test_echo', { message: 'timeout-1' }),
      mcpClient.callTool('e2e-test_echo', { message: 'timeout-2' }),
      mcpClient.callTool('e2e-test_echo', { message: 'timeout-3' }),
    ]);
    const elapsed = Date.now() - start;

    // All 3 should resolve (not reject) — the MCP protocol returns timeout
    // as a tool result with isError: true, not as a transport-level failure.
    for (const result of results) {
      expect(result.status).toBe('fulfilled');
      if (result.status !== 'fulfilled') throw new Error('Expected fulfilled');
      expect(result.value.isError).toBe(true);
      expect(result.value.content.toLowerCase()).toContain('timed out');
    }

    // All calls should time out around the same time (~25s SCRIPT_TIMEOUT_MS),
    // not sequentially (which would be ~75s)
    expect(elapsed).toBeGreaterThan(20_000);
    expect(elapsed).toBeLessThan(40_000);

    // Reset slow mode and verify a subsequent normal tool call works
    await testServer.setSlow(0);

    const afterTimeout = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after-concurrent-timeout' },
      { isError: false },
      15_000,
    );
    const afterOutput = parseToolResult(afterTimeout.content);
    expect(afterOutput.message).toBe('after-concurrent-timeout');

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Server-side DISPATCH_TIMEOUT_MS (30s)
// ---------------------------------------------------------------------------

test.describe('Server-side dispatch timeout', () => {
  test('DISPATCH_TIMEOUT_MS fires when extension response never reaches server', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // This test takes ~30s — the full DISPATCH_TIMEOUT_MS duration
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify the tool works normally before the timeout test
    const okOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'pre-timeout' });
    expect(okOutput.message).toBe('pre-timeout');

    // Fire the tool call. The extension receives tool.dispatch and begins
    // executing the adapter. We immediately replace the extension's WS with
    // a fake client. The old WS is closed by the server, but since
    // state.extensionWs now points to the fake WS, the close handler does
    // NOT reject pending dispatches (the `state.extensionWs === ws` check
    // fails for the old WS). The extension's adapter finishes executing and
    // tries to send the result, but the WS is closed so the response never
    // reaches the server. The server's 30s DISPATCH_TIMEOUT_MS fires.

    // Create a fresh MCP client with its own session for the long-timeout call.
    // The standard mcpClient has a 30s fetch timeout that would race with the
    // 30s dispatch timeout, so we use a 45s timeout via the options parameter.
    const timeoutClient = createMcpClient(mcpServer.port, mcpServer.secret);
    await timeoutClient.initialize();
    try {
      // Get the authenticated WS URL and secret
      const { wsUrl, wsSecret: timeoutWsSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);

      // Set the test server to a 60s delay so the adapter is blocked waiting for
      // the HTTP response when we replace the WebSocket. Without this, the echo
      // tool returns instantly and the extension sends the response before we can
      // disconnect it.
      await testServer.setSlow(60_000);

      // Fire the tool call (non-blocking) with a 45s timeout, then immediately
      // steal the extension's WS so the response can never reach the server.
      const start = Date.now();
      const toolCallPromise = timeoutClient.callTool(
        'e2e-test_echo',
        { message: 'should-timeout' },
        { timeout: 45_000 },
      );

      // Poll the test server until the in-flight request arrives
      await waitFor(
        async () => {
          const invocations = await testServer.invocations();
          return invocations.some(
            i => i.path === '/api/echo' && (i.body as Record<string, unknown>).message === 'should-timeout',
          );
        },
        10_000,
        200,
        'in-flight echo tool call to reach test server',
      );

      // Replace the extension's WebSocket with a fake client.
      // The server closes the old WS (triggering a close event), but since
      // state.extensionWs is now the fake WS, the close handler doesn't reject
      // pending dispatches. The extension's response has nowhere to go.
      mcpServer.logs.length = 0;
      const timeoutProtocols = ['opentabs'];
      if (timeoutWsSecret) timeoutProtocols.push(timeoutWsSecret);
      const fakeWs = timeoutProtocols.length > 1 ? new WebSocket(wsUrl, timeoutProtocols) : new WebSocket(wsUrl);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Fake WebSocket connect timeout')), 5_000);
        fakeWs.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        fakeWs.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Fake WebSocket connect failed'));
        };
      });

      try {
        await waitForLog(mcpServer, 'Closing previous extension WebSocket', 5_000);

        // Wait for the server's DISPATCH_TIMEOUT_MS (30s) to fire
        const response = await toolCallPromise;
        const elapsed = Date.now() - start;

        // Verify the server returned a dispatch timeout error
        expect(response.isError).toBe(true);
        expect(response.content.toLowerCase()).toContain('timed out');

        // The timeout should take approximately 30s (DISPATCH_TIMEOUT_MS)
        expect(elapsed).toBeGreaterThan(25_000);
        expect(elapsed).toBeLessThan(40_000);
      } finally {
        // Always close the fake WS so orphaned connections don't accumulate on failure
        fakeWs.close();
      }
    } finally {
      // Always reset slow mode and close the MCP client regardless of test outcome
      // so that leaked sessions and slow-mode state don't affect subsequent tests.
      await testServer.setSlow(0);
      await timeoutClient.close();
    }

    // Verify recovery: wait for the real extension to reconnect, then confirm
    // subsequent tool calls work normally.
    await waitForExtensionConnected(mcpServer, 45_000);
    await waitForLog(mcpServer, 'tab.syncAll received');

    const afterTimeoutResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after-timeout' },
      { isError: false },
      15_000,
    );
    const afterTimeoutOutput = parseToolResult(afterTimeoutResult.content);
    expect(afterTimeoutOutput.message).toBe('after-timeout');

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Tool input validation
// ---------------------------------------------------------------------------

test.describe('Tool input validation', () => {
  test('browser tool with wrong argument type returns Zod validation error', async ({ mcpClient }) => {
    // browser_navigate_tab expects { tabId: number, url: string }
    // Send tabId as a string instead of a number — Zod validation fires server-side
    const result = await mcpClient.callTool('browser_navigate_tab', {
      tabId: 'not-a-number',
      url: 'http://localhost/',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('invalid');
  });

  test('browser tool with missing required field returns Zod validation error', async ({ mcpClient }) => {
    // browser_navigate_tab requires both tabId and url — omit url
    const result = await mcpClient.callTool('browser_navigate_tab', { tabId: 1 });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('invalid');
  });

  test('browser tool with unsafe URL scheme returns Zod validation error', async ({ mcpClient }) => {
    // browser_navigate_tab rejects javascript: URLs via safeUrl Zod refinement
    const result = await mcpClient.callTool('browser_navigate_tab', {
      tabId: 1,
      url: 'javascript:alert(1)',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('plugin tool with missing required field is rejected by server-side validation', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // e2e-test_echo expects { message: string } but we omit it
    // Server-side JSON Schema validation rejects the args before dispatch
    const result = await mcpClient.callTool('e2e-test_echo', {});
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('invalid arguments');
    expect(result.content.toLowerCase()).toContain('message');

    await page.close();
  });

  test('nonexistent tool returns clean error', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('nonexistent_tool', {});
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Malformed WebSocket messages
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tab closing during active in-flight tool dispatch
// ---------------------------------------------------------------------------

test.describe('Tab closing during in-flight dispatch', () => {
  test('tab closed mid-execution returns clean error, not 30s timeout', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify the tool works normally before the test
    const okOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'pre-close' });
    expect(okOutput.message).toBe('pre-close');

    // Set test server delay to 10s — long enough to close the tab while the
    // adapter is blocked in a fetch, short enough to be well under the 25s
    // SCRIPT_TIMEOUT_MS.
    await testServer.setSlow(10_000);

    // Fire the tool call without awaiting — it will block in the adapter's
    // fetch for 10s.
    const start = Date.now();
    const toolCallPromise = mcpClient.callTool('e2e-test_echo', { message: 'should-fail' });

    // Wait until the request actually reaches the test server before closing the tab.
    // This ensures we're testing 'tab closed during in-flight fetch', not 'tab closed
    // before dispatch started'.
    await waitFor(
      async () => {
        const invocations = await testServer.invocations();
        return invocations.some(
          i => i.path === '/api/echo' && (i.body as Record<string, unknown>).message === 'should-fail',
        );
      },
      10_000,
      200,
      'echo request to reach test server',
    );

    // Close the tab — this causes chrome.scripting.executeScript to reject
    // with "No tab with id" or "Cannot access", triggering the catch block
    // in tool-dispatch.ts that returns code -32001.
    await page.close();

    // Await the tool call result — should be a clean error, not a 30s timeout
    const result = await toolCallPromise;
    const elapsed = Date.now() - start;

    expect(result.isError).toBe(true);

    // The error should come back quickly (well under the 25s script timeout)
    expect(elapsed).toBeLessThan(15_000);

    // Reset slow mode for the recovery test
    await testServer.setSlow(0);

    // Open a new tab and verify a subsequent tool call succeeds
    const newPage = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);
    const recoveredResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after-reopen' },
      { isError: false },
      15_000,
    );
    const recoveredOutput = parseToolResult(recoveredResult.content);
    expect(recoveredOutput.message).toBe('after-reopen');

    await newPage.close();
  });
});

// ---------------------------------------------------------------------------
// Malformed WebSocket messages
// ---------------------------------------------------------------------------

test.describe('Malformed WebSocket messages', () => {
  test('invalid JSON, non-object JSON, and missing method+id do not drop the connection', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify tools work before sending malformed messages
    const beforeOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
      message: 'before-malformed',
    });
    expect(beforeOutput.message).toBe('before-malformed');

    // Open a raw WebSocket to the MCP server (replaces the extension's connection).
    // The extension will reconnect and replace the raw WS in turn, so we must
    // send all malformed messages and verify the ping/pong quickly before the
    // extension's reconnect timer fires.
    const { wsUrl: rawWsUrl, wsSecret: rawWsSecret } = await fetchWsInfo(mcpServer.port, mcpServer.secret);
    const rawProtocols = ['opentabs'];
    if (rawWsSecret) rawProtocols.push(rawWsSecret);
    const rawWs = rawProtocols.length > 1 ? new WebSocket(rawWsUrl, rawProtocols) : new WebSocket(rawWsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Raw WebSocket connect timeout')), 5_000);
      rawWs.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      rawWs.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Raw WebSocket connect failed'));
      };
    });

    try {
      await waitForLog(mcpServer, 'Closing previous extension WebSocket', 5_000);

      // Set up the pong listener BEFORE sending any messages, so we don't miss
      // it due to the extension's reconnect racing us.
      const pongPromise = new Promise<boolean>(resolve => {
        const timeout = setTimeout(() => resolve(false), 5_000);
        rawWs.onmessage = event => {
          try {
            const msg = JSON.parse(typeof event.data === 'string' ? event.data : '') as Record<string, unknown>;
            if (msg.method === 'pong') {
              clearTimeout(timeout);
              resolve(true);
            }
          } catch {
            // ignore non-JSON (e.g. sync.full)
          }
        };
      });

      // Send all malformed messages in rapid succession, then a ping to verify
      // the connection is still alive. No waits between messages — the extension
      // may reconnect within ~1s and replace the raw WS.
      // 1. Invalid JSON (not parseable)
      rawWs.send('this is not valid JSON {{{');
      // 2. Valid JSON but a primitive (not an object)
      rawWs.send('"just a string"');
      // 3. Valid JSON array (not an object)
      rawWs.send('[1, 2, 3]');
      // 4. JSON object with neither method nor id
      rawWs.send(JSON.stringify({ jsonrpc: '2.0', data: 'no method or id' }));
      // 5. Verify the connection survived by sending a ping
      rawWs.send(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }));

      const pongReceived = await pongPromise;
      expect(pongReceived).toBe(true);
    } finally {
      // Always close the raw WS so orphaned connections don't accumulate on failure
      rawWs.close();
    }
    // Wait for the real extension to reconnect after the raw WS is closed
    await waitForExtensionConnected(mcpServer, 45_000);
    await waitForLog(mcpServer, 'tab.syncAll received');

    // Verify tool calls still work after the malformed message barrage
    const afterOutput = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after-malformed' },
      { isError: false },
      15_000,
    );
    const afterParsed = parseToolResult(afterOutput.content);
    expect(afterParsed.message).toBe('after-malformed');

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Stale MCP session ID
// ---------------------------------------------------------------------------

test.describe('Stale MCP session ID', () => {
  test('stale session ID returns 400 missing session', async ({ mcpServer }) => {
    const res = await fetch(`http://localhost:${mcpServer.port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': 'nonexistent-session-id-12345',
        ...(mcpServer.secret ? { Authorization: `Bearer ${mcpServer.secret}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 1 }),
      signal: AbortSignal.timeout(5_000),
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text.toLowerCase()).toContain('missing session');
  });
});

// ---------------------------------------------------------------------------
// MCP session invalidation after close
// ---------------------------------------------------------------------------

test.describe('MCP session invalidation after close', () => {
  test('closing MCP session and creating a new one works cleanly', async ({
    mcpServer,
    extensionContext: _extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);

    // Client A: create, initialize, call browser_list_tabs — verify success
    const clientA = createMcpClient(mcpServer.port, mcpServer.secret);
    await clientA.initialize();

    const resultA = await clientA.callTool('browser_list_tabs');
    expect(resultA.isError).toBe(false);

    // Close client A (sends DELETE to terminate the session)
    await clientA.close();

    // Client B: create on the same server port, initialize, verify tools work
    const clientB = createMcpClient(mcpServer.port, mcpServer.secret);
    await clientB.initialize();

    const resultB = await clientB.callTool('browser_list_tabs');
    expect(resultB.isError).toBe(false);

    // Close client B
    await clientB.close();
  });
});

// ---------------------------------------------------------------------------
// Stress — rapid concurrent calls interleaved with tab navigation
// ---------------------------------------------------------------------------

test.describe('stress', () => {
  test('10 concurrent echo calls interleaved with tab navigation all settle correctly within 20s', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Fire 10 concurrent echo calls with distinct messages
    const messages = Array.from({ length: 10 }, (_, i) => `rapid-${i}`);
    const start = Date.now();
    const promises = messages.map(msg => mcpClient.callTool('e2e-test_echo', { message: msg }));

    // Immediately navigate the tab to a non-matching URL
    await page.goto(`${testServer.url.replace('localhost', '127.0.0.1')}/non-matching`, {
      waitUntil: 'load',
      timeout: 15_000,
    });

    // Wait for all 10 promises to settle
    const results = await Promise.allSettled(promises);
    const elapsed = Date.now() - start;

    // All 10 must settle within 20s wall-clock (no 30s dispatch timeout hang)
    expect(elapsed).toBeLessThan(20_000);

    // All promises must fulfill (MCP protocol returns errors as fulfilled results with isError=true)
    for (const result of results) {
      expect(result.status).toBe('fulfilled');
    }

    // Validate each result: either correct echo or valid error
    const successMessages: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result?.status !== 'fulfilled') throw new Error(`Unexpected rejected promise at index ${i}`);
      const val = result.value;

      if (val.isError) {
        // Failed calls must have errors matching the expected pattern
        expect(val.content).toMatch(/unavailable|not ready|closed|no matching tab/i);
      } else {
        // Successful calls must have the correct positional message
        const parsed = parseToolResult(val.content);
        expect(parsed.message).toBe(messages[i]);
        successMessages.push(parsed.message as string);
      }
    }

    // No two successful results contain the same message
    const uniqueSuccesses = new Set(successMessages);
    expect(uniqueSuccesses.size).toBe(successMessages.length);

    // After test, server health returns status='ok'
    const health = await mcpServer.health();
    expect(health).not.toBeNull();
    expect(health?.status).toBe('ok');

    await page.close();
  });
});
