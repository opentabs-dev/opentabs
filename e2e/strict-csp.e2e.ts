/**
 * Strict CSP E2E tests — proves the full tool dispatch path works against a page
 * with `script-src 'none'` and other maximally restrictive security headers.
 *
 * The strict-CSP test server blocks ALL JavaScript execution via CSP, yet
 * chrome.scripting.executeScript bypasses page CSP entirely because it runs
 * in a privileged extension context. These tests verify that adapter injection,
 * tool dispatch, and state management all work correctly on the most locked-down
 * websites.
 *
 * Uses the existing e2e-test plugin (plugins/e2e-test) — the same adapter works
 * on both the regular and strict-CSP test server because URL patterns match
 * http://localhost/*.
 *
 * All tests use dynamic ports and are safe for parallel execution.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { test } from '@playwright/test';
import type { McpClient, McpServer, TestServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  copyE2eTestPlugin,
  createMcpClient,
  createMinimalPlugin,
  expect,
  test as fixtureTest,
  launchExtensionContext,
  readPluginToolNames,
  readTestConfig,
  startMcpServer,
  startStrictCspServer,
  writeTestConfig,
} from './fixtures.js';
import {
  callToolExpectSuccess,
  openTestAppTab,
  parseToolResult,
  replaceIifeClosing,
  setupAdapterSymlink,
  waitFor,
  waitForExtensionConnected,
  waitForLog,
  waitForToolList,
  waitForToolResult,
  writeAndWaitForWatcher,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Setup helper — strict-CSP variant of setupToolTest
// ---------------------------------------------------------------------------

/**
 * Standard test preamble for strict-CSP tests: wait for extension, open tab
 * to the strict-CSP server, poll until the e2e-test plugin reports "ready".
 */
const setupStrictCspToolTest = async (
  mcpServer: McpServer,
  strictCspServer: TestServer,
  extensionContext: BrowserContext,
  mcpClient: McpClient,
): Promise<Page> => {
  await waitForExtensionConnected(mcpServer);
  await waitForLog(mcpServer, 'plugin(s) mapped');
  await strictCspServer.reset();

  const page = await openTestAppTab(extensionContext, strictCspServer.url, mcpServer);

  // Poll until the tool is callable (tab state = ready)
  await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

  return page;
};

// ---------------------------------------------------------------------------
// Strict CSP — full tool dispatch
// ---------------------------------------------------------------------------

