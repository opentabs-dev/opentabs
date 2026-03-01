/**
 * Multi-tab targeting E2E tests — verify the full pipeline:
 *   MCP client → server → extension → specific tab → response
 *
 * Covers:
 *   - plugin_list_tabs discovering multiple matching tabs
 *   - Targeted tool dispatch via tabId to a specific tab
 *   - Error handling for non-matching and non-existent tabId
 *   - Auto-select fallback when tabId is omitted
 *   - Readiness reporting per tab
 */

import { test, expect } from './fixtures.js';
import {
  openTestAppTab,
  parseToolResult,
  waitForToolResult,
  setupToolTest,
  waitFor,
  callToolExpectSuccess,
} from './helpers.js';

/** Shape of plugin_list_tabs response entries. */
interface PluginTabsEntry {
  plugin: string;
  displayName: string;
  state: string;
  tabs: Array<{ tabId: number; url: string; title: string; ready: boolean }>;
}

/**
 * Poll plugin_list_tabs until the e2e-test plugin reports at least `count` tabs.
 * Returns the parsed response array.
 */
const waitForTabCount = async (
  callTool: (name: string, args: Record<string, unknown>) => Promise<{ content: string; isError: boolean }>,
  count: number,
  timeoutMs = 15_000,
): Promise<PluginTabsEntry[]> => {
  let last: PluginTabsEntry[] = [];
  await waitFor(
    async () => {
      const result = await callTool('plugin_list_tabs', { plugin: 'e2e-test' });
      if (result.isError) return false;
      last = JSON.parse(result.content) as PluginTabsEntry[];
      const entry = last[0];
      return entry !== undefined && entry.tabs.length >= count;
    },
    timeoutMs,
    500,
    `plugin_list_tabs to report ${count} tab(s)`,
  );
  return last;
};

// ---------------------------------------------------------------------------
// Test 1: plugin_list_tabs discovers multiple matching tabs
// ---------------------------------------------------------------------------

test.describe('Multi-tab targeting — plugin_list_tabs', () => {
  test('lists both tabs with correct URLs and tab IDs when two tabs match the same plugin', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // Open first tab and wait for ready
    const page1 = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Open second tab to the same test server
    const page2 = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    // Wait for the second tab's adapter to be fully ready
    await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

    // Wait for the server to receive updated tab state with two tabs
    const plugins = await waitForTabCount(mcpClient.callTool.bind(mcpClient), 2);

    expect(plugins.length).toBe(1);
    const pluginInfo = plugins[0];
    if (!pluginInfo) throw new Error('Expected plugin entry in plugin_list_tabs response');

    expect(pluginInfo.plugin).toBe('e2e-test');
    expect(pluginInfo.state).toBe('ready');
    expect(pluginInfo.tabs.length).toBe(2);

    // Both tabs should have valid tab IDs and URLs matching the test server
    for (const tab of pluginInfo.tabs) {
      expect(tab.tabId).toBeGreaterThan(0);
      expect(tab.url).toContain('localhost');
      expect(tab.ready).toBe(true);
    }

    // Tab IDs should be distinct
    const tabIds = pluginInfo.tabs.map(t => t.tabId);
    expect(new Set(tabIds).size).toBe(2);

    await page1.close();
    await page2.close();
  });
});

// ---------------------------------------------------------------------------
// Test 2: Targeted dispatch via tabId executes on the correct tab
// ---------------------------------------------------------------------------

