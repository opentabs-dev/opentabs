/**
 * IIFE injection E2E tests — proves that adapter re-injection works when
 * plugin files change on disk, adapter cleanup works when plugins are removed
 * from config, and the plugin.uninstall JSON-RPC method correctly tears down
 * adapters and cleans up storage.
 *
 * These tests verify the full pipeline:
 *   1. File watcher detects IIFE change → MCP server sends plugin.update
 *   2. Extension receives plugin.update → re-injects adapter with forceReinject
 *   3. New adapter code is active in the tab (old adapter torn down)
 *   4. plugin.uninstall tears down adapter and removes storage
 *   5. Invalid plugin.uninstall (empty name) does not affect installed plugins
 *
 * All tests use dynamic ports, per-test plugin copies, and isolated config
 * directories. Safe for parallel execution.
 */

import { expect, test as fixtureTest, createMinimalPlugin, writeTestConfig, readTestConfig } from './fixtures.js';
import {
  waitForLog,
  waitForExtensionConnected,
  openTestAppTab,
  parseToolResult,
  waitForToolResult,
  callToolExpectSuccess,
  waitFor,
  waitForToolList,
  setupToolTest,
  setupIsolatedIifeTest,
  getExtensionId,
} from './helpers.js';
import { test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// plugin.update re-injection into live tabs
// ---------------------------------------------------------------------------

test.describe('IIFE injection — plugin.update re-injection', () => {
  test('modified IIFE is re-injected into matching tab after file watcher detects change', async () => {
    const ctx = await setupIsolatedIifeTest('iife-reinject');

    try {
      // Open a tab to the test server and wait for adapter injection
      const page = await openTestAppTab(ctx.context, ctx.testServer.url, ctx.server, ctx.testServer);

      // Poll until tool dispatch works (tab state = ready)
      await waitForToolResult(ctx.client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Baseline: tool works and returns original behavior
      const baseline = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'before-update',
      });
      expect(baseline.message).toBe('before-update');

      // Verify no update marker is set initially
      const markerBefore = await page.evaluate(() => (globalThis as Record<string, unknown>).__e2eReinjectMarker);
      expect(markerBefore).toBeUndefined();

      // Modify the IIFE to set a global marker variable on re-injection.
      // The marker is a global (not a property on the adapter) because the
      // adapter is frozen by the hash-setter snippet appended by opentabs-plugin build.
      // Setting a property on a frozen object fails silently; a global variable
      // is always writable and proves the NEW code ran after re-injection.
      const iifePath = path.join(ctx.pluginDir, 'dist', 'adapter.iife.js');
      const originalIife = fs.readFileSync(iifePath, 'utf-8');
      const markerCode = [
        '',
        '// Injected by E2E test to verify re-injection',
        'globalThis.__e2eReinjectMarker = true;',
      ].join('\n');
      // Append the marker code just before the closing `})();`
      // The IIFE ends with `})();` — insert the marker before the last line
      const modifiedIife = originalIife.replace(/}\)\(\);[\s]*$/, `${markerCode}\n})();\n`);
      fs.writeFileSync(iifePath, modifiedIife, 'utf-8');

      // Wait for the file watcher to detect the IIFE change and send plugin.update
      await waitForLog(ctx.server, 'IIFE updated for', 15_000);

      // Wait for the marker to appear in the page (proves re-injection happened)
      await waitFor(
        async () => {
          const marker = await page.evaluate(
            () => (globalThis as Record<string, unknown>).__e2eReinjectMarker === true,
          );
          return marker;
        },
        15_000,
        500,
        '__e2eReinjectMarker to be true after re-injection',
      );

      // Tool dispatch still works after re-injection
      const afterResult = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'after-update',
      });
      expect(afterResult.message).toBe('after-update');

      await page.close();
    } finally {
      await ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// sync.full removal cleans up adapters from live tabs
// ---------------------------------------------------------------------------

fixtureTest.describe('IIFE injection — sync.full removal cleanup', () => {
  fixtureTest(
    'removing plugin from config tears down adapter in matching tab after hot reload',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      // Standard setup: wait for extension, open tab, verify tool works
      const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

      // Baseline: adapter is present and tool dispatch works
      const baseline = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'before-removal',
      });
      expect(baseline.message).toBe('before-removal');

      // Verify adapter is present in the page
      const adapterBefore = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterBefore).toBe(true);

      // Remove the plugin from config (empty plugins array, no tools)
      const config = readTestConfig(mcpServer.configDir);
      config.localPlugins = [];
      config.tools = {};
      writeTestConfig(mcpServer.configDir, config);

      // Clear logs so we can detect the fresh hot reload cycle
      mcpServer.logs.length = 0;

      // Trigger hot reload — MCP server re-discovers plugins (now empty),
      // sends sync.full with zero plugins. The extension's handleSyncFull
      // detects e2e-test as removed and calls cleanupAdaptersInMatchingTabs.
      mcpServer.triggerHotReload();

      // Wait for the hot reload to complete (sync.full is sent to the extension).
      // With 0 plugins, the extension's sendTabSyncAll returns early (nothing
      // to report), so there is no "tab.syncAll received" log.
      await waitForLog(mcpServer, 'Hot reload complete', 20_000);

      // Plugin tools should be gone from the MCP server's tool list.
      await waitForToolList(
        mcpClient,
        list => !list.some(t => t.name === 'e2e-test_echo'),
        10_000,
        300,
        'e2e-test tools to be removed from tool list',
      );

      // Wait for the adapter to be removed from the page.
      // handleSyncFull calls cleanupAdaptersInMatchingTabs for removed plugins,
      // which executes chrome.scripting.executeScript to teardown + delete the
      // adapter from __openTabs.adapters.
      await waitFor(
        async () => {
          const adapterGone = await page.evaluate(() => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | { adapters?: Record<string, unknown> }
              | undefined;
            return ot?.adapters?.['e2e-test'] === undefined;
          });
          return adapterGone;
        },
        15_000,
        500,
        'adapter e2e-test to be removed from __openTabs.adapters',
      );

      // Tool dispatch should return an error (plugin no longer registered)
      const errorResult = await mcpClient.callTool('e2e-test_echo', { message: 'after-removal' });
      expect(errorResult.isError).toBe(true);

      await page.close();
    },
  );

  fixtureTest(
    'stale adapter .js file is deleted from disk after plugin removed and sync.full sent',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      // Standard setup: wait for extension, open tab, verify tool works
      const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

      // Verify the adapter file exists on disk before removal.
      // The MCP server writes adapter files to <configDir>/extension/adapters/.
      // In tests, this is symlinked to the extension copy's adapters/ directory.
      // With content-hashed filenames, find the file matching e2e-test-*.js.
      const adaptersDir = path.join(mcpServer.configDir, 'extension', 'adapters');
      const adapterFiles = fs.readdirSync(adaptersDir).filter(f => f.startsWith('e2e-test') && f.endsWith('.js'));
      expect(adapterFiles.length).toBeGreaterThan(0);

      // Remove the plugin from config (empty plugins array, no tools)
      const config = readTestConfig(mcpServer.configDir);
      config.localPlugins = [];
      config.tools = {};
      writeTestConfig(mcpServer.configDir, config);

      // Clear logs so we can detect the fresh hot reload cycle
      mcpServer.logs.length = 0;

      // Trigger hot reload — MCP server re-discovers plugins (now empty),
      // cleanupStaleAdapterFiles deletes e2e-test.js, then sends sync.full.
      mcpServer.triggerHotReload();

      await waitForLog(mcpServer, 'Hot reload complete', 20_000);

      // Wait for the stale adapter file(s) to be deleted from disk
      await waitFor(
        () => {
          const remaining = fs.readdirSync(adaptersDir).filter(f => f.startsWith('e2e-test') && f.endsWith('.js'));
          return remaining.length === 0;
        },
        10_000,
        500,
        'e2e-test adapter file(s) to be deleted from adapters directory',
      );

      await page.close();
    },
  );
});