fixtureTest.describe('Strict CSP — full tool dispatch', () => {
  fixtureTest(
    'adapter injects and tools work on a page with script-src none CSP',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      const page = await setupStrictCspToolTest(mcpServer, strictCspServer, extensionContext, mcpClient);

      // Verify the adapter is injected
      const adapterExists = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterExists).toBe(true);

      // Call echo tool through the full MCP stack
      const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'strict-csp roundtrip',
      });
      expect(output.ok).toBe(true);
      expect(output.message).toBe('strict-csp roundtrip');

      await page.close();
    },
  );

  fixtureTest(
    'isReady probe works through same-origin fetch despite strict CSP',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      const page = await setupStrictCspToolTest(mcpServer, strictCspServer, extensionContext, mcpClient);

      // Tool should succeed with auth on (default)
      const okOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'auth on',
      });
      expect(okOutput.message).toBe('auth on');

      // Toggle auth off — isReady() should return false, tools become unavailable
      await strictCspServer.setAuth(false);

      const failResult = await waitForToolResult(
        mcpClient,
        'e2e-test_echo',
        { message: 'auth off' },
        { isError: true },
      );
      expect(failResult.content.toLowerCase()).toMatch(/unavailable|not ready/);

      // Restore auth — tools should recover
      await strictCspServer.setAuth(true);

      const recoveredResult = await waitForToolResult(
        mcpClient,
        'e2e-test_echo',
        { message: 'auth restored' },
        { isError: false },
      );
      const recoveredOutput = parseToolResult(recoveredResult.content);
      expect(recoveredOutput.message).toBe('auth restored');

      await page.close();
    },
  );

  fixtureTest(
    'multiple tools dispatch correctly on strict-CSP page',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      const page = await setupStrictCspToolTest(mcpServer, strictCspServer, extensionContext, mcpClient);

      // Echo
      const echoOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'csp-echo',
      });
      expect(echoOutput.ok).toBe(true);
      expect(echoOutput.message).toBe('csp-echo');

      // Greet
      const greetOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_greet', {
        name: 'CSP',
      });
      expect(greetOutput.ok).toBe(true);
      expect(greetOutput.greeting).toBe('Hello, CSP!');

      // Get status
      const statusOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_get_status', {});
      expect(statusOutput.ok).toBe(true);
      expect(statusOutput.authenticated).toBe(true);
      expect(statusOutput.version).toBe('1.0.0-test');

      await page.close();
    },
  );

  fixtureTest(
    'strict-CSP server records invocations from plugin adapter',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      const page = await setupStrictCspToolTest(mcpServer, strictCspServer, extensionContext, mcpClient);

      // Clear invocations after setup (setup generates auth.check calls)
      await strictCspServer.reset();

      // Make tool calls
      await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'inv-test' });
      await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_greet', { name: 'Invocation' });
      await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_get_status', {});

      // Fetch invocation log from the strict-CSP test server
      const invocations = await strictCspServer.invocations();
      const toolInvocations = invocations.filter(i => i.path !== '/api/auth.check');

      const paths = toolInvocations.map(i => i.path);
      expect(paths).toContain('/api/echo');
      expect(paths).toContain('/api/greet');
      expect(paths).toContain('/api/status');

      // Verify bodies were correctly relayed
      const echoInv = toolInvocations.find(i => i.path === '/api/echo');
      expect(echoInv).toBeDefined();
      if (!echoInv) throw new Error('echoInv not found');
      expect((echoInv.body as Record<string, unknown>).message).toBe('inv-test');

      const greetInv = toolInvocations.find(i => i.path === '/api/greet');
      expect(greetInv).toBeDefined();
      if (!greetInv) throw new Error('greetInv not found');
      expect((greetInv.body as Record<string, unknown>).name).toBe('Invocation');

      await page.close();
    },
  );
});

// ---------------------------------------------------------------------------
// Strict CSP — verification that page scripts are truly blocked
// ---------------------------------------------------------------------------

fixtureTest.describe('Strict CSP — CSP enforcement verification', () => {
  fixtureTest(
    'strict-CSP server blocks inline scripts (validates test server is truly strict)',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      const page = await setupStrictCspToolTest(mcpServer, strictCspServer, extensionContext, mcpClient);

      // Attempt to add an inline script via page.evaluate — the script element
      // is inserted into the DOM but CSP blocks its execution.
      const scriptExecuted = await page.evaluate(() => {
        (globalThis as Record<string, unknown>).__cspTestMarker = undefined;
        const script = document.createElement('script');
        script.textContent = '(globalThis).__cspTestMarker = "executed"';
        document.head.appendChild(script);
        return (globalThis as Record<string, unknown>).__cspTestMarker === 'executed';
      });

      // CSP script-src 'none' blocks the inline script — marker stays undefined
      expect(scriptExecuted).toBe(false);

      // The extension's adapter still works despite the strict CSP
      const adapterExists = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterExists).toBe(true);

      // Full tool dispatch still works
      const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'csp-verification',
      });
      expect(output.ok).toBe(true);
      expect(output.message).toBe('csp-verification');

      await page.close();
    },
  );

  fixtureTest(
    'adapter re-injection after page reload works on strict-CSP page',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      const page = await setupStrictCspToolTest(mcpServer, strictCspServer, extensionContext, mcpClient);

      // Verify adapter is injected before reload
      const beforeReload = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(beforeReload).toBe(true);

      // Reload the page — clears the JS context including the adapter
      await page.reload({ waitUntil: 'load' });

      // Wait for the extension to re-inject the adapter after reload.
      // The extension's tabs.onUpdated listener (status: 'complete') triggers
      // injectPluginsIntoTab which re-injects into matching tabs.
      await waitFor(
        async () => {
          const injected = await page.evaluate(() => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | { adapters?: Record<string, unknown> }
              | undefined;
            return ot?.adapters?.['e2e-test'] !== undefined;
          });
          return injected;
        },
        15_000,
        500,
        'adapter re-injected after reload',
      );

      // Tool dispatch works after re-injection
      await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'after-reload',
      });
      expect(output.ok).toBe(true);
      expect(output.message).toBe('after-reload');

      await page.close();
    },
  );

  fixtureTest(
    'page has no script elements (CSP prevents all script tags)',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      const page = await setupStrictCspToolTest(mcpServer, strictCspServer, extensionContext, mcpClient);

      // The strict-CSP page HTML has no <script> tags, and CSP blocks dynamic
      // script element creation. document.scripts should be empty.
      const scriptCount = await page.evaluate(() => document.scripts.length);
      expect(scriptCount).toBe(0);

      // The adapter runs because chrome.scripting.executeScript evaluates code
      // directly in the JS context — it does not create script elements.
      const adapterExists = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterExists).toBe(true);

      // Verify full tool dispatch works
      const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'no-script-elements',
      });
      expect(output.ok).toBe(true);
      expect(output.message).toBe('no-script-elements');

      await page.close();
    },
  );
});