test.describe('Multi-tab targeting — targeted dispatch', () => {
  test('tool call with tabId executes on the specified tab', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // Open first tab and wait for ready
    const page1 = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Set a unique marker on page1
    await page1.evaluate(() => {
      (globalThis as Record<string, unknown>).__tabMarker = 'tab-one';
    });

    // Open second tab
    const page2 = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    // Set a different marker on page2
    await page2.evaluate(() => {
      (globalThis as Record<string, unknown>).__tabMarker = 'tab-two';
    });

    // Wait for both tabs to be tracked
    const plugins = await waitForTabCount(mcpClient.callTool.bind(mcpClient), 2);

    const entry = plugins[0];
    if (!entry) throw new Error('Expected plugin entry in plugin_list_tabs response');
    expect(entry.tabs.length).toBe(2);

    const firstTab = entry.tabs[0];
    const secondTab = entry.tabs[1];
    if (!firstTab || !secondTab) throw new Error('Expected two tab entries');

    // Read markers from each tab to identify which is which.
    // browser_execute_script returns { value: { value: <actual>, type: ... } }
    const marker1Result = await mcpClient.callTool('browser_execute_script', {
      tabId: firstTab.tabId,
      code: 'return globalThis.__tabMarker',
    });
    expect(marker1Result.isError).toBe(false);
    const marker1Data = parseToolResult(marker1Result.content);
    const marker1Nested = marker1Data.value as Record<string, unknown>;
    const marker1Value = marker1Nested.value as string;

    // Determine which tabId is 'tab-one' and which is 'tab-two'
    let tabOneId: number;
    let tabTwoId: number;
    if (marker1Value === 'tab-one') {
      tabOneId = firstTab.tabId;
      tabTwoId = secondTab.tabId;
    } else {
      tabOneId = secondTab.tabId;
      tabTwoId = firstTab.tabId;
    }

    // Call sdk_get_page_global with tabId targeting 'tab-two'
    const targetResult = await mcpClient.callTool('e2e-test_sdk_get_page_global', {
      path: '__tabMarker',
      tabId: tabTwoId,
    });
    expect(targetResult.isError).toBe(false);
    const targetParsed = parseToolResult(targetResult.content);
    expect(targetParsed.value).toBe('tab-two');

    // Verify targeting the other tab returns 'tab-one'
    const otherResult = await mcpClient.callTool('e2e-test_sdk_get_page_global', {
      path: '__tabMarker',
      tabId: tabOneId,
    });
    expect(otherResult.isError).toBe(false);
    const otherParsed = parseToolResult(otherResult.content);
    expect(otherParsed.value).toBe('tab-one');

    await page1.close();
    await page2.close();
  });
});

// ---------------------------------------------------------------------------
// Test 3: Non-matching tab URL returns error
// ---------------------------------------------------------------------------

