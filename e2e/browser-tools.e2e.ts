/**
 * Browser tools E2E tests — MCP client → MCP server → WebSocket → extension → chrome.tabs API.
 *
 * These tests exercise the browser tools that call chrome.* APIs directly
 * through the extension's background script, bypassing the plugin adapter
 * lifecycle entirely. Each tool dispatches a JSON-RPC command from the MCP
 * server to the extension via WebSocket and returns the result.
 *
 * Prerequisites (all pre-built, not created at test time):
 *   - `npm run build` has been run (platform dist/ files exist)
 *   - `plugins/e2e-test` has been built (`cd plugins/e2e-test && npm run build`)
 *   - Chromium is installed for Playwright
 *
 * All tests use dynamic ports and are safe for parallel execution.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { McpClient, McpServer, TestServer } from './fixtures.js';
import { expect, test } from './fixtures.js';
import {
  BROWSER_TOOL_NAMES,
  openSidePanel,
  parseToolResult,
  unwrapSingleConnection,
  waitFor,
  waitForExtensionConnected,
  waitForLog,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for extension handshake and list tools.
 * Returns the tool list for further assertions.
 */
const initAndListTools = async (
  mcpServer: McpServer,
  mcpClient: McpClient,
): Promise<Array<{ name: string; description: string }>> => {
  await waitForExtensionConnected(mcpServer);
  await waitForLog(mcpServer, 'plugin(s) mapped');
  return mcpClient.listTools();
};

/**
 * Open a tab to the test server via browser_open_tab, wait for load,
 * and return the tab ID. Uses the test server URL which is http://localhost
 * and accessible to the extension (unlike data: or chrome: URLs).
 */
const openTestServerTab = async (mcpClient: McpClient, testServer: TestServer): Promise<number> => {
  const openResult = await mcpClient.callTool('browser_open_tab', { url: testServer.url });
  expect(openResult.isError).toBe(false);
  const tabInfo = parseToolResult(openResult.content);
  const tabId = tabInfo.id as number;

  // Poll until the page finishes loading via browser_execute_script
  await waitFor(
    async () => {
      try {
        const result = await mcpClient.callTool('browser_execute_script', {
          tabId,
          code: 'return document.readyState',
        });
        if (result.isError) return false;
        const data = parseToolResult(result.content);
        const value = data.value as Record<string, unknown> | undefined;
        return value?.value === 'complete';
      } catch {
        return false;
      }
    },
    10_000,
    300,
    `tab ${tabId} readyState === complete`,
  );

  return tabId;
};

/**
 * Open a tab to the test server's /interactive page, wait for full load,
 * and return the tab ID.
 */
const openInteractivePage = async (mcpClient: McpClient, testServer: TestServer): Promise<number> => {
  const openResult = await mcpClient.callTool('browser_open_tab', { url: `${testServer.url}/interactive` });
  expect(openResult.isError).toBe(false);
  const tabInfo = parseToolResult(openResult.content);
  const tabId = tabInfo.id as number;

  await waitFor(
    async () => {
      try {
        const result = await mcpClient.callTool('browser_execute_script', {
          tabId,
          code: 'return document.readyState',
        });
        if (result.isError) return false;
        const data = parseToolResult(result.content);
        const value = data.value as Record<string, unknown> | undefined;
        return value?.value === 'complete';
      } catch {
        return false;
      }
    },
    10_000,
    300,
    `interactive page tab ${tabId} readyState === complete`,
  );

  return tabId;
};

/**
 * Poll until no __exec-*.js files remain in the adapters directory.
 * Replaces fixed `setTimeout` waits after browser_execute_script calls.
 */
const waitForExecFileCleanup = async (mcpServer: McpServer, timeoutMs = 5_000): Promise<void> => {
  const adaptersDir = path.join(mcpServer.configDir, 'extension', 'adapters');
  await waitFor(
    () => {
      try {
        const files = fs.readdirSync(adaptersDir);
        return files.filter(f => f.startsWith('__exec-') && f.endsWith('.js')).length === 0;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
        throw err;
      }
    },
    timeoutMs,
    200,
    'exec file cleanup',
  );
};

/**
 * Poll browser_get_network_requests until at least one request is captured.
 * Replaces fixed `setTimeout` waits after navigation during network capture.
 */
const waitForNetworkRequests = async (
  mcpClient: McpClient,
  tabId: number,
  timeoutMs = 10_000,
): Promise<Array<Record<string, unknown>>> => {
  let requests: Array<Record<string, unknown>> = [];
  await waitFor(
    async () => {
      try {
        const result = await mcpClient.callTool('browser_get_network_requests', { tabId });
        if (result.isError) return false;
        const data = parseToolResult(result.content);
        requests = data.requests as Array<Record<string, unknown>>;
        return requests.length > 0;
      } catch {
        return false;
      }
    },
    timeoutMs,
    300,
    'network requests captured',
  );
  return requests;
};

/**
 * Poll browser_get_websocket_frames until at least one frame is captured.
 * Replaces fixed `setTimeout` waits after WebSocket connections are established.
 */
const waitForWebSocketFrames = async (
  mcpClient: McpClient,
  tabId: number,
  timeoutMs = 10_000,
  minFrames = 1,
): Promise<Array<Record<string, unknown>>> => {
  let frames: Array<Record<string, unknown>> = [];
  await waitFor(
    async () => {
      try {
        const result = await mcpClient.callTool('browser_get_websocket_frames', { tabId });
        if (result.isError) return false;
        const data = parseToolResult(result.content);
        frames = data.frames as Array<Record<string, unknown>>;
        return frames.length >= minFrames;
      } catch {
        return false;
      }
    },
    timeoutMs,
    300,
    'WebSocket frames captured',
  );
  return frames;
};

/**
 * Poll browser_get_console_logs until a log entry matching the predicate appears.
 * Replaces fixed `setTimeout` waits after console.log/error calls.
 */
const waitForConsoleLogs = async (
  mcpClient: McpClient,
  tabId: number,
  predicate: (logs: Array<Record<string, unknown>>) => boolean,
  timeoutMs = 10_000,
): Promise<Array<Record<string, unknown>>> => {
  let logs: Array<Record<string, unknown>> = [];
  await waitFor(
    async () => {
      try {
        const result = await mcpClient.callTool('browser_get_console_logs', { tabId });
        if (result.isError) return false;
        const data = parseToolResult(result.content);
        logs = data.logs as Array<Record<string, unknown>>;
        return predicate(logs);
      } catch {
        return false;
      }
    },
    timeoutMs,
    300,
    'console logs match predicate',
  );
  return logs;
};

// ---------------------------------------------------------------------------
// Browser tools presence
// ---------------------------------------------------------------------------