// ---------------------------------------------------------------------------
// Strict CSP — plugin.update re-injection
// ---------------------------------------------------------------------------

fixtureTest.describe('Strict CSP — plugin.update re-injection', () => {
  fixtureTest(
    'adapter survives hot reload on a strict-CSP page',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      const page = await setupStrictCspToolTest(mcpServer, strictCspServer, extensionContext, mcpClient);

      // Baseline: adapter is present and tool dispatch works
      const baseline = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'before-hot-reload',
      });
      expect(baseline.message).toBe('before-hot-reload');

      // Trigger hot reload — MCP server re-discovers plugins and sends sync.full.
      // sync.full uses forceReinject=false, so the existing adapter is preserved.
      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();

      await waitForLog(mcpServer, 'Hot reload complete', 20_000);
      await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);

      // Adapter should still be present after sync.full (not torn down)
      const adapterAfter = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterAfter).toBe(true);

      // Tool dispatch still works after hot reload on strict-CSP page
      const afterResult = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'after-hot-reload-csp',
      });
      expect(afterResult.message).toBe('after-hot-reload-csp');

      await page.close();
    },
  );

  fixtureTest(
    'adapter re-injects after page reload following hot reload on strict-CSP page',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      const page = await setupStrictCspToolTest(mcpServer, strictCspServer, extensionContext, mcpClient);

      // Trigger hot reload so plugin metadata is re-synced
      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();

      await waitForLog(mcpServer, 'Hot reload complete', 20_000);
      await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);

      // Reload the page — clears the JS context including the adapter.
      // The extension's tabs.onUpdated listener (status: 'complete') triggers
      // injectPluginsIntoTab which re-injects the adapter from stored metadata.
      await page.reload({ waitUntil: 'load' });

      // Wait for the adapter to be re-injected despite strict CSP
      await waitFor(
        async () => {
          const injected = await page.evaluate(() => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | { adapters?: Record<string, unknown> }
              | undefined;
            return ot?.adapters?.['e2e-test'] !== undefined;
          });
          return injected;
        },
        15_000,
        500,
        'adapter re-injected after page reload on strict-CSP page',
      );

      // Tool dispatch works after re-injection on strict-CSP page
      await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'after-reload-csp',
      });
      expect(output.message).toBe('after-reload-csp');

      await page.close();
    },
  );
});

// ---------------------------------------------------------------------------
// Strict CSP — connect-src 'none' blocks fetch, documenting expected behavior
// ---------------------------------------------------------------------------