test.describe('Multi-tab targeting — URL mismatch', () => {
  test('tool call with tabId pointing to a non-matching tab returns URL mismatch error', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // Open a matching tab so the plugin is available
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Open a non-matching tab (use 127.0.0.1 instead of localhost — different origin)
    const nonMatchingPage = await extensionContext.newPage();
    await nonMatchingPage.goto(testServer.url.replace('localhost', '127.0.0.1'), {
      waitUntil: 'load',
    });

    // Get the non-matching tab's ID via browser_list_tabs.
    // browser_list_tabs returns { id, title, url, active, windowId } per tab.
    const listTabsResult = await mcpClient.callTool('browser_list_tabs');
    expect(listTabsResult.isError).toBe(false);
    const allTabs = JSON.parse(listTabsResult.content) as Array<{
      id: number;
      url: string;
    }>;

    // Find the tab with 127.0.0.1 URL
    const nonMatchingTab = allTabs.find(t => t.url.includes('127.0.0.1'));
    if (!nonMatchingTab) throw new Error('Could not find non-matching tab with 127.0.0.1 URL');

    // Call a plugin tool with the non-matching tab's ID
    const result = await mcpClient.callTool('e2e-test_echo', {
      message: 'should-fail',
      tabId: nonMatchingTab.id,
    });

    expect(result.isError).toBe(true);
    // The error should mention URL not matching
    expect(result.content.toLowerCase()).toMatch(/url|pattern|match/);

    await nonMatchingPage.close();
    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Non-existent tabId returns clean error
// ---------------------------------------------------------------------------

test.describe('Multi-tab targeting — non-existent tab', () => {
  test('tool call with non-existent tabId returns clean error', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // Open a matching tab so the plugin is available
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Call a plugin tool with a non-existent tab ID
    const result = await mcpClient.callTool('e2e-test_echo', {
      message: 'should-fail',
      tabId: 999999,
    });

    expect(result.isError).toBe(true);
    // The error should mention the tab not being found / no usable tab
    expect(result.content.toLowerCase()).toMatch(/tab|not found|no usable/);

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Test 5: Auto-select when tabId is omitted with multiple tabs
// ---------------------------------------------------------------------------

test.describe('Multi-tab targeting — auto-select fallback', () => {
  test('tool call without tabId dispatches to best-ranked tab when multiple tabs are open', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // Open first tab and wait for ready
    const page1 = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Open second tab
    const page2 = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    // Wait for both tabs to be tracked
    await waitForTabCount(mcpClient.callTool.bind(mcpClient), 2);

    // Call echo WITHOUT tabId — should auto-select and succeed
    const result = await mcpClient.callTool('e2e-test_echo', { message: 'auto-select' });
    expect(result.isError).toBe(false);
    const parsed = parseToolResult(result.content);
    expect(parsed.message).toBe('auto-select');

    // Verify the tool actually dispatched (test server received the call)
    const invocations = await testServer.invocations();
    const echoInvocations = invocations.filter(
      i => i.path === '/api/echo' && (i.body as Record<string, unknown>).message === 'auto-select',
    );
    expect(echoInvocations.length).toBe(1);

    await page1.close();
    await page2.close();
  });
});

// ---------------------------------------------------------------------------
// Test 6: plugin_list_tabs returns readiness info
// ---------------------------------------------------------------------------

test.describe('Multi-tab targeting — readiness info', () => {
  test('plugin_list_tabs shows ready:true for matching tabs with injected adapters', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // Open a matching tab and wait for ready
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Call plugin_list_tabs
    const result = await mcpClient.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
    expect(result.isError).toBe(false);

    const plugins = JSON.parse(result.content) as PluginTabsEntry[];

    expect(plugins.length).toBe(1);
    const pluginInfo = plugins[0];
    if (!pluginInfo) throw new Error('Expected plugin entry in plugin_list_tabs response');

    expect(pluginInfo.state).toBe('ready');
    expect(pluginInfo.tabs.length).toBeGreaterThanOrEqual(1);

    // The tab should be marked as ready
    const readyTab = pluginInfo.tabs[0];
    if (!readyTab) throw new Error('Expected at least one tab entry');
    expect(readyTab.ready).toBe(true);
    expect(readyTab.tabId).toBeGreaterThan(0);
    expect(readyTab.url).toContain('localhost');

    // plugin_list_tabs without plugin arg returns all plugins
    const allResult = await mcpClient.callTool('plugin_list_tabs', {});
    expect(allResult.isError).toBe(false);
    const allPlugins = JSON.parse(allResult.content) as PluginTabsEntry[];
    // Should include e2e-test
    const e2ePlugin = allPlugins.find(p => p.plugin === 'e2e-test');
    if (!e2ePlugin) throw new Error('Expected e2e-test plugin in all-plugins response');
    expect(e2ePlugin.tabs.length).toBeGreaterThanOrEqual(1);
    const firstTab = e2ePlugin.tabs[0];
    if (!firstTab) throw new Error('Expected at least one tab in e2e-test plugin');
    expect(firstTab.ready).toBe(true);

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Test 7: Targeted dispatch to unavailable (not-ready) tab
// ---------------------------------------------------------------------------

test.describe('Multi-tab targeting — targeted dispatch to unavailable tab', () => {
  test('tool call with tabId targeting an unavailable tab returns -32002 error with no fallback', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // Open a matching tab and wait for ready
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Get the tab's ID via plugin_list_tabs
    const plugins = await waitForTabCount(mcpClient.callTool.bind(mcpClient), 1);
    const entry = plugins[0];
    if (!entry) throw new Error('Expected plugin entry in plugin_list_tabs response');
    const tab = entry.tabs[0];
    if (!tab) throw new Error('Expected at least one tab entry');
    const targetTabId = tab.tabId;
    expect(targetTabId).toBeGreaterThan(0);

    // Toggle auth off — this makes isReady() return false
    await testServer.setAuth(false);

    // Reload the page to trigger adapter re-injection and readiness re-probe.
    // After reload, the extension re-probes isReady() which calls /api/auth.check
    // and gets { ok: false }, so the tab transitions to unavailable.
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      },
      { timeout: 10_000 },
    );

    // Wait for the tab state to become unavailable by polling plugin_list_tabs
    await waitFor(
      async () => {
        const result = await mcpClient.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
        if (result.isError) return false;
        const data = JSON.parse(result.content) as PluginTabsEntry[];
        const e2eEntry = data[0];
        if (!e2eEntry) return false;
        const targetTab = e2eEntry.tabs.find(t => t.tabId === targetTabId);
        return targetTab !== undefined && !targetTab.ready;
      },
      15_000,
      500,
      'tab to become unavailable (ready:false)',
    );

    // Reset invocations to get a clean baseline for verifying no fallback
    await testServer.reset();
    // Restore auth=false after reset (reset sets auth=true)
    await testServer.setAuth(false);

    // Call a plugin tool with the explicit tabId of the unavailable tab
    const result = await mcpClient.callTool('e2e-test_echo', {
      message: 'should-fail-unavailable',
      tabId: targetTabId,
    });

    // Expect isError:true with content mentioning 'unavailable'
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('unavailable');

    // Verify no fallback: the test server should have received zero echo
    // invocations (only auth.check calls from isReady probes)
    const invocations = await testServer.invocations();
    const echoInvocations = invocations.filter(i => i.path === '/api/echo');
    expect(echoInvocations.length).toBe(0);

    // Clean up: restore auth
    await testServer.setAuth(true);
    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Test 8: plugin_list_tabs reflects mixed readiness across tabs
// ---------------------------------------------------------------------------

test.describe('Multi-tab targeting — mixed readiness', () => {
  test('plugin_list_tabs reports one tab ready:true and another ready:false for the same plugin', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // Open first tab and wait for ready
    const page1 = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Open second tab to the same test server
    const page2 = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    // Wait for both tabs to be tracked AND ready. waitForTabCount only
    // checks tabs.length >= 2, but a newly-tracked tab may still be in its
    // readiness probe phase. Poll until every tab reports ready:true.
    let initialEntry: PluginTabsEntry | undefined;
    await waitFor(
      async () => {
        const result = await mcpClient.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
        if (result.isError) return false;
        const data = JSON.parse(result.content) as PluginTabsEntry[];
        initialEntry = data[0];
        return initialEntry !== undefined && initialEntry.tabs.length === 2 && initialEntry.tabs.every(t => t.ready);
      },
      15_000,
      500,
      'plugin_list_tabs to report 2 tabs both ready:true',
    );
    if (!initialEntry) throw new Error('Expected plugin entry in plugin_list_tabs response');
    expect(initialEntry.tabs.length).toBe(2);
    expect(initialEntry.tabs.every(t => t.ready)).toBe(true);

    // Intercept auth.check requests on page2 so the adapter's isReady()
    // returns false. page.route() is per-page and survives reloads, so
    // page1's auth.check calls are unaffected.
    await page2.route('**/api/auth.check', route => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false }),
      });
    });

    // Reload page2 to trigger adapter re-injection and readiness re-probe.
    // The fresh adapter's isReady() calls fetch('/api/auth.check') which
    // Playwright intercepts, returning { ok: false }.
    await page2.reload({ waitUntil: 'load' });
    await page2.waitForFunction(
      () => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      },
      { timeout: 10_000 },
    );

    // Poll plugin_list_tabs until we see mixed readiness: one tab ready:true,
    // one tab ready:false
    await waitFor(
      async () => {
        const result = await mcpClient.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
        if (result.isError) return false;
        const data = JSON.parse(result.content) as PluginTabsEntry[];
        const entry = data[0];
        if (!entry || entry.tabs.length !== 2) return false;
        const readyCount = entry.tabs.filter(t => t.ready).length;
        const notReadyCount = entry.tabs.filter(t => !t.ready).length;
        return readyCount === 1 && notReadyCount === 1;
      },
      15_000,
      500,
      'plugin_list_tabs to show mixed readiness (1 ready, 1 not ready)',
    );

    // Final verification: read the plugin_list_tabs response and assert
    const finalResult = await mcpClient.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
    expect(finalResult.isError).toBe(false);
    const finalPlugins = JSON.parse(finalResult.content) as PluginTabsEntry[];
    const finalEntry = finalPlugins[0];
    if (!finalEntry) throw new Error('Expected plugin entry in final plugin_list_tabs response');

    // The plugin should still be in 'ready' state (aggregate) because one
    // tab is still ready
    expect(finalEntry.state).toBe('ready');
    expect(finalEntry.tabs.length).toBe(2);

    // Verify exactly one tab is ready and one is not
    const readyTabs = finalEntry.tabs.filter(t => t.ready);
    const notReadyTabs = finalEntry.tabs.filter(t => !t.ready);
    expect(readyTabs.length).toBe(1);
    expect(notReadyTabs.length).toBe(1);

    // Both tabs should have distinct, valid tab IDs
    const tabIds = finalEntry.tabs.map(t => t.tabId);
    expect(new Set(tabIds).size).toBe(2);
    for (const tab of finalEntry.tabs) {
      expect(tab.tabId).toBeGreaterThan(0);
    }

    await page1.close();
    await page2.close();
  });
});

// ---------------------------------------------------------------------------
// Test 10: Concurrent targeted dispatches to different tabs
// ---------------------------------------------------------------------------

test.describe('Multi-tab targeting — concurrent targeted dispatches', () => {
  test('two concurrent tool calls targeting different tabs via tabId both return the correct marker', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // Open first tab and wait for ready
    const page1 = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Set a unique marker on page1
    await page1.evaluate(() => {
      (globalThis as Record<string, unknown>).__tabMarker = 'alpha';
    });

    // Open second tab
    const page2 = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    // Set a different marker on page2
    await page2.evaluate(() => {
      (globalThis as Record<string, unknown>).__tabMarker = 'beta';
    });

    // Wait for both tabs to be tracked
    const plugins = await waitForTabCount(mcpClient.callTool.bind(mcpClient), 2);

    const entry = plugins[0];
    if (!entry) throw new Error('Expected plugin entry in plugin_list_tabs response');
    expect(entry.tabs.length).toBe(2);

    const firstTab = entry.tabs[0];
    const secondTab = entry.tabs[1];
    if (!firstTab || !secondTab) throw new Error('Expected two tab entries');

    // Read marker from firstTab to identify which tabId maps to which marker
    const marker1Result = await mcpClient.callTool('browser_execute_script', {
      tabId: firstTab.tabId,
      code: 'return globalThis.__tabMarker',
    });
    expect(marker1Result.isError).toBe(false);
    const marker1Data = parseToolResult(marker1Result.content);
    const marker1Nested = marker1Data.value as Record<string, unknown>;
    const marker1Value = marker1Nested.value as string;

    // Determine which tabId is 'alpha' and which is 'beta'
    let tabAlphaId: number;
    let tabBetaId: number;
    if (marker1Value === 'alpha') {
      tabAlphaId = firstTab.tabId;
      tabBetaId = secondTab.tabId;
    } else {
      tabAlphaId = secondTab.tabId;
      tabBetaId = firstTab.tabId;
    }

    // Launch two concurrent tool calls targeting different tabs
    const [alphaResult, betaResult] = await Promise.all([
      mcpClient.callTool('e2e-test_sdk_get_page_global', {
        path: '__tabMarker',
        tabId: tabAlphaId,
      }),
      mcpClient.callTool('e2e-test_sdk_get_page_global', {
        path: '__tabMarker',
        tabId: tabBetaId,
      }),
    ]);

    // Verify each result has the correct marker — no cross-talk
    expect(alphaResult.isError).toBe(false);
    const alphaParsed = parseToolResult(alphaResult.content);
    expect(alphaParsed.value).toBe('alpha');

    expect(betaResult.isError).toBe(false);
    const betaParsed = parseToolResult(betaResult.content);
    expect(betaParsed.value).toBe('beta');

    await page1.close();
    await page2.close();
  });
});

// ---------------------------------------------------------------------------
// Test 11: plugin_list_tabs updates in real-time as tabs open and close
// ---------------------------------------------------------------------------

test.describe('Multi-tab targeting — real-time tab tracking', () => {
  test('plugin_list_tabs reflects tab opens and closes in real-time', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // Step 1: Open tab 1 → verify plugin_list_tabs shows 1 tab
    const page1 = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);
    const plugins1 = await waitForTabCount(mcpClient.callTool.bind(mcpClient), 1);
    const entry1 = plugins1[0];
    if (!entry1) throw new Error('Expected plugin entry after opening tab 1');
    expect(entry1.state).toBe('ready');
    expect(entry1.tabs.length).toBe(1);
    const tab1 = entry1.tabs[0];
    if (!tab1) throw new Error('Expected tab entry for tab 1');
    expect(tab1.ready).toBe(true);
    const tab1Id = tab1.tabId;

    // Step 2: Open tab 2 → verify shows 2 tabs with distinct IDs
    const page2 = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);
    const plugins2 = await waitForTabCount(mcpClient.callTool.bind(mcpClient), 2);
    const entry2 = plugins2[0];
    if (!entry2) throw new Error('Expected plugin entry after opening tab 2');
    expect(entry2.state).toBe('ready');
    expect(entry2.tabs.length).toBe(2);
    const tabIds2 = entry2.tabs.map(t => t.tabId);
    expect(new Set(tabIds2).size).toBe(2);
    // Tab 1's ID should still be present
    expect(tabIds2).toContain(tab1Id);
    const tab2Id = tabIds2.find(id => id !== tab1Id);
    if (tab2Id === undefined) throw new Error('Could not determine tab 2 ID');

    // Step 3: Close tab 1 → verify shows 1 tab with tab 2's ID
    await page1.close();
    await waitFor(
      async () => {
        const result = await mcpClient.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
        if (result.isError) return false;
        const data = JSON.parse(result.content) as PluginTabsEntry[];
        const entry = data[0];
        return entry !== undefined && entry.tabs.length === 1;
      },
      15_000,
      500,
      'plugin_list_tabs to report 1 tab after closing tab 1',
    );

    // Verify the remaining tab is specifically tab 2
    const result3 = await mcpClient.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
    expect(result3.isError).toBe(false);
    const plugins3 = JSON.parse(result3.content) as PluginTabsEntry[];
    const entry3 = plugins3[0];
    if (!entry3) throw new Error('Expected plugin entry after closing tab 1');
    expect(entry3.state).toBe('ready');
    expect(entry3.tabs.length).toBe(1);
    const remainingTab = entry3.tabs[0];
    if (!remainingTab) throw new Error('Expected remaining tab entry');
    expect(remainingTab.tabId).toBe(tab2Id);
    expect(remainingTab.ready).toBe(true);

    // Step 4: Close tab 2 → verify state becomes 'closed'
    await page2.close();
    await waitFor(
      async () => {
        const result = await mcpClient.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
        if (result.isError) return false;
        const data = JSON.parse(result.content) as PluginTabsEntry[];
        const entry = data[0];
        return entry !== undefined && entry.state === 'closed';
      },
      15_000,
      500,
      'plugin_list_tabs to report state:closed after closing all tabs',
    );

    // Final verification: state is closed with empty tabs array
    const result4 = await mcpClient.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
    expect(result4.isError).toBe(false);
    const plugins4 = JSON.parse(result4.content) as PluginTabsEntry[];
    const entry4 = plugins4[0];
    if (!entry4) throw new Error('Expected plugin entry after closing all tabs');
    expect(entry4.state).toBe('closed');
    expect(entry4.tabs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 9: Targeted dispatch to tab that closes mid-execution
// ---------------------------------------------------------------------------

test.describe('Multi-tab targeting — tab closes mid-execution', () => {
  test('targeted dispatch to a tab that closes during execution returns clean error with no fallback', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    // Open first tab and wait for ready
    const page1 = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Open second tab
    const page2 = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    // Wait for both tabs to be tracked
    const plugins = await waitForTabCount(mcpClient.callTool.bind(mcpClient), 2);

    const entry = plugins[0];
    if (!entry) throw new Error('Expected plugin entry in plugin_list_tabs response');
    expect(entry.tabs.length).toBe(2);

    const firstTab = entry.tabs[0];
    const secondTab = entry.tabs[1];
    if (!firstTab || !secondTab) throw new Error('Expected two tab entries');

    // Set unique markers on each page to identify which tabId maps to which page
    await page1.evaluate(() => {
      (globalThis as Record<string, unknown>).__tabMarker = 'page-one';
    });
    await page2.evaluate(() => {
      (globalThis as Record<string, unknown>).__tabMarker = 'page-two';
    });

    // Identify which tabId maps to page1 vs page2
    const marker1Result = await mcpClient.callTool('browser_execute_script', {
      tabId: firstTab.tabId,
      code: 'return globalThis.__tabMarker',
    });
    expect(marker1Result.isError).toBe(false);
    const marker1Data = parseToolResult(marker1Result.content);
    const marker1Nested = marker1Data.value as Record<string, unknown>;
    const marker1Value = marker1Nested.value as string;

    let pageOneTabId: number;
    let pageTwoTabId: number;
    if (marker1Value === 'page-one') {
      pageOneTabId = firstTab.tabId;
      pageTwoTabId = secondTab.tabId;
    } else {
      pageOneTabId = secondTab.tabId;
      pageTwoTabId = firstTab.tabId;
    }

    // Verify tools work normally before adding the delay
    const okOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
      message: 'pre-close',
    });
    expect(okOutput.message).toBe('pre-close');

    // Set test server delay to 10s — long enough to close the tab while the
    // adapter is blocked in a fetch, short enough to be well under the 25s
    // SCRIPT_TIMEOUT_MS.
    await testServer.setSlow(10_000);

    // Reset invocations to get a clean baseline for verifying no fallback
    await testServer.reset();
    // Restore slow mode after reset (reset clears it)
    await testServer.setSlow(10_000);

    // Fire the tool call targeting page1's tab — it will block in the adapter's
    // fetch for 10s.
    const start = Date.now();
    const toolCallPromise = mcpClient.callTool('e2e-test_echo', {
      message: 'should-fail-close',
      tabId: pageOneTabId,
    });

    // Wait until the request actually reaches the test server before closing the tab
    await waitFor(
      async () => {
        const invocations = await testServer.invocations();
        return invocations.some(
          i => i.path === '/api/echo' && (i.body as Record<string, unknown>).message === 'should-fail-close',
        );
      },
      10_000,
      200,
      'echo request to reach test server',
    );

    // Close page1 — this causes chrome.scripting.executeScript to reject,
    // triggering the catch block in tool-dispatch.ts that returns an error.
    await page1.close();

    // Await the tool call result — should be a clean error, not a 30s timeout
    const result = await toolCallPromise;
    const elapsed = Date.now() - start;

    expect(result.isError).toBe(true);

    // The error should come back quickly (well under the 25s script timeout)
    expect(elapsed).toBeLessThan(15_000);

    // Verify the other tab (page2) was NOT used as a fallback. Only one echo
    // invocation should exist (the one sent to page1 that was interrupted).
    const invocations = await testServer.invocations();
    const echoInvocations = invocations.filter(
      i => i.path === '/api/echo' && (i.body as Record<string, unknown>).message === 'should-fail-close',
    );
    expect(echoInvocations.length).toBe(1);

    // Reset slow mode for clean teardown
    await testServer.setSlow(0);

    // Verify the second tab is still functional (no cross-contamination)
    const page2Result = await mcpClient.callTool('e2e-test_echo', {
      message: 'page2-still-works',
      tabId: pageTwoTabId,
    });
    expect(page2Result.isError).toBe(false);
    const page2Parsed = parseToolResult(page2Result.content);
    expect(page2Parsed.message).toBe('page2-still-works');

    await page2.close();
  });
});