// ---------------------------------------------------------------------------
// plugin.uninstall flow — tests the extension's handlePluginUninstall handler
// directly by sending JSON-RPC messages through chrome.runtime.sendMessage
// from an extension page, exercising the same code path as real WebSocket messages.
// ---------------------------------------------------------------------------

/**
 * Open an extension page that has access to chrome.runtime.sendMessage.
 * Used to inject messages into the extension's background script message handler,
 * simulating messages that would normally arrive over the WebSocket from the MCP server.
 */
const openExtensionPage = async (context: BrowserContext): Promise<Page> => {
  const extId = await getExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/side-panel/side-panel.html`, {
    waitUntil: 'load',
    timeout: 10_000,
  });
  return page;
};

/**
 * Send a simulated server→extension JSON-RPC message by dispatching it through
 * chrome.runtime.sendMessage from an extension page. This triggers the background
 * script's ws:message handler, exercising the same code path as a real WebSocket message.
 */
const sendServerMessage = async (extPage: Page, message: Record<string, unknown>): Promise<void> => {
  await extPage.evaluate(async (msg: Record<string, unknown>) => {
    const chromeApi = (globalThis as Record<string, unknown>).chrome as {
      runtime: { sendMessage: (msg: unknown) => Promise<unknown> };
    };
    await chromeApi.runtime.sendMessage({ type: 'ws:message', data: msg });
  }, message);
};

fixtureTest.describe('IIFE injection — plugin.uninstall flow', () => {
  fixtureTest(
    'plugin.uninstall with valid name tears down adapter and cleans up storage',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

      // Baseline: adapter is present and tool dispatch works
      const baseline = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'before-uninstall',
      });
      expect(baseline.message).toBe('before-uninstall');

      const adapterBefore = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterBefore).toBe(true);

      // Send plugin.uninstall via the extension's message handler.
      // handlePluginUninstall is async (fire-and-forget from the ws:message
      // handler), so sendServerMessage resolves before the uninstall completes.
      const extPage = await openExtensionPage(extensionContext);
      await sendServerMessage(extPage, {
        jsonrpc: '2.0',
        method: 'plugin.uninstall',
        params: { name: 'e2e-test' },
        id: 'test-uninstall-1',
      });

      // Wait for tool dispatch to fail — this is the most reliable signal that
      // the uninstall completed. handlePluginUninstall removes the plugin from
      // chrome.storage.local, so resolvePlugin() returns null and the extension
      // sends a JSONRPC error. Waiting on tool dispatch rather than in-page
      // adapter state avoids flakiness from chrome.scripting.executeScript
      // cleanup being best-effort under load.
      await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'after-uninstall' }, { isError: true }, 15_000);

      await extPage.close();
      await page.close();
    },
  );

  fixtureTest(
    'plugin.uninstall with empty name does not affect installed plugins',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

      const adapterBefore = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterBefore).toBe(true);

      // Send plugin.uninstall with an empty name — triggers -32602 error response
      // back to the server, but should not modify any adapter state
      const extPage = await openExtensionPage(extensionContext);
      await sendServerMessage(extPage, {
        jsonrpc: '2.0',
        method: 'plugin.uninstall',
        params: { name: '' },
        id: 'test-uninstall-invalid-1',
      });

      // Send plugin.uninstall with missing name field — also triggers -32602
      await sendServerMessage(extPage, {
        jsonrpc: '2.0',
        method: 'plugin.uninstall',
        params: {},
        id: 'test-uninstall-invalid-2',
      });

      // Verify adapter is still present — tool dispatch success (below) is the
      // strongest proof, but checking the in-page state confirms no teardown ran.
      const adapterAfter = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterAfter).toBe(true);

      // Tool dispatch still works — the invalid uninstall did not affect the plugin
      const result = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'still-working',
      });
      expect(result.message).toBe('still-working');

      await extPage.close();
      await page.close();
    },
  );

  fixtureTest(
    'after uninstall, all tools for the uninstalled plugin return errors',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);
      await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'pre-uninstall' });

      // Uninstall the plugin.
      // handlePluginUninstall is async (fire-and-forget from the ws:message
      // handler), so sendServerMessage resolves before the uninstall completes.
      const extPage = await openExtensionPage(extensionContext);
      await sendServerMessage(extPage, {
        jsonrpc: '2.0',
        method: 'plugin.uninstall',
        params: { name: 'e2e-test' },
        id: 'test-uninstall-dispatch-check',
      });

      // Wait for tool dispatch to fail — this is the most reliable signal that
      // the uninstall completed. Polling via tool dispatch avoids dependence on
      // chrome.scripting.executeScript cleanup (best-effort under load).
      await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'should-fail' }, { isError: true }, 15_000);

      // Every tool for the uninstalled plugin should return an error
      const greetResult = await mcpClient.callTool('e2e-test_greet', { name: 'Test' });
      expect(greetResult.isError).toBe(true);

      const statusResult = await mcpClient.callTool('e2e-test_get_status', {});
      expect(statusResult.isError).toBe(true);

      await extPage.close();
      await page.close();
    },
  );
});

// ---------------------------------------------------------------------------
// Two plugins targeting the same URL pattern both inject independently
// ---------------------------------------------------------------------------

fixtureTest.describe('IIFE injection — overlapping URL patterns', () => {
  fixtureTest(
    'two plugins matching the same URL both inject adapters into a single tab',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      // Standard setup: wait for extension, open tab, verify e2e-test tool works
      const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

      // Baseline: e2e-test adapter is present and tool dispatch works
      const baseline = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'before-second-plugin',
      });
      expect(baseline.message).toBe('before-second-plugin');

      // Create a minimal second plugin with the same URL pattern (http://localhost/*)
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-extra-plugin-'));
      const extraPluginDir = createMinimalPlugin(tmpDir, 'extra-plugin', [
        { name: 'noop', description: 'No-op tool for testing' },
      ]);

      // Add the second plugin to the config and enable its tool
      const config = readTestConfig(mcpServer.configDir);
      config.localPlugins.push(extraPluginDir);
      config.tools['extra-plugin_noop'] = true;
      writeTestConfig(mcpServer.configDir, config);

      // Trigger hot reload — server discovers both plugins, sends sync.full
      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();

      await waitForLog(mcpServer, 'Hot reload complete', 20_000);
      await waitForLog(mcpServer, 'tab.syncAll received', 20_000);

      // Wait for extra-plugin tools to appear in the MCP tool list
      await waitForToolList(
        mcpClient,
        list => list.some(t => t.name === 'extra-plugin_noop'),
        10_000,
        300,
        'extra-plugin_noop to appear in tool list',
      );

      // Wait for both adapters to be present in the page
      await waitFor(
        async () => {
          const adapters = await page.evaluate(() => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | { adapters?: Record<string, unknown> }
              | undefined;
            return {
              e2eTest: ot?.adapters?.['e2e-test'] !== undefined,
              extraPlugin: ot?.adapters?.['extra-plugin'] !== undefined,
            };
          });
          return adapters.e2eTest && adapters.extraPlugin;
        },
        15_000,
        500,
        'both e2e-test and extra-plugin adapters to be present',
      );

      // Verify both adapters are independently present
      const adapters = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return Object.keys(ot?.adapters ?? {}).sort();
      });
      expect(adapters).toContain('e2e-test');
      expect(adapters).toContain('extra-plugin');

      // e2e-test tool dispatch still works with two adapters injected
      const afterResult = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'with-two-plugins',
      });
      expect(afterResult.message).toBe('with-two-plugins');

      await page.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  );

  fixtureTest(
    'two plugins with different URL patterns both inject into a single matching tab',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      // Standard setup: wait for extension, open tab, verify e2e-test tool works
      const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

      // Baseline: e2e-test adapter is present and tool dispatch works
      const baseline = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'before-different-pattern-plugin',
      });
      expect(baseline.message).toBe('before-different-pattern-plugin');

      // Create a second plugin with a DIFFERENT URL pattern (*://localhost/*)
      // that still matches the test server URL (http://localhost:<port>/)
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-diff-pattern-'));
      const extraPluginDir = createMinimalPlugin(
        tmpDir,
        'diff-pattern-plugin',
        [{ name: 'noop', description: 'No-op tool for testing' }],
        ['*://localhost/*'],
      );

      // Add the second plugin to the config and enable its tool
      const config = readTestConfig(mcpServer.configDir);
      config.localPlugins.push(extraPluginDir);
      config.tools['diff-pattern-plugin_noop'] = true;
      writeTestConfig(mcpServer.configDir, config);

      // Trigger hot reload — server discovers both plugins, sends sync.full
      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();

      await waitForLog(mcpServer, 'Hot reload complete', 20_000);
      await waitForLog(mcpServer, 'tab.syncAll received', 20_000);

      // Wait for diff-pattern-plugin tools to appear in the MCP tool list
      await waitForToolList(
        mcpClient,
        list => list.some(t => t.name === 'diff-pattern-plugin_noop'),
        10_000,
        300,
        'diff-pattern-plugin_noop to appear in tool list',
      );

      // Wait for both adapters to be present in the page
      await waitFor(
        async () => {
          const adapters = await page.evaluate(() => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | { adapters?: Record<string, unknown> }
              | undefined;
            return {
              e2eTest: ot?.adapters?.['e2e-test'] !== undefined,
              diffPattern: ot?.adapters?.['diff-pattern-plugin'] !== undefined,
            };
          });
          return adapters.e2eTest && adapters.diffPattern;
        },
        15_000,
        500,
        'both e2e-test and diff-pattern-plugin adapters to be present',
      );

      // Verify both adapters are independently present
      const adapters = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return Object.keys(ot?.adapters ?? {}).sort();
      });
      expect(adapters).toContain('e2e-test');
      expect(adapters).toContain('diff-pattern-plugin');

      // e2e-test tool dispatch still works with two adapters injected
      const afterResult = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'with-different-pattern-plugins',
      });
      expect(afterResult.message).toBe('with-different-pattern-plugins');

      await page.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  );
});

// ---------------------------------------------------------------------------
// plugin.update during active tool dispatch — verifies an in-flight tool call
// completes successfully when a file watcher IIFE change triggers re-injection
// mid-execution, and subsequent calls use the new adapter.
// ---------------------------------------------------------------------------

test.describe('IIFE injection — plugin.update during active tool dispatch', () => {
  test('in-flight tool call completes after plugin.update re-injection, subsequent calls use new adapter', async () => {
    const ctx = await setupIsolatedIifeTest('iife-inflight');

    try {
      const page = await openTestAppTab(ctx.context, ctx.testServer.url, ctx.server, ctx.testServer);
      await waitForToolResult(ctx.client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Baseline: tool works normally
      const baseline = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'baseline',
      });
      expect(baseline.message).toBe('baseline');

      // Set the test server to slow mode (3 second delay)
      await ctx.testServer.setSlow(3_000);

      // Start a slow tool call — takes ~3 seconds
      const slowCallPromise = ctx.client.callTool('e2e-test_echo', { message: 'in-flight' });

      // Wait for the request to reach the test server
      await new Promise(r => setTimeout(r, 500));

      // Modify the IIFE to add a marker property (same pattern as re-injection test)
      const iifePath = path.join(ctx.pluginDir, 'dist', 'adapter.iife.js');
      const originalIife = fs.readFileSync(iifePath, 'utf-8');
      const markerCode = [
        '',
        '// Injected by E2E test to verify re-injection during in-flight dispatch',
        'globalThis.__e2eReinjectMarker = true;',
      ].join('\n');
      const modifiedIife = originalIife.replace(/}\)\(\);[\s]*$/, `${markerCode}\n})();\n`);
      fs.writeFileSync(iifePath, modifiedIife, 'utf-8');

      // File watcher detects the change and sends plugin.update → force re-injection
      await waitForLog(ctx.server, 'IIFE updated for', 15_000);

      // The slow call should still complete successfully (in-flight dispatch is not
      // interrupted by re-injection — the script is already executing in the tab)
      const slowResult = await slowCallPromise;
      expect(slowResult.isError).toBe(false);
      const slowOutput = JSON.parse(slowResult.content) as Record<string, unknown>;
      expect(slowOutput.message).toBe('in-flight');

      // Wait for the marker to appear in the page (proves re-injection happened)
      await waitFor(
        async () => {
          const marker = await page.evaluate(
            () => (globalThis as Record<string, unknown>).__e2eReinjectMarker === true,
          );
          return marker;
        },
        15_000,
        500,
        '__e2eReinjectMarker to be true after re-injection during in-flight dispatch',
      );

      // Reset slow mode and verify subsequent tool calls use the new adapter
      await ctx.testServer.setSlow(0);
      const afterResult = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'after-update',
      });
      expect(afterResult.message).toBe('after-update');

      await page.close();
    } finally {
      await ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// teardown() lifecycle hook — verifies the old adapter's teardown() is called
// during re-injection, and the new adapter clears the transient marker on load.
// ---------------------------------------------------------------------------

test.describe('IIFE injection — teardown() lifecycle hook', () => {
  test('re-injection calls teardown() on old adapter, new adapter clears transient marker', async () => {
    const ctx = await setupIsolatedIifeTest('iife-teardown');

    try {
      const page = await openTestAppTab(ctx.context, ctx.testServer.url, ctx.server, ctx.testServer);
      await waitForToolResult(ctx.client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Baseline: tool works
      const baseline = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'before-teardown-test',
      });
      expect(baseline.message).toBe('before-teardown-test');

      // Constructor clears the transient marker and no teardown has been called yet,
      // so both markers should be absent after initial injection
      const markersBefore = await page.evaluate(() => {
        const g = globalThis as Record<string, unknown>;
        return {
          called: g.__opentabs_teardown_called,
          evidence: g.__opentabs_teardown_evidence,
        };
      });
      expect(markersBefore.called).toBeUndefined();
      expect(markersBefore.evidence).toBeUndefined();

      // Modify the IIFE to trigger file watcher → plugin.update → force re-injection.
      // The IIFE wrapper calls existing.teardown() (sets both markers), then creates
      // the new adapter instance (constructor clears transient marker only).
      const iifePath = path.join(ctx.pluginDir, 'dist', 'adapter.iife.js');
      const originalIife = fs.readFileSync(iifePath, 'utf-8');
      const markerCode = [
        '',
        '// Injected by E2E test to verify teardown lifecycle hook',
        'globalThis.__e2eTeardownTestMarker = true;',
      ].join('\n');
      const modifiedIife = originalIife.replace(/}\)\(\);[\s]*$/, `${markerCode}\n})();\n`);
      fs.writeFileSync(iifePath, modifiedIife, 'utf-8');

      // Wait for file watcher to detect the IIFE change and send plugin.update
      await waitForLog(ctx.server, 'IIFE updated for', 15_000);

      // Wait for re-injection to complete (new adapter has the test marker)
      await waitFor(
        async () => {
          const marker = await page.evaluate(
            () => (globalThis as Record<string, unknown>).__e2eTeardownTestMarker === true,
          );
          return marker;
        },
        15_000,
        500,
        '__e2eTeardownTestMarker to be true after re-injection',
      );

      // Verify teardown was called on the old adapter.
      // In the IIFE execution order: (1) new adapter constructor runs (clears stale
      // markers), (2) old adapter's teardown() sets markers, (3) new adapter is
      // assigned. After re-injection, both markers are true — proving teardown ran.
      const markersAfter = await page.evaluate(() => {
        const g = globalThis as Record<string, unknown>;
        return {
          called: g.__opentabs_teardown_called,
          evidence: g.__opentabs_teardown_evidence,
        };
      });

      // Both markers set by teardown() prove it was invoked during re-injection
      expect(markersAfter.called).toBe(true);
      expect(markersAfter.evidence).toBe(true);

      // Tool dispatch still works after re-injection
      const afterTeardown = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'after-teardown-test',
      });
      expect(afterTeardown.message).toBe('after-teardown-test');

      await page.close();
    } finally {
      await ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tab opened AFTER sync.full — verifies that the tabs.onUpdated listener
// injects adapters into tabs that are opened well after the initial sync.full
// processing completes.
// ---------------------------------------------------------------------------

fixtureTest.describe('IIFE injection — tab opened after sync.full', () => {
  fixtureTest(
    'adapter injects into tab opened well after sync.full',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      // Complete full setup: extension connected + sync.full processed
      await waitForExtensionConnected(mcpServer);
      await waitForLog(mcpServer, 'tab.syncAll received');
      await testServer.reset();

      // Wait 3 seconds after sync.full to ensure all initial processing is done.
      // This proves the subsequent injection comes from tabs.onUpdated, not from
      // the initial sync.full batch.
      await new Promise(r => setTimeout(r, 3_000));

      // Open a NEW tab to the test server — this tab was not open during sync.full
      const page = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

      // Verify adapter is injected in the new tab
      const adapterPresent = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterPresent).toBe(true);

      // Verify tool dispatch works on the new tab
      await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      const result = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'after-sync-full',
      });
      expect(result.message).toBe('after-sync-full');

      await page.close();
    },
  );
});

// ---------------------------------------------------------------------------
// Pre-existing tab — verifies that tabs already open when the extension
// connects receive adapter injection via reinjectStoredPlugins triggered
// by sync.full.
// ---------------------------------------------------------------------------

fixtureTest.describe('IIFE injection — pre-existing tab gets adapter', () => {
  fixtureTest(
    'pre-existing tab gets adapter after extension connects and processes sync.full',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      // Open a tab to the test server BEFORE waiting for extension connection.
      // The extension context is already launched (browser + extension loaded),
      // but the WebSocket connection to the MCP server may still be in progress.
      // This tab will already be open when sync.full fires, exercising the
      // reinjectStoredPlugins → injectPluginIntoMatchingTabs path.
      const page = await extensionContext.newPage();
      await page.goto(testServer.url, { waitUntil: 'load' });

      // Now wait for the extension to connect and sync.full to complete.
      // sync.full triggers reinjectStoredPlugins which scans all existing tabs
      // (including our pre-existing one) and injects matching adapters.
      await waitForExtensionConnected(mcpServer);
      await waitForLog(mcpServer, 'tab.syncAll received');

      // Poll for the adapter to be injected into the pre-existing tab.
      // The injection happens asynchronously after sync.full is processed.
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
        20_000,
        500,
        'e2e-test adapter to be injected into pre-existing tab',
      );

      // Verify adapter is present
      const adapterPresent = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterPresent).toBe(true);

      // Verify tool dispatch works on the pre-existing tab
      await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      const result = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'pre-existing-tab',
      });
      expect(result.message).toBe('pre-existing-tab');

      await page.close();
    },
  );
});

// ---------------------------------------------------------------------------
// IIFE-only file change — verifies handleIifeChange updates adapterHash in
// state, so the extension receives a matching hash and re-injects cleanly
// without triggering the retry path.
// ---------------------------------------------------------------------------

test.describe('IIFE injection — IIFE-only change with correct hash', () => {
  test('IIFE-only file change triggers clean re-injection without hash mismatch', async () => {
    const ctx = await setupIsolatedIifeTest('iife-only-change');

    try {
      const page = await openTestAppTab(ctx.context, ctx.testServer.url, ctx.server, ctx.testServer);
      await waitForToolResult(ctx.client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Baseline: tool works with valid adapter
      const baseline = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'before-iife-update',
      });
      expect(baseline.message).toBe('before-iife-update');

      // Modify the IIFE to append a comment (changes the hash but keeps the code valid).
      // Only the IIFE file is changed, NOT the manifest — handleIifeChange fires,
      // which updates both plugin.iife and plugin.adapterHash. sendPluginUpdate sends
      // the correct hash, so the extension re-injects cleanly without hash mismatch.
      const iifePath = path.join(ctx.pluginDir, 'dist', 'adapter.iife.js');
      const originalIife = fs.readFileSync(iifePath, 'utf-8');
      const modifiedIife = originalIife + '\n// E2E test: IIFE-only change trigger\n';
      ctx.server.logs.length = 0;
      fs.writeFileSync(iifePath, modifiedIife, 'utf-8');

      // Wait for the file watcher to detect the IIFE change and send plugin.update
      await waitForLog(ctx.server, 'IIFE updated for', 15_000);

      // Wait for re-injection to complete (adapter is still functional in the page)
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
        'adapter e2e-test to be present after IIFE re-injection',
      );

      // Verify the extension is still connected after re-injection
      const health = await ctx.server.health();
      expect(health).not.toBeNull();
      if (!health) throw new Error('health returned null');
      expect(health.status).toBe('ok');
      expect(health.extensionConnected).toBe(true);

      // Tool dispatch still works after IIFE re-injection
      const afterResult = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'after-iife-update',
      });
      expect(afterResult.message).toBe('after-iife-update');

      await page.close();
    } finally {
      await ctx.cleanup();
    }
  });
});

test.describe('IIFE injection — concurrent file watcher change during hot reload', () => {
  test('file watcher change during hot reload does not corrupt tool state', async () => {
    const ctx = await setupIsolatedIifeTest('iife-concurrent');

    try {
      const page = await openTestAppTab(ctx.context, ctx.testServer.url, ctx.server, ctx.testServer);
      await waitForToolResult(ctx.client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Baseline: tool works and all expected tools are present
      const baseline = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'before-concurrent',
      });
      expect(baseline.message).toBe('before-concurrent');

      const toolsBefore = await ctx.client.listTools();
      const e2eToolsBefore = toolsBefore.filter(t => t.name.startsWith('e2e-test_'));
      expect(e2eToolsBefore.length).toBeGreaterThan(0);

      // Modify the IIFE on disk — this triggers the file watcher debounce timer
      const iifePath = path.join(ctx.pluginDir, 'dist', 'adapter.iife.js');
      const originalIife = fs.readFileSync(iifePath, 'utf-8');
      const modifiedIife = originalIife + '\n// E2E test: concurrent change trigger\n';

      // Clear logs to detect fresh events
      ctx.server.logs.length = 0;

      // Simultaneously: (a) write the modified IIFE and (b) trigger hot reload.
      // This exercises the race condition where a file watcher callback fires
      // during hot reload module re-evaluation. The generation counter should
      // prevent the stale file watcher callback from executing, while the hot
      // reload's discoverPlugins re-reads the modified IIFE from disk.
      fs.writeFileSync(iifePath, modifiedIife, 'utf-8');
      ctx.server.triggerHotReload();

      // Wait for hot reload to complete — this confirms the server survived
      // the concurrent file change + hot reload without crashing
      await waitForLog(ctx.server, 'Hot reload complete', 30_000);

      // Wait for all expected tools to be present in tools/list after hot reload.
      // This is the key corruption check — if the concurrent change corrupted
      // the tool state, some tools would be missing or duplicated.
      await waitForToolList(
        ctx.client,
        list => {
          const e2eTools = list.filter(t => t.name.startsWith('e2e-test_'));
          return e2eTools.length === e2eToolsBefore.length;
        },
        15_000,
        300,
        'all e2e-test tools to be present after concurrent hot reload + IIFE change',
      );

      // Verify the exact set of tools matches what we had before
      const toolsAfter = await ctx.client.listTools();
      const e2eToolsAfter = toolsAfter.filter(t => t.name.startsWith('e2e-test_'));
      const namesBefore = e2eToolsBefore.map(t => t.name).sort();
      const namesAfter = e2eToolsAfter.map(t => t.name).sort();
      expect(namesAfter).toEqual(namesBefore);

      // Wait for extension to re-sync after hot reload (sync.full → tab.syncAll)
      await waitForLog(ctx.server, 'tab.syncAll received', 20_000);

      // Verify adapter is present in the page after re-sync
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
        'adapter e2e-test to be present after concurrent hot reload + IIFE change',
      );

      // Verify tool dispatch works after the concurrent change
      const afterResult = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'after-concurrent',
      });
      expect(afterResult.message).toBe('after-concurrent');

      // Verify server health is ok and extension is connected
      const health = await ctx.server.health();
      expect(health).not.toBeNull();
      if (!health) throw new Error('health returned null');
      expect(health.status).toBe('ok');
      expect(health.extensionConnected).toBe(true);

      await page.close();
    } finally {
      await ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tab navigation — verifies adapter injection handles navigation between
// matching and non-matching URLs correctly: injecting on arrival, clearing
// on departure (page context reset), and re-injecting on return.
// ---------------------------------------------------------------------------

test.describe('IIFE injection — tab navigation between matching and non-matching URLs', () => {
  test('adapter injects when navigating from about:blank to matching URL', async () => {
    const ctx = await setupIsolatedIifeTest('nav-to-match');

    try {
      // Open a tab to about:blank — no adapter should be injected
      const page = await ctx.context.newPage();
      await page.goto('about:blank', { waitUntil: 'load' });

      // Verify adapter is NOT present on about:blank
      const adapterOnBlank = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterOnBlank).toBe(false);

      // Navigate to the matching test server URL
      await page.goto(ctx.testServer.url, { waitUntil: 'load' });

      // Wait for adapter injection via tabs.onUpdated
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
        20_000,
        500,
        'e2e-test adapter to be injected after navigating to matching URL',
      );

      // Verify tool dispatch works on the navigated tab
      const result = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'navigated-to-match',
      });
      expect(result.message).toBe('navigated-to-match');

      await page.close();
    } finally {
      await ctx.cleanup();
    }
  });

  test('adapter is gone after navigating away, re-injects when navigating back', async () => {
    const ctx = await setupIsolatedIifeTest('nav-away-back');

    try {
      // Open tab to matching URL and wait for adapter injection
      const page = await openTestAppTab(ctx.context, ctx.testServer.url, ctx.server, ctx.testServer);
      await waitForToolResult(ctx.client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Baseline: adapter is present and tool works
      const baseline = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'before-nav-away',
      });
      expect(baseline.message).toBe('before-nav-away');

      // Navigate away to about:blank — page context resets, adapter is gone
      await page.goto('about:blank', { waitUntil: 'load' });

      // Verify adapter is gone (page context reset by navigation)
      const adapterGone = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] === undefined;
      });
      expect(adapterGone).toBe(true);

      // Navigate back to the matching URL
      await page.goto(ctx.testServer.url, { waitUntil: 'load' });

      // Wait for adapter re-injection via tabs.onUpdated
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
        20_000,
        500,
        'e2e-test adapter to be re-injected after navigating back to matching URL',
      );

      // Verify tool dispatch works after re-injection
      const afterResult = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'after-nav-back',
      });
      expect(afterResult.message).toBe('after-nav-back');

      await page.close();
    } finally {
      await ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Multiple tabs matching the same plugin — verifies adapter injection and
// tool dispatch work correctly when multiple tabs match the same plugin's
// URL patterns. Tests cover: both tabs get adapter, dispatch with two tabs,
// close one tab (dispatch via remaining), close all tabs (dispatch returns error).
// ---------------------------------------------------------------------------

fixtureTest.describe('IIFE injection — multiple tabs matching same plugin', () => {
  fixtureTest(
    'two tabs matching the same plugin both get the adapter injected',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      // Open tab A and wait for adapter injection + tool dispatch
      const pageA = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

      // Verify adapter is present in tab A
      const adapterInA = await pageA.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterInA).toBe(true);

      // Open tab B to the same test server URL
      const pageB = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

      // Verify adapter is present in tab B
      const adapterInB = await pageB.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      expect(adapterInB).toBe(true);

      await pageB.close();
      await pageA.close();
    },
  );

  fixtureTest(
    'tool dispatch returns a valid result with two matching tabs open',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      const pageA = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);
      const pageB = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

      // Verify adapter injected in both tabs
      await waitFor(
        async () => {
          const inB = await pageB.evaluate(() => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | { adapters?: Record<string, unknown> }
              | undefined;
            return ot?.adapters?.['e2e-test'] !== undefined;
          });
          return inB;
        },
        15_000,
        500,
        'adapter to be injected in tab B',
      );

      // Tool dispatch works with two matching tabs open
      const result = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'two-tabs-open',
      });
      expect(result.message).toBe('two-tabs-open');

      await pageB.close();
      await pageA.close();
    },
  );

  fixtureTest(
    'closing one matching tab still allows tool dispatch via the remaining tab',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      const pageA = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);
      const pageB = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

      // Verify adapter in tab B
      await waitFor(
        async () => {
          const inB = await pageB.evaluate(() => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | { adapters?: Record<string, unknown> }
              | undefined;
            return ot?.adapters?.['e2e-test'] !== undefined;
          });
          return inB;
        },
        15_000,
        500,
        'adapter to be injected in tab B',
      );

      // Baseline: tool works with both tabs
      const baseline = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'before-close',
      });
      expect(baseline.message).toBe('before-close');

      // Close tab A — tab B remains
      await pageA.close();

      // Tool dispatch should still work via tab B. Poll because the extension
      // needs to process the tab removal and update its internal tab tracking.
      const afterClose = await waitForToolResult(
        mcpClient,
        'e2e-test_echo',
        { message: 'after-close-one' },
        { isError: false },
        15_000,
      );
      const afterResult = JSON.parse(afterClose.content) as Record<string, unknown>;
      expect(afterResult.message).toBe('after-close-one');

      await pageB.close();
    },
  );

  fixtureTest(
    'closing all matching tabs causes tool dispatch to return error with closed state',
    async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
      const pageA = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);
      const pageB = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

      // Verify adapter in tab B
      await waitFor(
        async () => {
          const inB = await pageB.evaluate(() => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | { adapters?: Record<string, unknown> }
              | undefined;
            return ot?.adapters?.['e2e-test'] !== undefined;
          });
          return inB;
        },
        15_000,
        500,
        'adapter to be injected in tab B',
      );

      // Baseline: tool works
      const baseline = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
        message: 'before-close-all',
      });
      expect(baseline.message).toBe('before-close-all');

      // Close both tabs
      await pageA.close();
      await pageB.close();

      // Tool dispatch should return an error indicating the plugin tab is closed.
      // Poll because the extension needs to process both tab closures.
      const errorResult = await waitForToolResult(
        mcpClient,
        'e2e-test_echo',
        { message: 'after-close-all' },
        { isError: true },
        15_000,
      );
      expect(errorResult.isError).toBe(true);
      expect(errorResult.content.toLowerCase()).toContain('closed');
    },
  );
});

// ---------------------------------------------------------------------------
// Corrupted adapter IIFE — verifies the system handles a syntactically invalid
// IIFE gracefully (no extension crash, clean recovery when valid IIFE restored).
// ---------------------------------------------------------------------------

test.describe('IIFE injection — corrupted adapter IIFE', () => {
  test('invalid IIFE does not crash extension, recovery works after valid IIFE restored', async () => {
    const ctx = await setupIsolatedIifeTest('iife-corrupt');

    try {
      const page = await openTestAppTab(ctx.context, ctx.testServer.url, ctx.server, ctx.testServer);
      await waitForToolResult(ctx.client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Baseline: tool works
      const baseline = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'before-corrupt',
      });
      expect(baseline.message).toBe('before-corrupt');

      // Save the valid IIFE for later restoration
      const iifePath = path.join(ctx.pluginDir, 'dist', 'adapter.iife.js');
      const validIife = fs.readFileSync(iifePath, 'utf-8');

      // Write syntactically invalid JavaScript to the IIFE
      ctx.server.logs.length = 0;
      fs.writeFileSync(iifePath, 'THIS IS NOT VALID JAVASCRIPT {{{ !!!', 'utf-8');

      // Wait for file watcher to detect and send plugin.update
      await waitForLog(ctx.server, 'IIFE updated for', 15_000);

      // Server should still be alive and healthy
      const health = await ctx.server.health();
      expect(health).not.toBeNull();
      if (!health) throw new Error('health returned null');
      expect(health.status).toBe('ok');
      expect(health.extensionConnected).toBe(true);

      // Browser tools should still work (they bypass plugin adapters)
      const browserResult = await ctx.client.callTool('browser_list_tabs');
      expect(browserResult.isError).toBe(false);

      // Restore the valid IIFE — system should recover
      ctx.server.logs.length = 0;
      fs.writeFileSync(iifePath, validIife, 'utf-8');

      // Wait for file watcher to detect the restored IIFE
      await waitForLog(ctx.server, 'IIFE updated for', 15_000);

      // Wait for re-injection to succeed (adapter is restored in the page)
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
        'adapter to be present after valid IIFE restored',
      );

      // Plugin tool should work again after recovery
      const recovered = await waitForToolResult(
        ctx.client,
        'e2e-test_echo',
        { message: 'after-recovery' },
        { isError: false },
        15_000,
      );
      const recoveredOutput = parseToolResult(recovered.content);
      expect(recoveredOutput.message).toBe('after-recovery');

      await page.close();
    } finally {
      await ctx.cleanup();
    }
  });
});