fixtureTest.describe('Strict CSP — connect-src blocks fetch', () => {
  fixtureTest(
    'adapter injects but isReady returns false when connect-src blocks fetch',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      await waitForExtensionConnected(mcpServer);
      await waitForLog(mcpServer, 'plugin(s) mapped');

      // Enable connect-src 'none' — all fetch requests from the page will be blocked.
      // The adapter is injected via chrome.scripting.executeScript (bypasses CSP),
      // but isReady() calls fetch('/api/auth.check') which is subject to connect-src.
      await strictCspServer.control('set-connect-src', { connectSrcNone: true });
      try {
        // Open a tab to the strict-CSP server with connect-src 'none' active.
        // openTestAppTab polls for adapter presence in __openTabs.adapters — the
        // adapter injects because chrome.scripting.executeScript is privileged.
        const page = await openTestAppTab(extensionContext, strictCspServer.url, mcpServer);
        try {
          // Verify the adapter is injected (chrome.scripting.executeScript bypasses CSP)
          const adapterExists = await page.evaluate(() => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | { adapters?: Record<string, unknown> }
              | undefined;
            return ot?.adapters?.['e2e-test'] !== undefined;
          });
          expect(adapterExists).toBe(true);

          // Tool dispatch should return isError=true because isReady() returns false.
          // The adapter's isReady() calls fetch('/api/auth.check'), which is blocked
          // by connect-src 'none' — so the tab state stays 'unavailable'.
          const failResult = await waitForToolResult(
            mcpClient,
            'e2e-test_echo',
            { message: 'should-fail' },
            { isError: true },
            15_000,
          );
          expect(failResult.content.toLowerCase()).toMatch(/unavailable|not ready/);
        } finally {
          await page.close();
        }
      } finally {
        await strictCspServer.control('set-connect-src', { connectSrcNone: false }).catch(() => {});
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Strict CSP — browser_execute_script bypasses CSP
// ---------------------------------------------------------------------------

/**
 * Open a tab to a URL via browser_open_tab, wait for page load, return tabId.
 * Uses browser_execute_script to poll readyState — works because the CSP fix
 * ensures file-based injection has no eval-like constructs inside the wrapper.
 */
const openStrictCspTab = async (
  mcpClient: McpClient,
  mcpServer: McpServer,
  strictCspServer: TestServer,
): Promise<number> => {
  await waitForExtensionConnected(mcpServer);
  await waitForLog(mcpServer, 'plugin(s) mapped');

  const openResult = await mcpClient.callTool('browser_open_tab', { url: strictCspServer.url });
  expect(openResult.isError).toBe(false);
  const tabInfo = parseToolResult(openResult.content);
  const tabId = tabInfo.id as number;

  // Poll until the page finishes loading
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
    15_000,
    300,
    `strict-CSP tab ${tabId} readyState === complete`,
  );

  return tabId;
};

fixtureTest.describe('Strict CSP — browser_execute_script', () => {
  fixtureTest(
    'sync code execution returns correct result on strict-CSP page',
    async ({ mcpServer, strictCspServer, extensionContext: _extensionContext, mcpClient }) => {
      const tabId = await openStrictCspTab(mcpClient, mcpServer, strictCspServer);

      const result = await mcpClient.callTool('browser_execute_script', {
        tabId,
        code: 'return document.title',
      });
      expect(result.isError).toBe(false);

      const data = parseToolResult(result.content);
      const value = data.value as Record<string, unknown>;
      expect(value.value).toBe('Strict CSP Test App');

      await mcpClient.callTool('browser_close_tab', { tabId });
    },
  );

  fixtureTest(
    'DOM access works on strict-CSP page',
    async ({ mcpServer, strictCspServer, extensionContext: _extensionContext, mcpClient }) => {
      const tabId = await openStrictCspTab(mcpClient, mcpServer, strictCspServer);

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
    },
  );

  fixtureTest(
    'async code (Promise) resolves correctly on strict-CSP page',
    async ({ mcpServer, strictCspServer, extensionContext: _extensionContext, mcpClient }) => {
      const tabId = await openStrictCspTab(mcpClient, mcpServer, strictCspServer);

      // Use Promise.resolve instead of setTimeout-based Promise to avoid
      // timing issues where the timer may not fire before CDP evaluation
      // completes in headless CI environments.
      const result = await mcpClient.callTool('browser_execute_script', {
        tabId,
        code: 'return await Promise.resolve("csp-async")',
      });
      expect(result.isError).toBe(false);

      const data = parseToolResult(result.content);
      const value = data.value as Record<string, unknown>;
      expect(value.value).toBe('csp-async');

      await mcpClient.callTool('browser_close_tab', { tabId });
    },
  );

  fixtureTest(
    'code that throws returns an error object on strict-CSP page (not a CSP violation)',
    async ({ mcpServer, strictCspServer, extensionContext: _extensionContext, mcpClient }) => {
      const tabId = await openStrictCspTab(mcpClient, mcpServer, strictCspServer);

      const result = await mcpClient.callTool('browser_execute_script', {
        tabId,
        code: 'throw new Error("strict-csp-error")',
      });
      expect(result.isError).toBe(false);

      const data = parseToolResult(result.content);
      const value = data.value as Record<string, unknown>;
      expect(value).toHaveProperty('error');
      expect(value.error).toBe('strict-csp-error');

      await mcpClient.callTool('browser_close_tab', { tabId });
    },
  );

  fixtureTest(
    'code with no return produces null on strict-CSP page',
    async ({ mcpServer, strictCspServer, extensionContext: _extensionContext, mcpClient }) => {
      const tabId = await openStrictCspTab(mcpClient, mcpServer, strictCspServer);

      const result = await mcpClient.callTool('browser_execute_script', {
        tabId,
        code: 'var x = 1 + 1',
      });
      expect(result.isError).toBe(false);

      const data = parseToolResult(result.content);
      const value = data.value as Record<string, unknown>;
      expect(value.value).toBeNull();

      await mcpClient.callTool('browser_close_tab', { tabId });
    },
  );

  fixtureTest(
    'sequential executions on strict-CSP page leave no leftover globalThis state',
    async ({ mcpServer, strictCspServer, extensionContext: _extensionContext, mcpClient }) => {
      const tabId = await openStrictCspTab(mcpClient, mcpServer, strictCspServer);

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

      await mcpClient.callTool('browser_close_tab', { tabId });
    },
  );

  fixtureTest(
    'concurrent executions on strict-CSP page do not collide',
    async ({ mcpServer, strictCspServer, extensionContext: _extensionContext, mcpClient }) => {
      const tabId = await openStrictCspTab(mcpClient, mcpServer, strictCspServer);

      // Execute two scripts concurrently on the same tab
      const [result1, result2] = await Promise.all([
        mcpClient.callTool('browser_execute_script', {
          tabId,
          code: 'return "csp-concurrent-a"',
        }),
        mcpClient.callTool('browser_execute_script', {
          tabId,
          code: 'return "csp-concurrent-b"',
        }),
      ]);

      expect(result1.isError).toBe(false);
      expect(result2.isError).toBe(false);

      const data1 = parseToolResult(result1.content);
      const data2 = parseToolResult(result2.content);
      const value1 = (data1.value as Record<string, unknown>).value as string;
      const value2 = (data2.value as Record<string, unknown>).value as string;

      // Both should complete — order may vary due to concurrency
      const values = [value1, value2].sort();
      expect(values).toEqual(['csp-concurrent-a', 'csp-concurrent-b']);

      await mcpClient.callTool('browser_close_tab', { tabId });
    },
  );

  fixtureTest(
    'strict-CSP page blocks eval (validates test environment is truly strict)',
    async ({ mcpServer, strictCspServer, extensionContext: _extensionContext, mcpClient }) => {
      const tabId = await openStrictCspTab(mcpClient, mcpServer, strictCspServer);

      // eval() should throw a CSP error on this page
      const evalResult = await mcpClient.callTool('browser_execute_script', {
        tabId,
        code: 'try { return eval("1+1") } catch(e) { return "CSP_BLOCKED:" + e.message }',
      });
      expect(evalResult.isError).toBe(false);

      const evalData = parseToolResult(evalResult.content);
      const evalValue = (evalData.value as Record<string, unknown>).value as string;
      // eval() is blocked by CSP — the catch block returns a CSP error message
      expect(evalValue).toMatch(/CSP_BLOCKED:/);

      // new Function() should also be blocked
      const funcResult = await mcpClient.callTool('browser_execute_script', {
        tabId,
        code: 'try { return new Function("return 1")() } catch(e) { return "CSP_BLOCKED:" + e.message }',
      });
      expect(funcResult.isError).toBe(false);

      const funcData = parseToolResult(funcResult.content);
      const funcValue = (funcData.value as Record<string, unknown>).value as string;
      expect(funcValue).toMatch(/CSP_BLOCKED:/);

      // Normal code still works (proves our wrapper bypasses CSP)
      const normalResult = await mcpClient.callTool('browser_execute_script', {
        tabId,
        code: 'return 1 + 1',
      });
      expect(normalResult.isError).toBe(false);

      const normalData = parseToolResult(normalResult.content);
      const normalValue = (normalData.value as Record<string, unknown>).value;
      expect(normalValue).toBe(2);

      await mcpClient.callTool('browser_close_tab', { tabId });
    },
  );
});

// ---------------------------------------------------------------------------
// Strict CSP — file watcher IIFE change triggers force re-injection
// ---------------------------------------------------------------------------

test.describe('Strict CSP — file watcher IIFE re-injection', () => {
  test('modified IIFE is force re-injected into strict-CSP tab after file watcher detects change', async () => {
    const { pluginDir, tmpDir } = copyE2eTestPlugin();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-csp-iife-reinject-'));

    const prefixedToolNames = readPluginToolNames();
    const tools: Record<string, boolean> = {};
    for (const t of prefixedToolNames) {
      tools[t] = true;
    }
    writeTestConfig(configDir, { localPlugins: [pluginDir], tools });

    // Track resources as they're created so partial failures clean up
    // everything that was started before the throw.
    let server: McpServer | undefined;
    let strictCspSrv: TestServer | undefined;
    let context: BrowserContext | undefined;
    let cleanupDir: string | undefined;
    let client: McpClient | undefined;

    try {
      server = await startMcpServer(configDir, true);
      strictCspSrv = await startStrictCspServer();

      const ext = await launchExtensionContext(server.port, server.secret);
      context = ext.context;
      cleanupDir = ext.cleanupDir;
      setupAdapterSymlink(configDir, ext.extensionDir);

      client = createMcpClient(server.port, server.secret);

      await client.initialize();
      await waitForExtensionConnected(server);
      await waitForLog(server, 'plugin(s) mapped');

      // Open a tab to the strict-CSP test server and wait for adapter injection
      const page = await openTestAppTab(context, strictCspSrv.url, server);

      // Poll until tool dispatch works (tab state = ready)
      await waitForToolResult(client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Baseline: adapter is present and tool dispatch works on strict-CSP page
      const baseline = await callToolExpectSuccess(client, server, 'e2e-test_echo', {
        message: 'csp-before-update',
      });
      expect(baseline.message).toBe('csp-before-update');

      // Verify no update marker is set initially
      const markerBefore = await page.evaluate(() => (globalThis as Record<string, unknown>).__e2eReinjectMarker);
      expect(markerBefore).toBeUndefined();

      // Modify the IIFE to set a global marker variable on re-injection.
      // The marker is a global (not a property on the adapter) because the
      // adapter is frozen by the hash-setter snippet appended by opentabs-plugin build.
      const iifePath = path.join(pluginDir, 'dist', 'adapter.iife.js');
      const originalIife = fs.readFileSync(iifePath, 'utf-8');
      const markerCode = [
        '',
        '// Injected by E2E test to verify re-injection on strict-CSP page',
        'globalThis.__e2eReinjectMarker = true;',
      ].join('\n');
      const modifiedIife = replaceIifeClosing(originalIife, markerCode);
      await writeAndWaitForWatcher(server, () => fs.writeFileSync(iifePath, modifiedIife, 'utf-8'), 'IIFE updated for');

      // Wait for the marker to appear in the page (proves re-injection happened
      // on the strict-CSP page despite script-src 'none')
      await waitFor(
        async () => {
          const marker = await page.evaluate(
            () => (globalThis as Record<string, unknown>).__e2eReinjectMarker === true,
          );
          return marker;
        },
        15_000,
        500,
        '__e2eReinjectMarker to be true after re-injection on strict-CSP page',
      );

      // Tool dispatch still works after re-injection on strict-CSP page
      const afterResult = await callToolExpectSuccess(client, server, 'e2e-test_echo', {
        message: 'csp-after-update',
      });
      expect(afterResult.message).toBe('csp-after-update');

      await page.close();
    } finally {
      if (client) await client.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (server) await server.kill().catch(() => {});
      if (strictCspSrv) await strictCspSrv.kill().catch(() => {});
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Strict CSP — multiple plugins injected simultaneously
// ---------------------------------------------------------------------------

fixtureTest.describe('Strict CSP — multiple plugins on same page', () => {
  fixtureTest(
    'two plugins both inject adapters into a strict-CSP page despite script-src none',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      const page = await setupStrictCspToolTest(mcpServer, strictCspServer, extensionContext, mcpClient);

      // Baseline: e2e-test adapter is present and tool dispatch works
      const baseline = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'csp-before-second-plugin',
      });
      expect(baseline.message).toBe('csp-before-second-plugin');

      // Create a minimal second plugin matching http://localhost/*
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-csp-multi-plugin-'));
      try {
        const extraPluginDir = createMinimalPlugin(tmpDir, 'csp-extra-plugin', [
          { name: 'noop', description: 'No-op tool for strict-CSP multi-plugin test' },
        ]);

        // Add the second plugin to the config
        const config = readTestConfig(mcpServer.configDir);
        config.localPlugins.push(extraPluginDir);
        writeTestConfig(mcpServer.configDir, config);

        // Trigger hot reload — server discovers both plugins, sends sync.full
        mcpServer.logs.length = 0;
        mcpServer.triggerHotReload();

        await waitForLog(mcpServer, 'Hot reload complete', 20_000);
        await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);

        // Wait for the extra plugin's tool to appear in the MCP tool list
        await waitForToolList(
          mcpClient,
          list => list.some(t => t.name === 'csp-extra-plugin_noop'),
          10_000,
          300,
          'csp-extra-plugin_noop to appear in tool list',
        );

        // Wait for both adapters to be present in the strict-CSP page
        await waitFor(
          async () => {
            const adapters = await page.evaluate(() => {
              const ot = (globalThis as Record<string, unknown>).__openTabs as
                | { adapters?: Record<string, unknown> }
                | undefined;
              return {
                e2eTest: ot?.adapters?.['e2e-test'] !== undefined,
                extraPlugin: ot?.adapters?.['csp-extra-plugin'] !== undefined,
              };
            });
            return adapters.e2eTest && adapters.extraPlugin;
          },
          15_000,
          500,
          'both e2e-test and csp-extra-plugin adapters to be present on strict-CSP page',
        );

        // Verify both adapter names are in the page
        const adapterNames = await page.evaluate(() => {
          const ot = (globalThis as Record<string, unknown>).__openTabs as
            | { adapters?: Record<string, unknown> }
            | undefined;
          return Object.keys(ot?.adapters ?? {}).sort();
        });
        expect(adapterNames).toContain('csp-extra-plugin');
        expect(adapterNames).toContain('e2e-test');

        await page.close();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );

  fixtureTest(
    'e2e-test tool dispatch works on strict-CSP page with two adapters present',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      const page = await setupStrictCspToolTest(mcpServer, strictCspServer, extensionContext, mcpClient);

      // Add a second plugin
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-csp-dispatch-'));
      try {
        const extraPluginDir = createMinimalPlugin(tmpDir, 'csp-dispatch-extra', [
          { name: 'noop', description: 'No-op tool for dispatch test' },
        ]);

        const config = readTestConfig(mcpServer.configDir);
        config.localPlugins.push(extraPluginDir);
        writeTestConfig(mcpServer.configDir, config);

        mcpServer.logs.length = 0;
        mcpServer.triggerHotReload();

        await waitForLog(mcpServer, 'Hot reload complete', 20_000);
        await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);

        // Wait for both adapters
        await waitFor(
          async () => {
            const adapters = await page.evaluate(() => {
              const ot = (globalThis as Record<string, unknown>).__openTabs as
                | { adapters?: Record<string, unknown> }
                | undefined;
              return {
                e2eTest: ot?.adapters?.['e2e-test'] !== undefined,
                extraPlugin: ot?.adapters?.['csp-dispatch-extra'] !== undefined,
              };
            });
            return adapters.e2eTest && adapters.extraPlugin;
          },
          15_000,
          500,
          'both adapters present for dispatch test',
        );

        // e2e-test tool dispatch works with two adapters on the strict-CSP page
        const echoResult = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
          message: 'csp-dual-adapter-echo',
        });
        expect(echoResult.ok).toBe(true);
        expect(echoResult.message).toBe('csp-dual-adapter-echo');

        const greetResult = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_greet', {
          name: 'DualCSP',
        });
        expect(greetResult.ok).toBe(true);
        expect(greetResult.greeting).toBe('Hello, DualCSP!');

        await page.close();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );

  fixtureTest(
    'removing one plugin does not affect the other on a strict-CSP page',
    async ({ mcpServer, strictCspServer, extensionContext, mcpClient }) => {
      const page = await setupStrictCspToolTest(mcpServer, strictCspServer, extensionContext, mcpClient);

      // Add a second plugin
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-csp-remove-'));
      try {
        const extraPluginDir = createMinimalPlugin(tmpDir, 'csp-removable', [
          { name: 'noop', description: 'No-op tool for removal test' },
        ]);

        const config = readTestConfig(mcpServer.configDir);
        config.localPlugins.push(extraPluginDir);
        writeTestConfig(mcpServer.configDir, config);

        mcpServer.logs.length = 0;
        mcpServer.triggerHotReload();

        await waitForLog(mcpServer, 'Hot reload complete', 20_000);
        await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);

        // Wait for both adapters to be present
        await waitFor(
          async () => {
            const adapters = await page.evaluate(() => {
              const ot = (globalThis as Record<string, unknown>).__openTabs as
                | { adapters?: Record<string, unknown> }
                | undefined;
              return {
                e2eTest: ot?.adapters?.['e2e-test'] !== undefined,
                extraPlugin: ot?.adapters?.['csp-removable'] !== undefined,
              };
            });
            return adapters.e2eTest && adapters.extraPlugin;
          },
          15_000,
          500,
          'both adapters present before removal',
        );

        // Verify e2e-test tool dispatch works with both adapters
        const beforeRemoval = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
          message: 'csp-before-removal',
        });
        expect(beforeRemoval.message).toBe('csp-before-removal');

        // Remove the second plugin from config (keep only e2e-test)
        const updatedConfig = readTestConfig(mcpServer.configDir);
        updatedConfig.localPlugins = updatedConfig.localPlugins.filter(p => !p.includes('csp-removable'));
        writeTestConfig(mcpServer.configDir, updatedConfig);

        // Trigger hot reload — server discovers only e2e-test, sends sync.full
        mcpServer.logs.length = 0;
        mcpServer.triggerHotReload();

        await waitForLog(mcpServer, 'Hot reload complete', 20_000);
        await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);

        // Wait for the removed plugin's tool to disappear from the tool list
        await waitForToolList(
          mcpClient,
          list => !list.some(t => t.name === 'csp-removable_noop'),
          10_000,
          300,
          'csp-removable_noop to be removed from tool list',
        );

        // e2e-test adapter and tool dispatch still works on the strict-CSP page
        // after the second plugin was removed
        await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

        const afterRemoval = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
          message: 'csp-after-removal',
        });
        expect(afterRemoval.ok).toBe(true);
        expect(afterRemoval.message).toBe('csp-after-removal');

        // Verify e2e-test adapter is still present in the page
        const adapterPresent = await page.evaluate(() => {
          const ot = (globalThis as Record<string, unknown>).__openTabs as
            | { adapters?: Record<string, unknown> }
            | undefined;
          return ot?.adapters?.['e2e-test'] !== undefined;
        });
        expect(adapterPresent).toBe(true);

        await page.close();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});
