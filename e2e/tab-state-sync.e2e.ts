/**
 * Tab state sync E2E tests — verify the extension correctly tracks and reports
 * tab state transitions to the MCP server across various scenarios:
 *
 * - Navigate away from matching URL → state transitions to 'closed'
 * - Multi-tab resilience → plugin stays ready when one matching tab is closed
 * - Rapid close/reopen → state recovers correctly (US-005)
 * - Server restart reconnect → tab state re-synced via tab.syncAll
 */

import { test, expect } from './fixtures.js';
import { openTestAppTab, setupToolTest, waitForToolResult } from './helpers.js';

// ---------------------------------------------------------------------------
// US-003: Navigate away → closed transition
// ---------------------------------------------------------------------------

test.describe('Tab state sync — navigate away', () => {
  test('tab state transitions to closed when navigating away from matching URL', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // 1. Open a matching tab and wait for ready state
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // 2. Verify the server reports 'ready' state
    await expect
      .poll(
        async () => {
          const res = await fetch(`http://localhost:${mcpServer.port}/health`);
          const body = (await res.json()) as {
            pluginDetails?: Array<{ name: string; tabState: string }>;
          };
          return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
        },
        { timeout: 15_000, message: 'Server tab state for e2e-test should be ready' },
      )
      .toBe('ready');

    // 3. Navigate the tab to a non-matching URL.
    // The e2e-test plugin matches http://localhost/* — navigating to a
    // different origin causes the extension to detect no matching tabs.
    await page.goto('https://example.com', { waitUntil: 'load' });

    // 4. Poll /health until tabState becomes 'closed'
    await expect
      .poll(
        async () => {
          const res = await fetch(`http://localhost:${mcpServer.port}/health`);
          const body = (await res.json()) as {
            pluginDetails?: Array<{ name: string; tabState: string }>;
          };
          return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
        },
        {
          timeout: 30_000,
          message: 'Server tab state for e2e-test did not transition to closed after navigating away',
        },
      )
      .toBe('closed');

    // 5. Verify tool dispatch returns an error when no matching tab is open
    const result = await mcpClient.callTool('e2e-test_echo', { message: 'should fail' });
    expect(result.isError).toBe(true);

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// US-004: Multi-tab resilience — plugin stays ready when one tab is closed
// ---------------------------------------------------------------------------

test.describe('Tab state sync — multi-tab resilience', () => {
  test('plugin stays ready when one of multiple matching tabs is closed', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // 1. Open the first matching tab and wait for ready state
    const page1 = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // 2. Open a second matching tab to the same test server
    const page2 = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    // Wait for the second tab's adapter to be fully ready (tool calls succeed)
    await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

    // 3. Verify the server reports 'ready' state
    await expect
      .poll(
        async () => {
          const res = await fetch(`http://localhost:${mcpServer.port}/health`);
          const body = (await res.json()) as {
            pluginDetails?: Array<{ name: string; tabState: string }>;
          };
          return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
        },
        { timeout: 15_000, message: 'Server tab state for e2e-test should be ready with two tabs' },
      )
      .toBe('ready');

    // 4. Close the first tab
    await page1.close();

    // 5. Verify state is still 'ready' — the second tab keeps the plugin alive.
    // Give the extension time to process the onRemoved event and recompute state.
    await expect
      .poll(
        async () => {
          const res = await fetch(`http://localhost:${mcpServer.port}/health`);
          const body = (await res.json()) as {
            pluginDetails?: Array<{ name: string; tabState: string }>;
          };
          return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
        },
        { timeout: 15_000, message: 'Server tab state for e2e-test should still be ready after closing one tab' },
      )
      .toBe('ready');

    // 6. Verify tool dispatch still succeeds via the remaining tab
    const result = await mcpClient.callTool('e2e-test_echo', { message: 'still alive' });
    expect(result.isError).toBe(false);

    // 7. Close the second (last) tab
    await page2.close();

    // 8. Verify state transitions to 'closed' — no matching tabs remain
    await expect
      .poll(
        async () => {
          const res = await fetch(`http://localhost:${mcpServer.port}/health`);
          const body = (await res.json()) as {
            pluginDetails?: Array<{ name: string; tabState: string }>;
          };
          return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
        },
        {
          timeout: 30_000,
          message: 'Server tab state for e2e-test did not transition to closed after closing all tabs',
        },
      )
      .toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// US-005: Rapid close-and-reopen — state recovers correctly
// ---------------------------------------------------------------------------

test.describe('Tab state sync — rapid close and reopen', () => {
  test('tab state recovers after rapid close-and-reopen cycle', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // 1. Open a matching tab and wait for ready state
    const page1 = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // 2. Verify the server reports 'ready' state
    await expect
      .poll(
        async () => {
          const res = await fetch(`http://localhost:${mcpServer.port}/health`);
          const body = (await res.json()) as {
            pluginDetails?: Array<{ name: string; tabState: string }>;
          };
          return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
        },
        { timeout: 15_000, message: 'Server tab state for e2e-test should be ready' },
      )
      .toBe('ready');

    // 3. Close the tab and immediately open a new one — do NOT wait for
    // the state to settle. This exercises the pluginLocks serialization in
    // tab-state.ts: the close triggers checkTabStateChanges with removed=true,
    // and the new tab's onUpdated status=complete fires shortly after. Both
    // events must be serialized correctly per-plugin.
    await page1.close();
    const page2 = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    // 4. Wait for the plugin to reach 'ready' state on the new tab
    await expect
      .poll(
        async () => {
          const res = await fetch(`http://localhost:${mcpServer.port}/health`);
          const body = (await res.json()) as {
            pluginDetails?: Array<{ name: string; tabState: string }>;
          };
          return body.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
        },
        {
          timeout: 30_000,
          message: 'Server tab state for e2e-test did not recover to ready after rapid close/reopen',
        },
      )
      .toBe('ready');

    // 5. Verify tool dispatch succeeds on the new tab
    await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'recovered' }, { isError: false }, 15_000);

    const result = await mcpClient.callTool('e2e-test_echo', { message: 'hello from new tab' });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('hello from new tab');

    await page2.close();
  });
});