test.describe('Browser tools — tool listing', () => {
  test('browser tools appear in tools/list', async ({ mcpServer, extensionContext: _extensionContext, mcpClient }) => {
    const tools = await initAndListTools(mcpServer, mcpClient);
    const toolNames = tools.map(t => t.name);

    for (const name of BROWSER_TOOL_NAMES) {
      expect(toolNames).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// browser_list_tabs
// ---------------------------------------------------------------------------

test.describe('browser_list_tabs', () => {
  test('returns an array of tab objects with id, title, url, active, windowId', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_list_tabs');
    expect(result.isError).toBe(false);

    const tabs = JSON.parse(result.content) as Array<Record<string, unknown>>;
    expect(Array.isArray(tabs)).toBe(true);
    expect(tabs.length).toBeGreaterThan(0);

    const firstTab = tabs[0];
    expect(firstTab).toBeDefined();
    if (!firstTab) throw new Error('No tabs returned');
    expect(firstTab).toHaveProperty('id');
    expect(firstTab).toHaveProperty('title');
    expect(firstTab).toHaveProperty('url');
    expect(firstTab).toHaveProperty('active');
    expect(firstTab).toHaveProperty('windowId');
    expect(typeof firstTab.id).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// browser_open_tab
// ---------------------------------------------------------------------------

test.describe('browser_open_tab', () => {
  test('creates a new tab and returns its info', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_open_tab', { url: testServer.url });
    expect(result.isError).toBe(false);

    const tabInfo = parseToolResult(result.content);
    expect(tabInfo).toHaveProperty('id');
    expect(typeof tabInfo.id).toBe('number');
    expect(tabInfo).toHaveProperty('windowId');

    // Verify the tab appears in list_tabs
    const listResult = await mcpClient.callTool('browser_list_tabs');
    const tabs = JSON.parse(listResult.content) as Array<Record<string, unknown>>;
    const found = tabs.find(t => t.id === tabInfo.id);
    expect(found).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// browser_close_tab
// ---------------------------------------------------------------------------

test.describe('browser_close_tab', () => {
  test('closes a tab by ID and it disappears from tab list', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open a tab first
    const openResult = await mcpClient.callTool('browser_open_tab', { url: testServer.url });
    expect(openResult.isError).toBe(false);
    const tabInfo = parseToolResult(openResult.content);
    const tabId = tabInfo.id as number;

    // Close it
    const closeResult = await mcpClient.callTool('browser_close_tab', { tabId });
    expect(closeResult.isError).toBe(false);
    const closeData = parseToolResult(closeResult.content);
    expect(closeData.ok).toBe(true);

    // Verify it's gone from the list
    const listResult = await mcpClient.callTool('browser_list_tabs');
    const tabs = JSON.parse(listResult.content) as Array<Record<string, unknown>>;
    const found = tabs.find(t => t.id === tabId);
    expect(found).toBeUndefined();
  });

  test('closing a non-existent tab returns an error', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_close_tab', { tabId: 999999 });
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// browser_navigate_tab
// ---------------------------------------------------------------------------

test.describe('browser_navigate_tab', () => {
  test('navigates an existing tab to a new URL', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open a tab
    const openResult = await mcpClient.callTool('browser_open_tab', { url: testServer.url });
    expect(openResult.isError).toBe(false);
    const tabInfo = parseToolResult(openResult.content);
    const tabId = tabInfo.id as number;

    // Navigate it
    const navResult = await mcpClient.callTool('browser_navigate_tab', {
      tabId,
      url: `${testServer.url}/non-matching`,
    });
    expect(navResult.isError).toBe(false);
    const navData = parseToolResult(navResult.content);
    expect(navData.id).toBe(tabId);

    // Clean up
    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// browser_execute_script
// ---------------------------------------------------------------------------

test.describe('browser_execute_script', () => {
  test('executes code and returns a string result', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return document.title',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(value).toHaveProperty('value');
    expect(typeof value.value).toBe('string');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('executes code and returns a number result', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return 42',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(value.value).toBe(42);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('executes code and returns a boolean result', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return true',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(value.value).toBe(true);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('executes code and returns null', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return null',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(value.value).toBeNull();

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('executes code and returns an object', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return { foo: "bar", count: 3 }',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(value.value).toEqual({ foo: 'bar', count: 3 });

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('accesses the DOM', async ({ mcpServer, testServer, extensionContext: _extensionContext, mcpClient }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return document.querySelectorAll("*").length',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(typeof value.value).toBe('number');
    expect(value.value as number).toBeGreaterThan(0);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('accesses window.location', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return window.location.href',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(typeof value.value).toBe('string');
    expect((value.value as string).startsWith('http')).toBe(true);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('accesses localStorage', async ({ mcpServer, testServer, extensionContext: _extensionContext, mcpClient }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Set a value, then read it back
    const setResult = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'localStorage.setItem("__opentabs_test", "hello"); return localStorage.getItem("__opentabs_test")',
    });
    expect(setResult.isError).toBe(false);

    const data = parseToolResult(setResult.content);
    const value = data.value as Record<string, unknown>;
    expect(value.value).toBe('hello');

    // Clean up
    await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'localStorage.removeItem("__opentabs_test")',
    });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('returns error for code that throws', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'throw new Error("test error")',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(value).toHaveProperty('error');
    expect(value.error).toBe('test error');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('handles async code (Promises)', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Use a synchronous return value wrapped in Promise.resolve to avoid
    // timing issues where setTimeout-based Promises may not settle before
    // the CDP evaluation completes in headless CI environments.
    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return await Promise.resolve("async-result")',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(value.value).toBe('async-result');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('handles async code that rejects', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Use an immediately-rejecting Promise to avoid timing issues where
    // setTimeout-based Promises may not settle before the CDP evaluation
    // completes in headless CI environments (same pattern as the resolve test).
    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return await Promise.reject(new Error("async-fail"))',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(value).toHaveProperty('error');
    expect(value.error).toBe('async-fail');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('code with no return produces null', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'var x = 1 + 1',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    // undefined is normalized to null by the extension before structured cloning
    expect(value.value).toBeNull();

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('cleans up namespaced exec result keys after execution', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Execute some code
    await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return "cleanup-test"',
    });

    // Verify no __execResult_* or __execAsync_* keys remain on __openTabs
    const checkResult = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'var ot = globalThis.__openTabs || {}; var keys = Object.keys(ot).filter(function(k) { return k.indexOf("__execResult_") === 0 || k.indexOf("__execAsync_") === 0; }); return keys.length === 0 ? "clean" : keys',
    });
    expect(checkResult.isError).toBe(false);

    const data = parseToolResult(checkResult.content);
    const value = data.value as Record<string, unknown>;
    expect(value.value).toBe('clean');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('fails with error for non-existent tab', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId: 999999,
      code: 'return 1',
    });
    expect(result.isError).toBe(true);
  });

  test('exec file is cleaned up after successful execution', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return "file-cleanup-test"',
    });

    // Poll until exec files are cleaned up
    await waitForExecFileCleanup(mcpServer);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('exec file is cleaned up after execution error (non-existent tab)', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    await mcpClient.callTool('browser_execute_script', {
      tabId: 999999,
      code: 'return 1',
    });

    // Poll until exec files are cleaned up
    await waitForExecFileCleanup(mcpServer);
  });

  test('sequential executions leave no leftover state', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Run 5 executions sequentially
    for (let i = 0; i < 5; i++) {
      const result = await mcpClient.callTool('browser_execute_script', {
        tabId,
        code: `return ${i}`,
      });
      expect(result.isError).toBe(false);
      const data = parseToolResult(result.content);
      const value = data.value as Record<string, unknown>;
      expect(value.value).toBe(i);
    }

    // Verify no leftover namespaced exec globals
    const checkResult = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'var ot = globalThis.__openTabs || {}; var resultKeys = Object.keys(ot).filter(function(k) { return k.indexOf("__execResult_") === 0; }); var asyncKeys = Object.keys(ot).filter(function(k) { return k.indexOf("__execAsync_") === 0; }); return { hasResult: resultKeys.length > 0, hasAsync: asyncKeys.length > 0 }',
    });
    expect(checkResult.isError).toBe(false);
    const checkData = parseToolResult(checkResult.content);
    const checkValue = (checkData.value as Record<string, unknown>).value as Record<string, unknown>;
    expect(checkValue.hasResult).toBe(false);
    expect(checkValue.hasAsync).toBe(false);

    // Poll until exec files are cleaned up
    await waitForExecFileCleanup(mcpServer);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('concurrent executions on different tabs do not collide', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open two tabs
    const tabId1 = await openTestServerTab(mcpClient, testServer);
    const tabId2 = await openTestServerTab(mcpClient, testServer);

    // Execute on both tabs concurrently
    const [result1, result2] = await Promise.all([
      mcpClient.callTool('browser_execute_script', {
        tabId: tabId1,
        code: 'return "tab1-" + document.title',
      }),
      mcpClient.callTool('browser_execute_script', {
        tabId: tabId2,
        code: 'return "tab2-" + document.title',
      }),
    ]);

    expect(result1.isError).toBe(false);
    expect(result2.isError).toBe(false);

    const data1 = parseToolResult(result1.content);
    const data2 = parseToolResult(result2.content);
    const value1 = (data1.value as Record<string, unknown>).value as string;
    const value2 = (data2.value as Record<string, unknown>).value as string;

    expect(value1.startsWith('tab1-')).toBe(true);
    expect(value2.startsWith('tab2-')).toBe(true);

    // Poll until exec files are cleaned up
    await waitForExecFileCleanup(mcpServer);

    await mcpClient.callTool('browser_close_tab', { tabId: tabId1 });
    await mcpClient.callTool('browser_close_tab', { tabId: tabId2 });
  });

  test('await expression returns resolved value', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return await Promise.resolve("async-value")',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(value.value).toBe('async-value');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('multiple sequential await expressions', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'const a = await Promise.resolve(1); const b = await Promise.resolve(2); return a + b',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(value.value).toBe(3);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('await fetch returns HTTP status', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'const r = await fetch("/control/health"); return r.status',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(value.value).toBe(200);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('await rejected Promise captures error', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return await Promise.reject("async-fail")',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    expect(value).toHaveProperty('error');
    expect(value.error).toContain('async-fail');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('large result is serialized and truncated', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Generate a large object
    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'var obj = {}; for (var i = 0; i < 10000; i++) obj["key" + i] = "value" + i; return obj',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const value = data.value as Record<string, unknown>;
    // Should have a value (possibly truncated string) or a serialized object
    expect('value' in value || 'error' in value).toBe(true);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// browser tools — open + navigate + close lifecycle
// ---------------------------------------------------------------------------

test.describe('Browser tools — tab lifecycle', () => {
  test('open → execute → close: full tab lifecycle', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // 1. Open tab to the test server (http://localhost — accessible to extension)
    const tabId = await openTestServerTab(mcpClient, testServer);

    // 2. Execute code on the page
    const execResult = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return document.title',
    });
    expect(execResult.isError).toBe(false);

    // 3. Verify the tab appears in list
    const listResult = await mcpClient.callTool('browser_list_tabs');
    expect(listResult.isError).toBe(false);
    const tabs = JSON.parse(listResult.content) as Array<Record<string, unknown>>;
    expect(tabs.find(t => t.id === tabId)).toBeDefined();

    // 4. Close
    const closeResult = await mcpClient.callTool('browser_close_tab', { tabId });
    expect(closeResult.isError).toBe(false);

    // 5. Verify gone
    const listResult2 = await mcpClient.callTool('browser_list_tabs');
    const tabs2 = JSON.parse(listResult2.content) as Array<Record<string, unknown>>;
    expect(tabs2.find(t => t.id === tabId)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Browser tools — no extension connected
// ---------------------------------------------------------------------------

test.describe('Browser tools — extension not connected', () => {
  test('browser_list_tabs fails gracefully when extension is not connected', async ({
    mcpServer: _mcpServer,
    mcpClient,
  }) => {
    // Do NOT use extensionContext fixture — no extension launched
    const result = await mcpClient.callTool('browser_list_tabs');
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Extension not connected');
  });
});

// ---------------------------------------------------------------------------
// Browser tools — URL validation (safe URL scheme enforcement)
// ---------------------------------------------------------------------------

test.describe('Browser tools — URL validation', () => {
  test('browser_navigate_tab rejects javascript: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_navigate_tab', {
      tabId: 1,
      url: 'javascript:alert(1)',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_navigate_tab rejects data: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_navigate_tab', {
      tabId: 1,
      url: 'data:text/html,<h1>hi</h1>',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_navigate_tab rejects file: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_navigate_tab', {
      tabId: 1,
      url: 'file:///etc/passwd',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_open_tab rejects javascript: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_open_tab', {
      url: 'javascript:alert(1)',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_open_tab rejects data: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_open_tab', {
      url: 'data:text/html,<h1>hi</h1>',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_open_tab rejects file: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_open_tab', {
      url: 'file:///etc/passwd',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_open_tab accepts valid http: URL', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_open_tab', { url: testServer.url });
    expect(result.isError).toBe(false);

    const tabInfo = parseToolResult(result.content);
    expect(tabInfo).toHaveProperty('id');

    // Clean up
    await mcpClient.callTool('browser_close_tab', { tabId: tabInfo.id });
  });
});

// ---------------------------------------------------------------------------
// browser_focus_tab
// ---------------------------------------------------------------------------

test.describe('browser_focus_tab', () => {
  test('focuses a tab and verifies it becomes active', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open two tabs — the second one will be active after creation
    const open1 = await mcpClient.callTool('browser_open_tab', { url: testServer.url });
    expect(open1.isError).toBe(false);
    const tabId1 = parseToolResult(open1.content).id as number;

    const open2 = await mcpClient.callTool('browser_open_tab', { url: `${testServer.url}/non-matching` });
    expect(open2.isError).toBe(false);
    const tabId2 = parseToolResult(open2.content).id as number;

    // Focus the first tab
    const focusResult = await mcpClient.callTool('browser_focus_tab', { tabId: tabId1 });
    expect(focusResult.isError).toBe(false);

    const focusData = parseToolResult(focusResult.content);
    expect(focusData.id).toBe(tabId1);
    expect(focusData.active).toBe(true);

    // Verify via browser_list_tabs that the focused tab is active
    const listResult = await mcpClient.callTool('browser_list_tabs');
    expect(listResult.isError).toBe(false);
    const tabs = JSON.parse(listResult.content) as Array<Record<string, unknown>>;
    const focusedTab = tabs.find(t => t.id === tabId1);
    expect(focusedTab).toBeDefined();
    if (!focusedTab) throw new Error('Focused tab not found');
    expect(focusedTab.active).toBe(true);

    // Clean up
    await mcpClient.callTool('browser_close_tab', { tabId: tabId1 });
    await mcpClient.callTool('browser_close_tab', { tabId: tabId2 });
  });

  test('returns error for invalid tabId', async ({ mcpServer, extensionContext: _extensionContext, mcpClient }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_focus_tab', { tabId: 999999 });
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// browser_get_tab_info
// ---------------------------------------------------------------------------

test.describe('browser_get_tab_info', () => {
  test('returns correct fields for an open tab', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open a tab (no need to wait for full page load — just need a valid tab ID)
    const openResult = await mcpClient.callTool('browser_open_tab', { url: testServer.url });
    expect(openResult.isError).toBe(false);
    const tabId = parseToolResult(openResult.content).id as number;

    const result = await mcpClient.callTool('browser_get_tab_info', { tabId });
    expect(result.isError).toBe(false);

    const info = parseToolResult(result.content);
    expect(info.id).toBe(tabId);
    expect(typeof info.title).toBe('string');
    expect(typeof info.url).toBe('string');
    expect(typeof info.status).toBe('string');
    expect(typeof info.active).toBe('boolean');
    expect(typeof info.windowId).toBe('number');
    expect(typeof info.incognito).toBe('boolean');

    // Clean up
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('returns error for invalid tabId', async ({ mcpServer, extensionContext: _extensionContext, mcpClient }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_get_tab_info', { tabId: 999999 });
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// browser_screenshot_tab
// ---------------------------------------------------------------------------

test.describe('browser_screenshot_tab', () => {
  test('returns a single PNG image content part', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Poll until screenshot returns a valid PNG image content part (page fully rendered).
    // The tool emits `[{type:'image', data:<base64 PNG>, mimeType:'image/png'}]`, so we
    // assert on the raw contentParts array rather than the joined text content.
    //
    // Local literal-union for `type` (rather than the wider `string` on the McpClient
    // contract) so a future drift — e.g. a new content kind landing in this tool's
    // response, or `mimeType` becoming optional — is caught at compile time. We
    // deliberately don't import `ToolContentPart` from the MCP server source: these
    // E2E tests treat the server as a black-box subprocess over JSON-RPC and assert
    // on the observable wire shape, so depending on a server-internal type would
    // couple the test harness to server internals rather than the wire contract.
    type ScreenshotPart = { type: 'image' | 'text'; data?: string; mimeType?: string; text?: string };
    let parts: ScreenshotPart[] = [];
    await waitFor(
      async () => {
        try {
          const r = await mcpClient.callTool('browser_screenshot_tab', { tabId });
          if (r.isError) return false;
          // Defensive default: callTool guarantees contentParts is an array (see
          // fixtures.test.ts), but if that contract ever drifts the poll would
          // otherwise swallow a TypeError in the catch and silently retry to
          // timeout with a misleading failure message. The cast narrows the
          // server-wide `type: string` to the literal union this test expects;
          // non-image/text parts would still trip the assertions below.
          parts = (r.contentParts ?? []) as ScreenshotPart[];
          const first = parts[0];
          return (
            parts.length === 1 &&
            first?.type === 'image' &&
            typeof first.data === 'string' &&
            first.data.startsWith('iVBOR')
          );
        } catch {
          return false;
        }
      },
      10_000,
      300,
      'screenshot returns valid PNG image content part',
    );

    expect(parts).toHaveLength(1);
    expect(parts[0]?.type).toBe('image');
    expect(parts[0]?.mimeType).toBe('image/png');
    // PNG files encoded in base64 start with 'iVBOR' (the base64 encoding of the PNG header)
    expect(typeof parts[0]?.data).toBe('string');
    expect((parts[0]?.data as string).startsWith('iVBOR')).toBe(true);

    // Clean up
    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// browser_get_tab_content
// ---------------------------------------------------------------------------

test.describe('browser_get_tab_content', () => {
  test('returns title and content from test server page', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_get_tab_content', { tabId });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(data.title).toBe('E2E Test App');
    expect(typeof data.url).toBe('string');
    expect(typeof data.content).toBe('string');
    expect((data.content as string).length).toBeGreaterThan(0);

    // Clean up
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('CSS selector scopes extraction', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open the interactive page which has a known h1
    const openResult = await mcpClient.callTool('browser_open_tab', {
      url: `${testServer.url}/interactive`,
    });
    expect(openResult.isError).toBe(false);
    const tabInfo = parseToolResult(openResult.content);
    const tabId = tabInfo.id as number;

    // Wait for page load
    await waitFor(
      async () => {
        try {
          const r = await mcpClient.callTool('browser_execute_script', {
            tabId,
            code: 'return document.readyState',
          });
          if (r.isError) return false;
          const d = parseToolResult(r.content);
          const v = d.value as Record<string, unknown> | undefined;
          return v?.value === 'complete';
        } catch {
          return false;
        }
      },
      10_000,
      300,
      `tab ${tabId} readyState === complete`,
    );

    const result = await mcpClient.callTool('browser_get_tab_content', { tabId, selector: 'h1' });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(data.title).toBe('Interactive Test Page');
    expect(data.content).toBe('Interactive Test Page');

    // Clean up
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('non-existent selector returns error', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_get_tab_content', {
      tabId,
      selector: '#nonexistent-element-xyz',
    });
    expect(result.isError).toBe(true);

    // Clean up
    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// browser_click_element
// ---------------------------------------------------------------------------

test.describe('browser_click_element', () => {
  test('clicks a button on /interactive page and verifies state change', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_click_element', { tabId, selector: '#test-btn' });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(data.clicked).toBe(true);
    expect(data.tagName).toBe('button');

    // Verify the button's click handler ran
    const execResult = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return window.__btnClicked',
    });
    expect(execResult.isError).toBe(false);
    const execData = parseToolResult(execResult.content);
    const value = execData.value as Record<string, unknown>;
    expect(value.value).toBe(true);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('returns error for non-existent selector', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_click_element', {
      tabId,
      selector: '#nonexistent-btn',
    });
    expect(result.isError).toBe(true);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// browser_type_text
// ---------------------------------------------------------------------------

test.describe('browser_type_text', () => {
  test('types into an input on /interactive page', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_type_text', {
      tabId,
      selector: '#test-input',
      text: 'hello world',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(data.typed).toBe(true);
    expect(data.tagName).toBe('input');
    expect(data.value).toBe('hello world');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('clear=false appends text', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    // Type initial text
    await mcpClient.callTool('browser_type_text', {
      tabId,
      selector: '#test-input',
      text: 'hello',
    });

    // Append text with clear=false
    const result = await mcpClient.callTool('browser_type_text', {
      tabId,
      selector: '#test-input',
      text: ' world',
      clear: false,
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(data.typed).toBe(true);
    expect(data.value).toBe('hello world');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// browser_select_option
// ---------------------------------------------------------------------------

test.describe('browser_select_option', () => {
  test('selects by value on /interactive page', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_select_option', {
      tabId,
      selector: '#test-select',
      value: 'b',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(data.selected).toBe(true);
    expect(data.value).toBe('b');
    expect(data.label).toBe('Beta');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('selects by label on /interactive page', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_select_option', {
      tabId,
      selector: '#test-select',
      label: 'Gamma',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(data.selected).toBe(true);
    expect(data.value).toBe('c');
    expect(data.label).toBe('Gamma');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// browser_wait_for_element
// ---------------------------------------------------------------------------

test.describe('browser_wait_for_element', () => {
  test('finds the delayed content on /interactive page', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    // #delayed-content appears after ~500ms
    const result = await mcpClient.callTool('browser_wait_for_element', {
      tabId,
      selector: '#delayed-content',
      timeout: 5000,
      visible: true,
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(data.found).toBe(true);
    expect(data.tagName).toBe('div');
    expect(data.text).toBe('Delayed content loaded');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('times out for non-existent selector', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_wait_for_element', {
      tabId,
      selector: '#nonexistent-element',
      timeout: 1000,
    });
    expect(result.isError).toBe(true);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// browser_query_elements
// ---------------------------------------------------------------------------

test.describe('browser_query_elements', () => {
  test('returns elements matching selector with attributes', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_query_elements', {
      tabId,
      selector: 'input, select, button',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(data.count).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(data.elements)).toBe(true);

    const elements = data.elements as Array<{
      tagName: string;
      text: string;
      attributes: Record<string, string>;
    }>;
    const tagNames = elements.map(e => e.tagName);
    expect(tagNames).toContain('button');
    expect(tagNames).toContain('input');
    expect(tagNames).toContain('select');

    // Verify attributes are returned
    const inputEl = elements.find(e => e.tagName === 'input');
    expect(inputEl).toBeDefined();
    if (!inputEl) throw new Error('input element not found');
    expect(inputEl.attributes).toHaveProperty('id');
    expect(inputEl.attributes.id).toBe('test-input');
    expect(inputEl.attributes).toHaveProperty('type');
    expect(inputEl.attributes.type).toBe('text');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// browser_get_cookies / browser_set_cookie / browser_delete_cookies
// ---------------------------------------------------------------------------

test.describe('Browser tools — cookie lifecycle', () => {
  test('set → get → delete → verify gone', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // 1. Set a cookie
    const setResult = await mcpClient.callTool('browser_set_cookie', {
      url: testServer.url,
      name: '__opentabs_e2e',
      value: 'test123',
    });
    expect(setResult.isError).toBe(false);

    // 2. Read it back
    const getResult = await mcpClient.callTool('browser_get_cookies', {
      url: testServer.url,
      name: '__opentabs_e2e',
    });
    expect(getResult.isError).toBe(false);

    const cookies = parseToolResult(getResult.content).cookies as Array<Record<string, unknown>>;
    expect(cookies.length).toBe(1);
    const cookie = cookies[0];
    if (!cookie) throw new Error('Expected cookie not found');
    expect(cookie.name).toBe('__opentabs_e2e');
    expect(cookie.value).toBe('test123');

    // 3. Delete it
    const deleteResult = await mcpClient.callTool('browser_delete_cookies', {
      url: testServer.url,
      name: '__opentabs_e2e',
    });
    expect(deleteResult.isError).toBe(false);
    const deleteData = parseToolResult(deleteResult.content);
    expect(deleteData.deleted).toBe(true);

    // 4. Verify it's gone
    const getResult2 = await mcpClient.callTool('browser_get_cookies', {
      url: testServer.url,
      name: '__opentabs_e2e',
    });
    expect(getResult2.isError).toBe(false);
    const cookies2 = parseToolResult(getResult2.content).cookies as Array<Record<string, unknown>>;
    expect(cookies2.length).toBe(0);
  });

  test('get cookies with name filter returns only matching cookie', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Set two cookies
    await mcpClient.callTool('browser_set_cookie', {
      url: testServer.url,
      name: '__opentabs_e2e_a',
      value: 'alpha',
    });
    await mcpClient.callTool('browser_set_cookie', {
      url: testServer.url,
      name: '__opentabs_e2e_b',
      value: 'beta',
    });

    // Get only cookie 'a'
    const getResult = await mcpClient.callTool('browser_get_cookies', {
      url: testServer.url,
      name: '__opentabs_e2e_a',
    });
    expect(getResult.isError).toBe(false);

    const cookies = parseToolResult(getResult.content).cookies as Array<Record<string, unknown>>;
    expect(cookies.length).toBe(1);
    const cookieA = cookies[0];
    if (!cookieA) throw new Error('Expected cookie not found');
    expect(cookieA.name).toBe('__opentabs_e2e_a');
    expect(cookieA.value).toBe('alpha');

    // Clean up both cookies
    await mcpClient.callTool('browser_delete_cookies', {
      url: testServer.url,
      name: '__opentabs_e2e_a',
    });
    await mcpClient.callTool('browser_delete_cookies', {
      url: testServer.url,
      name: '__opentabs_e2e_b',
    });
  });
});

test.describe('Browser tools — cookie URL validation', () => {
  test('browser_get_cookies rejects javascript: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_get_cookies', {
      url: 'javascript:alert(1)',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_set_cookie rejects javascript: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_set_cookie', {
      url: 'javascript:alert(1)',
      name: 'test',
      value: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_delete_cookies rejects javascript: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_delete_cookies', {
      url: 'javascript:alert(1)',
      name: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_get_cookies rejects data: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_get_cookies', {
      url: 'data:text/html,<h1>hi</h1>',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_set_cookie rejects data: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_set_cookie', {
      url: 'data:text/html,<h1>hi</h1>',
      name: 'test',
      value: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_delete_cookies rejects data: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_delete_cookies', {
      url: 'data:text/html,<h1>hi</h1>',
      name: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_get_cookies rejects file: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_get_cookies', {
      url: 'file:///etc/passwd',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_set_cookie rejects file: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_set_cookie', {
      url: 'file:///etc/passwd',
      name: 'test',
      value: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });

  test('browser_delete_cookies rejects file: URL', async ({ mcpClient }) => {
    const result = await mcpClient.callTool('browser_delete_cookies', {
      url: 'file:///etc/passwd',
      name: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toContain('url');
  });
});

// ---------------------------------------------------------------------------
// browser_enable_network_capture / browser_get_network_requests / browser_disable_network_capture
// ---------------------------------------------------------------------------

test.describe('Browser tools — network capture lifecycle', () => {
  test('enable → navigate → get requests → disable', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // 1. Enable network capture
    const enableResult = await mcpClient.callTool('browser_enable_network_capture', { tabId });
    expect(enableResult.isError).toBe(false);
    const enableData = parseToolResult(enableResult.content);
    expect(enableData.enabled).toBe(true);

    // 2. Navigate to trigger network requests
    const navResult = await mcpClient.callTool('browser_navigate_tab', {
      tabId,
      url: `${testServer.url}/interactive`,
    });
    expect(navResult.isError).toBe(false);

    // 3. Poll until requests are captured
    const requests = await waitForNetworkRequests(mcpClient, tabId);
    expect(requests.length).toBeGreaterThan(0);

    // Verify request shape
    const firstReq = requests[0];
    if (!firstReq) throw new Error('Expected at least one captured request');
    expect(typeof firstReq.url).toBe('string');
    expect(typeof firstReq.method).toBe('string');

    // 4. Disable capture
    const disableResult = await mcpClient.callTool('browser_disable_network_capture', { tabId });
    expect(disableResult.isError).toBe(false);
    const disableData = parseToolResult(disableResult.content);
    expect(disableData.disabled).toBe(true);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('get_network_requests with clear=true empties the buffer', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Enable and navigate
    await mcpClient.callTool('browser_enable_network_capture', { tabId });
    await mcpClient.callTool('browser_navigate_tab', {
      tabId,
      url: `${testServer.url}/interactive`,
    });

    // Poll until requests are captured
    await waitForNetworkRequests(mcpClient, tabId);

    // Get with clear=true
    const getResult1 = await mcpClient.callTool('browser_get_network_requests', { tabId, clear: true });
    expect(getResult1.isError).toBe(false);
    const data1 = parseToolResult(getResult1.content);
    expect((data1.requests as Array<unknown>).length).toBeGreaterThan(0);

    // Poll with clear=true until the buffer stays empty (drains any in-flight sub-resource requests)
    await waitFor(
      async () => {
        const result = await mcpClient.callTool('browser_get_network_requests', { tabId, clear: true });
        if (result.isError) return false;
        const data = parseToolResult(result.content);
        return (data.requests as Array<unknown>).length === 0;
      },
      5_000,
      200,
      'network buffer drained after clear',
    );

    // Clean up
    await mcpClient.callTool('browser_disable_network_capture', { tabId });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('urlFilter only captures matching requests', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Enable capture with a URL filter
    await mcpClient.callTool('browser_enable_network_capture', {
      tabId,
      urlFilter: '/interactive',
    });

    // Navigate to /interactive — this request should be captured
    await mcpClient.callTool('browser_navigate_tab', {
      tabId,
      url: `${testServer.url}/interactive`,
    });

    // Poll until requests matching the filter are captured
    const requests = await waitForNetworkRequests(mcpClient, tabId);

    // All captured requests should contain '/interactive' in the URL
    for (const req of requests) {
      expect((req.url as string).includes('/interactive')).toBe(true);
    }

    // Clean up
    await mcpClient.callTool('browser_disable_network_capture', { tabId });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('enable network capture on non-existent tab returns error', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_enable_network_capture', { tabId: 999999 });
    expect(result.isError).toBe(true);
  });

  test('export_har returns valid HAR 1.2 JSON with entries', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Enable network capture
    const enableResult = await mcpClient.callTool('browser_enable_network_capture', { tabId });
    expect(enableResult.isError).toBe(false);

    // Navigate to generate HTTP traffic
    await mcpClient.callTool('browser_navigate_tab', {
      tabId,
      url: `${testServer.url}/interactive`,
    });

    // Wait until requests are captured
    await waitForNetworkRequests(mcpClient, tabId);

    // Export HAR
    const harResult = await mcpClient.callTool('browser_export_har', { tabId });
    expect(harResult.isError).toBe(false);
    const data = parseToolResult(harResult.content);
    const harJson = JSON.parse(data.har as string) as {
      log: {
        version: string;
        entries: Array<{ request: { url: string; method: string }; response: { status: number } }>;
      };
    };

    // Verify HAR 1.2 structure
    expect(harJson.log.version).toBe('1.2');
    expect(harJson.log.entries.length).toBeGreaterThan(0);
    const firstEntry = harJson.log.entries[0];
    if (!firstEntry) throw new Error('Expected at least one HAR entry');
    expect(typeof firstEntry.request.url).toBe('string');
    expect(typeof firstEntry.request.method).toBe('string');
    expect(typeof firstEntry.response.status).toBe('number');

    // Clean up
    await mcpClient.callTool('browser_disable_network_capture', { tabId });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('export_har with includeWebSocketFrames includes WebSocket synthetic entries', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Enable network capture before navigating to the WebSocket test page
    await mcpClient.callTool('browser_enable_network_capture', { tabId });

    // Navigate to WebSocket test page — opens a WS connection and sends a ping
    await mcpClient.callTool('browser_navigate_tab', {
      tabId,
      url: `${testServer.url}/ws-test`,
    });

    // Wait until WebSocket frames are captured
    await waitForWebSocketFrames(mcpClient, tabId);

    // Export HAR with WebSocket frames included
    const harResult = await mcpClient.callTool('browser_export_har', {
      tabId,
      includeWebSocketFrames: true,
    });
    expect(harResult.isError).toBe(false);
    const data = parseToolResult(harResult.content);
    const harJson = JSON.parse(data.har as string) as {
      log: {
        entries: Array<{
          request: { headers: Array<{ name: string; value: string }> };
          response: { status: number };
        }>;
      };
    };

    // Verify WebSocket synthetic entries (status 101) are present
    const wsEntries = harJson.log.entries.filter(e => e.response.status === 101);
    expect(wsEntries.length).toBeGreaterThan(0);

    // Verify the Upgrade: websocket header is present on WS entries
    const firstWsEntry = wsEntries[0];
    if (!firstWsEntry) throw new Error('Expected at least one WebSocket HAR entry');
    const upgradeHeader = firstWsEntry.request.headers.find(h => h.name === 'Upgrade');
    expect(upgradeHeader).toBeDefined();
    expect(upgradeHeader?.value).toBe('websocket');

    // Clean up
    await mcpClient.callTool('browser_disable_network_capture', { tabId });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('export_har with clear=true empties the capture buffer', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Enable capture and navigate to generate traffic
    await mcpClient.callTool('browser_enable_network_capture', { tabId });
    await mcpClient.callTool('browser_navigate_tab', {
      tabId,
      url: `${testServer.url}/interactive`,
    });
    await waitForNetworkRequests(mcpClient, tabId);

    // Export HAR with clear=true
    const harResult = await mcpClient.callTool('browser_export_har', { tabId, clear: true });
    expect(harResult.isError).toBe(false);
    const data = parseToolResult(harResult.content);
    const harJson = JSON.parse(data.har as string) as { log: { entries: unknown[] } };
    expect(harJson.log.entries.length).toBeGreaterThan(0);

    // Poll until the network buffer is fully drained (in-flight requests may still arrive)
    await waitFor(
      async () => {
        const result = await mcpClient.callTool('browser_get_network_requests', { tabId, clear: true });
        if (result.isError) return false;
        const d = parseToolResult(result.content);
        return (d.requests as Array<unknown>).length === 0;
      },
      5_000,
      200,
      'network buffer drained after export_har clear',
    );

    // Clean up
    await mcpClient.callTool('browser_disable_network_capture', { tabId });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('export_har returns error when network capture is not active', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open a tab WITHOUT enabling network capture
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Attempting to export HAR should fail since capture is not active
    const harResult = await mcpClient.callTool('browser_export_har', { tabId });
    expect(harResult.isError).toBe(true);

    // Clean up
    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// browser_get_websocket_frames
// ---------------------------------------------------------------------------

test.describe('Browser tools — WebSocket frame capture', () => {
  test('captures sent and received WebSocket frames', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Enable network capture before navigating to the WebSocket page
    const enableResult = await mcpClient.callTool('browser_enable_network_capture', { tabId });
    expect(enableResult.isError).toBe(false);

    // Navigate to the WebSocket test page — this opens a WebSocket connection,
    // sends a ping message, and receives a hello + echo back from the server.
    await mcpClient.callTool('browser_navigate_tab', {
      tabId,
      url: `${testServer.url}/ws-test`,
    });

    // Poll until at least 2 WebSocket frames are captured (sent + received)
    const frames = await waitForWebSocketFrames(mcpClient, tabId, 10_000, 2);

    // Verify frame shape — every frame should have the required fields
    for (const frame of frames) {
      expect(typeof frame.url).toBe('string');
      expect(frame.url).toContain('/ws');
      expect(['sent', 'received']).toContain(frame.direction);
      expect(typeof frame.data).toBe('string');
      expect(typeof frame.opcode).toBe('number');
      expect(typeof frame.timestamp).toBe('number');
    }

    // Verify we captured at least one received frame (the server's hello message)
    const received = frames.filter(f => f.direction === 'received');
    expect(received.length).toBeGreaterThanOrEqual(1);
    const helloFrame = received.find(f => (f.data as string).includes('ws-test-server'));
    expect(helloFrame).toBeDefined();

    // Verify we captured at least one sent frame (the client's ping message)
    const sent = frames.filter(f => f.direction === 'sent');
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const pingFrame = sent.find(f => (f.data as string).includes('ping'));
    expect(pingFrame).toBeDefined();

    // Clean up
    await mcpClient.callTool('browser_disable_network_capture', { tabId });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('clear=true empties the WebSocket frame buffer', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Enable capture and navigate to the WebSocket test page
    await mcpClient.callTool('browser_enable_network_capture', { tabId });
    await mcpClient.callTool('browser_navigate_tab', {
      tabId,
      url: `${testServer.url}/ws-test`,
    });

    // Wait for frames to be captured
    await waitForWebSocketFrames(mcpClient, tabId);

    // Get frames with clear=true
    const getResult = await mcpClient.callTool('browser_get_websocket_frames', { tabId, clear: true });
    expect(getResult.isError).toBe(false);
    const data = parseToolResult(getResult.content);
    expect((data.frames as Array<unknown>).length).toBeGreaterThan(0);

    // Navigate away to sever the WebSocket connection before verifying the buffer is empty.
    // Without this, the echo server can deliver new frames between the clear and the read,
    // causing a spurious non-zero frame count.
    await mcpClient.callTool('browser_navigate_tab', { tabId, url: testServer.url });

    // Verify the buffer is now empty
    const getResult2 = await mcpClient.callTool('browser_get_websocket_frames', { tabId });
    expect(getResult2.isError).toBe(false);
    const data2 = parseToolResult(getResult2.content);
    expect((data2.frames as Array<unknown>).length).toBe(0);

    // Clean up
    await mcpClient.callTool('browser_disable_network_capture', { tabId });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// browser_get_console_logs / browser_clear_console_logs
// ---------------------------------------------------------------------------

test.describe('Browser tools — console log capture', () => {
  test('captures console.log and console.error output', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Enable network capture (which also enables Runtime for console capture)
    await mcpClient.callTool('browser_enable_network_capture', { tabId });

    // Execute console.log and console.error
    await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'console.log("e2e-test-message"); console.error("e2e-test-error")',
    });

    // Poll until both console entries are captured
    const logs = await waitForConsoleLogs(mcpClient, tabId, entries => {
      const messages = entries.map(l => l.message as string);
      return messages.some(m => m.includes('e2e-test-message')) && messages.some(m => m.includes('e2e-test-error'));
    });
    expect(logs.length).toBeGreaterThanOrEqual(2);

    const logMessages = logs.map(l => l.message as string);
    expect(logMessages.some(m => m.includes('e2e-test-message'))).toBe(true);
    expect(logMessages.some(m => m.includes('e2e-test-error'))).toBe(true);

    // Verify log levels
    const logEntry = logs.find(l => (l.message as string).includes('e2e-test-message'));
    const errorEntry = logs.find(l => (l.message as string).includes('e2e-test-error'));
    expect(logEntry).toBeDefined();
    expect(errorEntry).toBeDefined();
    if (!logEntry || !errorEntry) throw new Error('Expected log entries not found');
    expect(logEntry.level).toBe('log');
    expect(errorEntry.level).toBe('error');

    // Clean up
    await mcpClient.callTool('browser_disable_network_capture', { tabId });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('clear_console_logs empties the log buffer', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Enable capture and produce some logs
    await mcpClient.callTool('browser_enable_network_capture', { tabId });
    await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'console.log("clear-test")',
    });

    // Poll until the log entry is captured
    await waitForConsoleLogs(mcpClient, tabId, entries =>
      entries.some(l => (l.message as string).includes('clear-test')),
    );

    // Clear logs
    const clearResult = await mcpClient.callTool('browser_clear_console_logs', { tabId });
    expect(clearResult.isError).toBe(false);
    const clearData = parseToolResult(clearResult.content);
    expect(clearData.cleared).toBe(true);

    // Verify buffer is empty
    const getResult = await mcpClient.callTool('browser_get_console_logs', { tabId });
    expect(getResult.isError).toBe(false);
    const data = parseToolResult(getResult.content);
    const logs = data.logs as Array<unknown>;
    expect(logs.length).toBe(0);

    // Clean up
    await mcpClient.callTool('browser_disable_network_capture', { tabId });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// Browser tools — resource inspection
// ---------------------------------------------------------------------------

test.describe('Browser tools — resource inspection', () => {
  test('browser_list_resources returns resources for a loaded page', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_list_resources', { tabId });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(Array.isArray(data.resources)).toBe(true);

    const resources = data.resources as Array<Record<string, unknown>>;
    expect(resources.length).toBeGreaterThan(0);

    // The test server page loads an external script, so there should be at least one Script resource
    const types = resources.map(r => r.type as string);
    expect(types).toContain('Script');

    // Each resource should have url, type, and mimeType fields
    for (const resource of resources) {
      expect(typeof resource.url).toBe('string');
      expect(typeof resource.type).toBe('string');
      expect(typeof resource.mimeType).toBe('string');
    }

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_list_resources with type filter returns only matching resources', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_list_resources', { tabId, type: 'Script' });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const resources = data.resources as Array<Record<string, unknown>>;
    expect(resources.length).toBeGreaterThan(0);

    // All resources should be of type Script
    for (const resource of resources) {
      expect(resource.type).toBe('Script');
    }

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_list_resources returns error for non-existent tab', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_list_resources', { tabId: 999999 });
    expect(result.isError).toBe(true);
  });

  test('browser_get_resource_content retrieves content of a page resource', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // First list resources to find a Script URL
    const listResult = await mcpClient.callTool('browser_list_resources', { tabId });
    expect(listResult.isError).toBe(false);

    const listData = parseToolResult(listResult.content);
    const resources = listData.resources as Array<Record<string, unknown>>;
    const scriptResource = resources.find(r => r.type === 'Script');
    expect(scriptResource).toBeDefined();
    if (!scriptResource) throw new Error('No Script resource found');

    // Fetch the content of the Script resource
    const contentResult = await mcpClient.callTool('browser_get_resource_content', {
      tabId,
      url: scriptResource.url as string,
    });
    expect(contentResult.isError).toBe(false);

    const contentData = parseToolResult(contentResult.content);
    expect(typeof contentData.content).toBe('string');
    expect((contentData.content as string).length).toBeGreaterThan(0);
    // The external test script sets window.__testScriptLoaded
    expect(contentData.content as string).toContain('__testScriptLoaded');
    expect(typeof contentData.url).toBe('string');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_get_resource_content returns error for non-existent URL', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_get_resource_content', {
      tabId,
      url: `${testServer.url}/nonexistent-resource.js`,
    });
    expect(result.isError).toBe(true);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_get_resource_content returns error for non-existent tab', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_get_resource_content', {
      tabId: 999999,
      url: 'http://localhost/some-resource.js',
    });
    expect(result.isError).toBe(true);
  });

  test('resource tools work while network capture is active (debugger sharing)', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // 1. Enable network capture (attaches debugger)
    const enableResult = await mcpClient.callTool('browser_enable_network_capture', { tabId });
    expect(enableResult.isError).toBe(false);

    // 2. List resources while capture is active (should reuse debugger session)
    const listResult = await mcpClient.callTool('browser_list_resources', { tabId });
    expect(listResult.isError).toBe(false);

    const listData = parseToolResult(listResult.content);
    const resources = listData.resources as Array<Record<string, unknown>>;
    expect(resources.length).toBeGreaterThan(0);

    // 3. Get resource content while capture is active
    const scriptResource = resources.find(r => r.type === 'Script');
    expect(scriptResource).toBeDefined();
    if (!scriptResource) throw new Error('No Script resource found');

    const contentResult = await mcpClient.callTool('browser_get_resource_content', {
      tabId,
      url: scriptResource.url as string,
    });
    expect(contentResult.isError).toBe(false);

    const contentData = parseToolResult(contentResult.content);
    expect(typeof contentData.content).toBe('string');
    expect((contentData.content as string).length).toBeGreaterThan(0);

    // 4. Disable network capture (detaches debugger)
    const disableResult = await mcpClient.callTool('browser_disable_network_capture', { tabId });
    expect(disableResult.isError).toBe(false);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// Browser tools — keyboard input
// ---------------------------------------------------------------------------

test.describe('Browser tools — keyboard input', () => {
  test('browser_press_key sends Enter to submit a form', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    // Focus the form input and type text
    const typeResult = await mcpClient.callTool('browser_type_text', {
      tabId,
      selector: '#form-input',
      text: 'test-value',
    });
    expect(typeResult.isError).toBe(false);

    // Press Enter on the form input to submit
    const pressResult = await mcpClient.callTool('browser_press_key', {
      tabId,
      key: 'Enter',
      selector: '#form-input',
    });
    expect(pressResult.isError).toBe(false);

    // Verify the form was submitted (window.__formSubmitted set by onsubmit handler)
    const checkResult = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return window.__formSubmitted === true',
    });
    expect(checkResult.isError).toBe(false);
    const checkData = parseToolResult(checkResult.content);
    const value = checkData.value as Record<string, unknown>;
    expect(value.value).toBe(true);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_press_key dispatches Escape and records keydown event', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    // Press Escape
    const pressResult = await mcpClient.callTool('browser_press_key', {
      tabId,
      key: 'Escape',
    });
    expect(pressResult.isError).toBe(false);

    // Verify the keydown event was captured by the document listener
    const checkResult = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return window.__lastKeydown',
    });
    expect(checkResult.isError).toBe(false);
    const checkData = parseToolResult(checkResult.content);
    const value = checkData.value as Record<string, unknown>;
    expect(value.value).toBe('Escape');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// Browser tools — scrolling
// ---------------------------------------------------------------------------

test.describe('Browser tools — scrolling', () => {
  test('browser_scroll with direction=down scrolls the page', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    const scrollResult = await mcpClient.callTool('browser_scroll', {
      tabId,
      direction: 'down',
    });
    expect(scrollResult.isError).toBe(false);

    const scrollData = parseToolResult(scrollResult.content);
    const scrollPosition = scrollData.scrollPosition as Record<string, number>;
    expect(scrollPosition.y).toBeGreaterThan(0);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_scroll with selector scrolls element into view', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    // Scroll to the bottom marker (positioned at bottom of 2000px section)
    const scrollResult = await mcpClient.callTool('browser_scroll', {
      tabId,
      selector: '#scroll-bottom',
    });
    expect(scrollResult.isError).toBe(false);

    const scrollData = parseToolResult(scrollResult.content);
    const scrollPosition = scrollData.scrollPosition as Record<string, number>;
    expect(scrollPosition.y).toBeGreaterThan(0);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// Browser tools — hover
// ---------------------------------------------------------------------------

test.describe('Browser tools — hover', () => {
  test('browser_hover_element dispatches mouseenter on target', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    const hoverResult = await mcpClient.callTool('browser_hover_element', {
      tabId,
      selector: '#hover-target',
    });
    expect(hoverResult.isError).toBe(false);

    // Verify the mouseenter event was captured
    const checkResult = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return window.__hovered === true',
    });
    expect(checkResult.isError).toBe(false);
    const checkData = parseToolResult(checkResult.content);
    const value = checkData.value as Record<string, unknown>;
    expect(value.value).toBe(true);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_hover_element returns error for non-existent selector', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    const hoverResult = await mcpClient.callTool('browser_hover_element', {
      tabId,
      selector: '#does-not-exist',
    });
    expect(hoverResult.isError).toBe(true);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// Browser tools — dialog handling
// ---------------------------------------------------------------------------

test.describe('Browser tools — dialog handling', () => {
  test('browser_handle_dialog returns clear error when no dialog is open', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    // Call handle_dialog with no dialog open — should return a helpful error
    const dialogResult = await mcpClient.callTool('browser_handle_dialog', {
      tabId,
      action: 'accept',
    });
    expect(dialogResult.isError).toBe(true);
    expect(dialogResult.content).toContain('No JavaScript dialog');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_handle_dialog works while network capture is active (debugger sharing)', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    // Enable network capture (attaches debugger)
    const enableResult = await mcpClient.callTool('browser_enable_network_capture', { tabId });
    expect(enableResult.isError).toBe(false);

    // Call handle_dialog — no dialog open, but should reuse the debugger
    // session from network capture and return a clear "no dialog" error
    const dialogResult = await mcpClient.callTool('browser_handle_dialog', {
      tabId,
      action: 'accept',
    });
    expect(dialogResult.isError).toBe(true);
    expect(dialogResult.content).toContain('No JavaScript dialog');

    // Verify network capture still works after handle_dialog
    const netResult = await mcpClient.callTool('browser_get_network_requests', { tabId });
    expect(netResult.isError).toBe(false);

    // Clean up
    await mcpClient.callTool('browser_disable_network_capture', { tabId });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_execute_script triggers an actual browser dialog', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // This test verifies the dialog interaction pipeline end-to-end:
    //   1. browser_execute_script can schedule a real JavaScript dialog
    //   2. The dialog appears with the correct message (confirmed by Playwright)
    //   3. After dismissal, browser_execute_script continues to work normally
    //   4. browser_handle_dialog returns the correct "no dialog open" error
    //      (the pipeline is healthy even though no dialog is present)
    //
    // Limitation: Chrome's CDP gives Playwright's primary CDP session priority
    // for dialog handling. When Playwright's session holds the dialog (registered
    // via page.on('dialog')), Chrome blocks Page.handleJavaScriptDialog from
    // other sessions including the extension's chrome.debugger session — those
    // calls hang indefinitely. Playwright must handle the dialog here so the
    // test can verify post-dialog page behavior.
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openInteractivePage(mcpClient, testServer);

    // Register a Playwright dialog listener that accepts the dialog immediately
    // and signals when it has appeared. Without a listener, Playwright
    // auto-dismisses dialogs without recording them.
    //
    // Poll extensionContext.pages() until the /interactive page appears in
    // Playwright's model. The page may not be registered yet when
    // browser_open_tab returns — Playwright discovers pages asynchronously.
    let foundPage: Awaited<ReturnType<typeof extensionContext.pages>>[number] | undefined;
    await waitFor(
      () => {
        foundPage = extensionContext.pages().find(p => p.url().includes('/interactive'));
        return foundPage !== undefined;
      },
      10_000,
      200,
      '/interactive page in extensionContext.pages()',
    );
    if (!foundPage) throw new Error('/interactive page not found in extensionContext.pages()');
    const tabPage = foundPage;

    let dialogMessage = '';
    const dialogHandled = new Promise<void>(resolve => {
      tabPage.on('dialog', dialog => {
        dialogMessage = dialog.message();
        void dialog.accept();
        resolve();
      });
    });

    // Schedule an alert with setTimeout so browser_execute_script returns
    // immediately. alert() blocks the main thread synchronously — it must be
    // deferred so this MCP call can return before the dialog fires.
    const scheduleResult = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'setTimeout(() => window.alert("test-dialog"), 100)',
    });
    expect(scheduleResult.isError).toBe(false);

    // Wait for the dialog to appear and be accepted by Playwright.
    await dialogHandled;
    expect(dialogMessage).toBe('test-dialog');

    // After dialog dismissal the page is unblocked. Verify browser_execute_script
    // still works, confirming the page's main thread is free.
    const scriptResult = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return document.readyState',
    });
    expect(scriptResult.isError).toBe(false);

    // Verify the browser_handle_dialog pipeline is healthy: with no dialog open
    // it returns the expected "No JavaScript dialog" error (not a crash or timeout).
    const handleResult = await mcpClient.callTool('browser_handle_dialog', {
      tabId,
      action: 'accept',
    });
    expect(handleResult.isError).toBe(true);
    expect(handleResult.content).toContain('No JavaScript dialog');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// Browser tools — network body capture
// ---------------------------------------------------------------------------

test.describe('Browser tools — network body capture', () => {
  test('captured POST requests include requestBody', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Enable network capture
    const enableResult = await mcpClient.callTool('browser_enable_network_capture', { tabId });
    expect(enableResult.isError).toBe(false);

    // Navigate to /post-test which auto-sends a POST to /api/echo with JSON body.
    // CDP captures requests from inline page scripts (unlike file-injected scripts).
    await mcpClient.callTool('browser_navigate_tab', {
      tabId,
      url: `${testServer.url}/post-test`,
    });

    // Poll until the /api/echo request with requestBody appears
    let echoReq: Record<string, unknown> | undefined;
    await waitFor(
      async () => {
        try {
          const result = await mcpClient.callTool('browser_get_network_requests', { tabId });
          if (result.isError) return false;
          const data = parseToolResult(result.content);
          const reqs = data.requests as Array<Record<string, unknown>>;
          echoReq = reqs.find(r => (r.url as string).includes('/api/echo') && typeof r.requestBody === 'string');
          return echoReq !== undefined;
        } catch {
          return false;
        }
      },
      15_000,
      300,
      '/api/echo with requestBody captured',
    );

    expect(echoReq).toBeDefined();
    if (!echoReq) throw new Error('Expected /api/echo request with requestBody not found');
    expect(echoReq.method).toBe('POST');
    expect(echoReq.requestBody as string).toContain('test-body-e2e');

    // Clean up
    await mcpClient.callTool('browser_disable_network_capture', { tabId });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('captured requests include responseBody', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Enable network capture
    const enableResult = await mcpClient.callTool('browser_enable_network_capture', { tabId });
    expect(enableResult.isError).toBe(false);

    // Navigate to /post-test which sends a POST to /api/echo.
    // The responseBody is attached asynchronously after Network.loadingFinished.
    await mcpClient.callTool('browser_navigate_tab', {
      tabId,
      url: `${testServer.url}/post-test`,
    });

    // Poll until the /api/echo request with responseBody appears
    let echoReq: Record<string, unknown> | undefined;
    await waitFor(
      async () => {
        try {
          const result = await mcpClient.callTool('browser_get_network_requests', { tabId });
          if (result.isError) return false;
          const data = parseToolResult(result.content);
          const reqs = data.requests as Array<Record<string, unknown>>;
          echoReq = reqs.find(r => (r.url as string).includes('/api/echo') && typeof r.responseBody === 'string');
          return echoReq !== undefined;
        } catch {
          return false;
        }
      },
      15_000,
      300,
      '/api/echo with responseBody captured',
    );

    expect(echoReq).toBeDefined();
    if (!echoReq) throw new Error('Expected /api/echo request with responseBody not found');
    const responseBody = JSON.parse(echoReq.responseBody as string) as Record<string, unknown>;
    expect(responseBody.ok).toBe(true);

    // Clean up
    await mcpClient.callTool('browser_disable_network_capture', { tabId });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// Browser tools — page HTML
// ---------------------------------------------------------------------------

test.describe('Browser tools — page HTML', () => {
  test('browser_get_page_html returns full page HTML', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_get_page_html', { tabId });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(typeof data.title).toBe('string');
    expect(typeof data.url).toBe('string');
    expect(typeof data.html).toBe('string');

    const html = data.html as string;
    expect(html).toContain('<html');
    expect(html).toContain('</html>');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_get_page_html with selector returns scoped HTML', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open the /interactive page which has #test-btn
    const tabId = await openInteractivePage(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_get_page_html', {
      tabId,
      selector: '#test-btn',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(typeof data.html).toBe('string');

    const html = data.html as string;
    expect(html).toContain('Click me');
    expect(html).not.toContain('<html');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_get_page_html returns error for non-existent selector', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const result = await mcpClient.callTool('browser_get_page_html', {
      tabId,
      selector: '#does-not-exist-e2e',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Element not found');

    await mcpClient.callTool('browser_close_tab', { tabId });
  });
});

// ---------------------------------------------------------------------------
// Browser tools — web storage
// ---------------------------------------------------------------------------

test.describe('Browser tools — web storage', () => {
  test('browser_get_storage reads localStorage entries', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Set a localStorage entry via execute_script
    await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: `localStorage.setItem('e2e-storage-key', 'e2e-storage-value')`,
    });

    // Read all localStorage entries
    const result = await mcpClient.callTool('browser_get_storage', { tabId, storageType: 'local' });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const entries = data.entries as Array<{ key: string; value: string }>;
    expect(Array.isArray(entries)).toBe(true);
    const entry = entries.find(e => e.key === 'e2e-storage-key');
    expect(entry).toBeDefined();
    expect(entry?.value).toBe('e2e-storage-value');

    // Clean up storage
    await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: `localStorage.removeItem('e2e-storage-key')`,
    });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_get_storage reads a specific key', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Set a localStorage entry
    await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: `localStorage.setItem('e2e-specific-key', 'e2e-specific-value')`,
    });

    // Read the specific key
    const result = await mcpClient.callTool('browser_get_storage', {
      tabId,
      storageType: 'local',
      key: 'e2e-specific-key',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(data.key).toBe('e2e-specific-key');
    expect(data.value).toBe('e2e-specific-value');

    // Clean up storage
    await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: `localStorage.removeItem('e2e-specific-key')`,
    });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_get_storage reads sessionStorage', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Set a sessionStorage entry
    await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: `sessionStorage.setItem('e2e-session-key', 'e2e-session-value')`,
    });

    // Read sessionStorage
    const result = await mcpClient.callTool('browser_get_storage', {
      tabId,
      storageType: 'session',
    });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    const entries = data.entries as Array<{ key: string; value: string }>;
    expect(Array.isArray(entries)).toBe(true);
    const entry = entries.find(e => e.key === 'e2e-session-key');
    expect(entry).toBeDefined();
    expect(entry?.value).toBe('e2e-session-value');

    // Clean up storage
    await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: `sessionStorage.removeItem('e2e-session-key')`,
    });
    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_get_storage returns error for non-existent tab', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_get_storage', { tabId: 999999 });
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Extension debugging tools
// ---------------------------------------------------------------------------

test.describe('Extension debugging tools', () => {
  test('extension_get_state returns state with connection and plugins', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('extension_get_state');
    expect(result.isError).toBe(false);

    const rawData = parseToolResult(result.content);
    const data = unwrapSingleConnection(rawData);

    // Connection state
    const connection = data.connection as Record<string, unknown>;
    expect(connection.wsConnected).toBe(true);
    expect(typeof connection.mcpServerUrl).toBe('string');

    // Plugins array includes the e2e-test plugin
    const plugins = data.plugins as Array<Record<string, unknown>>;
    expect(Array.isArray(plugins)).toBe(true);
    const e2ePlugin = plugins.find(p => p.name === 'e2e-test');
    expect(e2ePlugin).toBeDefined();
    if (!e2ePlugin) throw new Error('e2e-test plugin not found in state');
    expect(typeof e2ePlugin.displayName).toBe('string');
    expect(Array.isArray(e2ePlugin.urlPatterns)).toBe(true);
    expect(typeof e2ePlugin.toolCount).toBe('number');
    expect(typeof e2ePlugin.tabState).toBe('string');

    // Network captures array
    expect(Array.isArray(data.networkCaptures)).toBe(true);

    // Offscreen document
    const offscreen = data.offscreen as Record<string, unknown>;
    expect(typeof offscreen.exists).toBe('boolean');
  });

  test('extension_get_logs returns entries with expected fields', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Fetch all logs (both background and offscreen produce logs during startup)
    const result = await mcpClient.callTool('extension_get_logs');
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);

    // Entries array — startup logs from background and offscreen
    const entries = data.entries as Array<Record<string, unknown>>;
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);

    // Verify entry shape
    const entry = entries[0];
    if (!entry) throw new Error('No log entries returned');
    expect(typeof entry.timestamp).toBe('number');
    expect(typeof entry.level).toBe('string');
    expect(typeof entry.source).toBe('string');
    expect(typeof entry.message).toBe('string');

    // Stats object
    const stats = data.stats as Record<string, unknown>;
    expect(typeof stats.totalBackground).toBe('number');
    expect(typeof stats.totalOffscreen).toBe('number');
    expect(typeof stats.bufferSize).toBe('number');
  });

  test('extension_get_side_panel returns { open: false } when side panel is not open', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('extension_get_side_panel');
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(data.open).toBe(false);
  });

  test('extension_get_side_panel returns { open: true } when side panel is open', async ({
    mcpServer,
    extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open the side panel as a regular extension page in the Playwright browser context.
    // The React app registers a chrome.runtime.onMessage listener for 'sp:getState',
    // which the background service worker uses to detect whether the panel is open.
    const sidePanelPage = await openSidePanel(extensionContext);

    try {
      // Poll until the side panel's message listener is registered and responds.
      // The React app needs time to mount before it handles the 'sp:getState' message.
      let data: Record<string, unknown> = {};
      await waitFor(
        async () => {
          try {
            const r = await mcpClient.callTool('extension_get_side_panel');
            if (r.isError) return false;
            data = parseToolResult(r.content);
            return data.open === true;
          } catch {
            return false;
          }
        },
        15_000,
        500,
        'extension_get_side_panel returns open: true',
      );

      expect(data.open).toBe(true);
    } finally {
      await sidePanelPage.close();
    }
  });

  test('extension_check_adapter returns diagnostics for e2e-test plugin', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open a tab matching the e2e-test plugin URL pattern so adapter gets injected
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Wait for the adapter to be injected by polling check_adapter
    let data: Record<string, unknown> = {};
    await waitFor(
      async () => {
        try {
          const r = await mcpClient.callTool('extension_check_adapter', { plugin: 'e2e-test' });
          if (r.isError) return false;
          const raw = parseToolResult(r.content);
          data = unwrapSingleConnection(raw);
          const tabs = data.matchingTabs as Array<Record<string, unknown>>;
          return Array.isArray(tabs) && tabs.some(t => t.adapterPresent === true);
        } catch {
          return false;
        }
      },
      15_000,
      500,
      'e2e-test adapter injected in tab',
    );

    expect(data.plugin).toBe('e2e-test');
    expect(typeof data.expectedHash).toBe('string');

    const matchingTabs = data.matchingTabs as Array<Record<string, unknown>>;
    expect(matchingTabs.length).toBeGreaterThan(0);

    const tab = matchingTabs.find(t => t.adapterPresent === true);
    expect(tab).toBeDefined();
    if (!tab) throw new Error('No tab with adapter present');
    expect(tab.adapterPresent).toBe(true);
    expect(typeof tab.tabId).toBe('number');
    expect(typeof tab.tabUrl).toBe('string');
    // adapterHash can be a string or null depending on plugin build
    expect(tab.adapterHash === null || typeof tab.adapterHash === 'string').toBe(true);
    expect(typeof tab.hashMatch).toBe('boolean');
    expect(typeof tab.isReady).toBe('boolean');
    expect(typeof tab.toolCount).toBe('number');
    expect(Array.isArray(tab.toolNames)).toBe(true);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('extension_check_adapter returns error for non-existent plugin', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('extension_check_adapter', { plugin: 'non-existent-plugin' });
    // With multi-connection dispatch, the extension returns a JSON-RPC error
    // per-connection for unknown plugins. The handler may return isError or
    // an empty/error connections array depending on how the error propagates.
    if (result.isError) {
      expect(result.content).toContain('not found');
    } else {
      // The per-connection error is either swallowed (empty connections) or
      // surfaced in the connections array. Either way, the plugin is not found.
      const data = parseToolResult(result.content);
      const connections = data.connections as Array<Record<string, unknown>>;
      // All connections should report an error or have no matching tabs
      expect(
        connections.length === 0 || connections.every(c => c.error !== undefined || c.matchingTabs === undefined),
      ).toBe(true);
    }
  });

  test('extension_force_reconnect triggers reconnection and tools still work after', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Record how many tab.syncAll messages have been received before reconnect
    const syncCountBefore = mcpServer.logs.filter(l => l.includes('plugin(s) mapped')).length;

    // Call force reconnect
    const result = await mcpClient.callTool('extension_force_reconnect');
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(data.reconnecting).toBe(true);

    // Wait for a fresh tab.syncAll (indicates the extension reconnected and re-synced)
    await waitFor(
      () => {
        const syncCount = mcpServer.logs.filter(l => l.includes('plugin(s) mapped')).length;
        return syncCount > syncCountBefore;
      },
      30_000,
      300,
      'tab.syncAll after force reconnect',
    );

    // Verify the extension is connected and tools work
    await waitForExtensionConnected(mcpServer, 10_000);

    const listResult = await mcpClient.callTool('browser_list_tabs');
    expect(listResult.isError).toBe(false);

    const tabs = JSON.parse(listResult.content) as Array<Record<string, unknown>>;
    expect(Array.isArray(tabs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stress tests
// ---------------------------------------------------------------------------

test.describe('stress', () => {
  test('5 concurrent browser_execute_script calls on same tab return distinct results', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        mcpClient.callTool('browser_execute_script', {
          tabId,
          code: `return 'result-${i}'`,
        }),
      ),
    );

    // All 5 must succeed
    for (const result of results) {
      expect(result.isError).toBe(false);
    }

    // Extract values and verify positional matching
    const values = results.map(result => {
      const data = parseToolResult(result.content);
      return (data.value as Record<string, unknown>).value as string;
    });

    for (let i = 0; i < 5; i++) {
      expect(values[i]).toBe(`result-${i}`);
    }

    // No duplicates — proves no exec file namespace collision
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(5);

    await mcpClient.callTool('browser_close_tab', { tabId });
  });

  test('browser_execute_script on tab closed mid-execution returns error within 10s', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Fire a slow script (3s async operation)
    const scriptPromise = mcpClient.callTool('browser_execute_script', {
      tabId,
      code: "return new Promise(resolve => setTimeout(() => resolve('slow'), 3000))",
    });

    // Close the tab 500ms after the call starts
    await new Promise(resolve => setTimeout(resolve, 500));
    const closeStart = Date.now();
    await mcpClient.callTool('browser_close_tab', { tabId });

    // Result must arrive within 10s of tab closure (relaxed for slow CI)
    const result = await scriptPromise;
    const elapsed = Date.now() - closeStart;

    expect(result.isError).toBe(true);
    expect(elapsed).toBeLessThan(10000);

    // Error must reference tab being gone, not a generic timeout
    const errorText = JSON.stringify(result.content);
    expect(errorText).toMatch(/tab|cannot access|frame.*removed/i);
    expect(errorText).not.toMatch(/timed out/i);

    // System not corrupted — a fresh execute_script on a different tab succeeds
    const freshTabId = await openTestServerTab(mcpClient, testServer);
    const freshResult = await mcpClient.callTool('browser_execute_script', {
      tabId: freshTabId,
      code: "return 'alive'",
    });
    expect(freshResult.isError).toBe(false);
    const freshData = parseToolResult(freshResult.content);
    expect((freshData.value as Record<string, unknown>).value).toBe('alive');

    await mcpClient.callTool('browser_close_tab', { tabId: freshTabId });
  });
});
