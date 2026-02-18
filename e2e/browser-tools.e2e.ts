/**
 * Browser tools E2E tests — MCP client → MCP server → WebSocket → extension → chrome.tabs API.
 *
 * These tests exercise the browser tools that call chrome.* APIs directly
 * through the extension's background script, bypassing the plugin adapter
 * lifecycle entirely. Each tool dispatches a JSON-RPC command from the MCP
 * server to the extension via WebSocket and returns the result.
 *
 * Prerequisites (all pre-built, not created at test time):
 *   - `bun run build` has been run (platform dist/ files exist)
 *   - `plugins/e2e-test` has been built (`cd plugins/e2e-test && bun run build`)
 *   - Chromium is installed for Playwright
 *
 * All tests use dynamic ports and are safe for parallel execution.
 */

import { test, expect } from './fixtures.js';
import { waitForExtensionConnected, waitForLog, parseToolResult, waitFor, BROWSER_TOOL_NAMES } from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';
import type { McpClient, McpServer, TestServer } from './fixtures.js';

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
  await waitForLog(mcpServer, 'tab.syncAll received');
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
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_open_tab', { url: 'https://example.com' });
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
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open a tab first
    const openResult = await mcpClient.callTool('browser_open_tab', { url: 'https://example.com' });
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
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open a tab
    const openResult = await mcpClient.callTool('browser_open_tab', { url: 'https://example.com' });
    expect(openResult.isError).toBe(false);
    const tabInfo = parseToolResult(openResult.content);
    const tabId = tabInfo.id as number;

    // Navigate it
    const navResult = await mcpClient.callTool('browser_navigate_tab', {
      tabId,
      url: 'https://example.org',
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

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return new Promise(resolve => setTimeout(() => resolve("async-result"), 100))',
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

    const result = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return new Promise((_, reject) => setTimeout(() => reject(new Error("async-fail")), 100))',
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

  test('cleans up globalThis.__openTabs.__lastExecResult after execution', async ({
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

    // Verify the global is cleaned up by checking it's absent
    const checkResult = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'return (globalThis.__openTabs && globalThis.__openTabs.__lastExecResult) || "clean"',
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

    // Wait briefly for async file deletion
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check that no __exec-*.js files remain in the adapters directory
    const adaptersDir = path.join(mcpServer.configDir, 'extension', 'adapters');
    const files = fs.readdirSync(adaptersDir);
    const execFiles = files.filter(f => f.startsWith('__exec-') && f.endsWith('.js'));
    expect(execFiles).toEqual([]);

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

    // Wait briefly for async file deletion
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check that no __exec-*.js files remain
    const adaptersDir = path.join(mcpServer.configDir, 'extension', 'adapters');
    const files = fs.readdirSync(adaptersDir);
    const execFiles = files.filter(f => f.startsWith('__exec-') && f.endsWith('.js'));
    expect(execFiles).toEqual([]);
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

    // Verify no leftover globals
    const checkResult = await mcpClient.callTool('browser_execute_script', {
      tabId,
      code: 'var ot = globalThis.__openTabs || {}; return { hasResult: "__lastExecResult" in ot, hasAsync: "__lastExecAsync" in ot }',
    });
    expect(checkResult.isError).toBe(false);
    const checkData = parseToolResult(checkResult.content);
    const checkValue = (checkData.value as Record<string, unknown>).value as Record<string, unknown>;
    expect(checkValue.hasResult).toBe(false);
    expect(checkValue.hasAsync).toBe(false);

    // Wait for file cleanup
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify no leftover exec files
    const adaptersDir = path.join(mcpServer.configDir, 'extension', 'adapters');
    const files = fs.readdirSync(adaptersDir);
    const execFiles = files.filter(f => f.startsWith('__exec-') && f.endsWith('.js'));
    expect(execFiles).toEqual([]);

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

    // Wait for file cleanup
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify no leftover exec files
    const adaptersDir = path.join(mcpServer.configDir, 'extension', 'adapters');
    const files = fs.readdirSync(adaptersDir);
    const execFiles = files.filter(f => f.startsWith('__exec-') && f.endsWith('.js'));
    expect(execFiles).toEqual([]);

    await mcpClient.callTool('browser_close_tab', { tabId: tabId1 });
    await mcpClient.callTool('browser_close_tab', { tabId: tabId2 });
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

  test('browser_open_tab accepts valid https: URL', async ({
    mcpServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    const result = await mcpClient.callTool('browser_open_tab', { url: 'https://example.com' });
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
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open two tabs — the second one will be active after creation
    const open1 = await mcpClient.callTool('browser_open_tab', { url: 'https://example.com' });
    expect(open1.isError).toBe(false);
    const tabId1 = parseToolResult(open1.content).id as number;

    const open2 = await mcpClient.callTool('browser_open_tab', { url: 'https://example.org' });
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
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);

    // Open a tab (no need to wait for full page load — just need a valid tab ID)
    const openResult = await mcpClient.callTool('browser_open_tab', { url: 'https://example.com' });
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
  test('captures a base64 PNG screenshot', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await initAndListTools(mcpServer, mcpClient);
    const tabId = await openTestServerTab(mcpClient, testServer);

    // Small delay for the page to render fully
    await new Promise(resolve => setTimeout(resolve, 500));

    const result = await mcpClient.callTool('browser_screenshot_tab', { tabId });
    expect(result.isError).toBe(false);

    const data = parseToolResult(result.content);
    expect(typeof data.image).toBe('string');
    // PNG files encoded in base64 start with 'iVBOR' (the base64 encoding of the PNG header)
    expect((data.image as string).startsWith('iVBOR')).toBe(true);

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
      url: testServer.url + '/interactive',
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
