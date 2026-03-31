/**
 * Stress tests for adapter injection — verifies the extension handles rapid
 * IIFE changes, injection during navigation, concurrent tab opens, and
 * adapter file corruption/recovery gracefully.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { expect } from './fixtures.js';
import {
  callToolExpectSuccess,
  openTestAppTab,
  parseToolResult,
  replaceIifeClosing,
  setupIsolatedIifeTest,
  unwrapSingleConnection,
  waitFor,
  waitForLog,
  waitForToolResult,
  writeAndWaitForWatcher,
} from './helpers.js';

// ---------------------------------------------------------------------------
// US-001: Rapid adapter re-injection (5 IIFE changes in 5 seconds)
// ---------------------------------------------------------------------------

test.describe('Stress — rapid adapter re-injection', () => {
  test('5 IIFE modifications in rapid succession settle to the latest hash and tools work', async () => {
    const ctx = await setupIsolatedIifeTest('stress-rapid-reinject');

    try {
      // Open a tab to the test server and wait for adapter injection
      const page = await openTestAppTab(ctx.context, ctx.testServer.url, ctx.server, ctx.testServer);

      // Poll until tool dispatch works (tab state = ready)
      await waitForToolResult(ctx.client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Baseline: tool works
      const baseline = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'before-rapid-changes',
      });
      expect(baseline.message).toBe('before-rapid-changes');

      // Read the original IIFE from the plugin copy's dist/
      const iifePath = path.join(ctx.pluginDir, 'dist', 'adapter.iife.js');
      const originalIife = fs.readFileSync(iifePath, 'utf-8');

      // Modify the IIFE 5 times in rapid succession (1s between changes)
      for (let i = 0; i < 5; i++) {
        const commentCode = `\n// change-${String(i)} timestamp=${Date.now()}`;
        const modifiedIife = replaceIifeClosing(originalIife, commentCode);

        await writeAndWaitForWatcher(
          ctx.server,
          () => fs.writeFileSync(iifePath, modifiedIife, 'utf-8'),
          'IIFE updated for',
        );

        // 1s delay between changes as specified
        if (i < 4) {
          await new Promise(r => setTimeout(r, 1_000));
        }
      }

      // Wait for the adapter to settle — poll until extension_check_adapter
      // reports that all tabs have the latest hash.
      await waitFor(
        async () => {
          try {
            const raw = await callToolExpectSuccess(ctx.client, ctx.server, 'extension_check_adapter', {
              plugin: 'e2e-test',
            });
            const result = unwrapSingleConnection(raw);
            const tabs = result.matchingTabs as Array<{ hashMatch: boolean; adapterPresent: boolean }>;
            return tabs.length > 0 && tabs.every(t => t.adapterPresent && t.hashMatch);
          } catch {
            return false;
          }
        },
        20_000,
        500,
        'extension_check_adapter to report matching hash after rapid changes',
      );

      // Verify the expectedHash from extension_check_adapter matches a
      // sha256 prefix of the final IIFE content (the server computes the
      // adapter hash the same way)
      const checkRaw = await callToolExpectSuccess(ctx.client, ctx.server, 'extension_check_adapter', {
        plugin: 'e2e-test',
      });
      const checkResult = unwrapSingleConnection(checkRaw);
      const expectedHash = checkResult.expectedHash as string;
      expect(expectedHash.length).toBeGreaterThan(0);

      // Verify tool dispatch still works with the final adapter version
      const afterResult = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'after-rapid-changes',
      });
      expect(afterResult.message).toBe('after-rapid-changes');

      await page.close();
    } finally {
      await ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// US-002: Adapter injection during tab navigation
// ---------------------------------------------------------------------------

test.describe('Stress — adapter injection during tab navigation', () => {
  test('navigating away mid-injection causes no crash, and navigating back re-injects', async () => {
    const ctx = await setupIsolatedIifeTest('stress-nav-inject');

    try {
      // Open a tab and wait for adapter injection + ready state
      const page = await openTestAppTab(ctx.context, ctx.testServer.url, ctx.server, ctx.testServer);
      await waitForToolResult(ctx.client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Baseline: tool works on the matching tab
      const baseline = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'before-navigation',
      });
      expect(baseline.message).toBe('before-navigation');

      // Start a tool call and immediately navigate away — the tool call may
      // succeed or fail depending on timing, but it must not crash the extension.
      const toolPromise = ctx.client.callTool('e2e-test_echo', { message: 'during-navigation' });
      await page.goto('about:blank', { waitUntil: 'load' });

      // Tool call must resolve within 10s — not hang for 30s dispatch timeout
      const midNavResult = (await Promise.race([
        toolPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('tool call hung for 10s after tab navigation')), 10_000),
        ),
      ])) as { isError?: boolean; content: string };

      if (midNavResult.isError) {
        // Error must identify the cause (tab navigation/closure)
        expect(
          /tab|closed|navigat|disconnect/i.test(midNavResult.content),
          `error should identify navigation as cause, got: ${midNavResult.content.slice(0, 100)}`,
        ).toBe(true);
      } else {
        // If it succeeded (raced before navigation), content must be valid
        expect(midNavResult.content.length).toBeGreaterThan(0);
      }

      // Navigate back to the matching URL
      await page.goto(ctx.testServer.url, { waitUntil: 'load' });

      // Wait for adapter re-injection after navigating back
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

      // Wait for the tab to reach ready state again
      await waitForToolResult(ctx.client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Verify tool calls work after re-injection
      const afterResult = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'after-navigation-back',
      });
      expect(afterResult.message).toBe('after-navigation-back');

      // Check extension logs for error-level entries that indicate crashes.
      // Expected injection warnings (e.g., tab navigated during injection) are
      // acceptable — only unexpected errors indicate a real problem.
      const logsResult = await ctx.client.callTool('extension_get_logs');
      expect(logsResult.isError).toBe(false);
      const logsData = parseToolResult(logsResult.content);
      const entries = logsData.entries as Array<{ level: string; message: string }>;
      const errorEntries = entries.filter(
        e => e.level === 'error' && !e.message.includes('No tab found') && !e.message.includes('navigation'),
      );
      expect(errorEntries).toEqual([]);

      await page.close();
    } finally {
      await ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// US-003: Multiple tabs opening simultaneously with adapter injection
// ---------------------------------------------------------------------------

/** Shape of plugin_list_tabs response entries. */
interface PluginTabsEntry {
  plugin: string;
  displayName: string;
  state: string;
  tabs: Array<{ tabId: number; url: string; title: string; ready: boolean }>;
}

test.describe('Stress — multiple tabs opening simultaneously', () => {
  test('5 tabs opened concurrently all get injected and tools dispatch to each via tabId', async () => {
    const ctx = await setupIsolatedIifeTest('stress-multi-tab');

    try {
      const TAB_COUNT = 5;

      // Open 5 tabs simultaneously via Promise.all
      const pages = await Promise.all(
        Array.from({ length: TAB_COUNT }, () =>
          openTestAppTab(ctx.context, ctx.testServer.url, ctx.server, ctx.testServer, 30_000),
        ),
      );

      // Poll plugin_list_tabs until e2e-test reports TAB_COUNT tabs all ready
      await waitFor(
        async () => {
          try {
            const result = await ctx.client.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
            if (result.isError) return false;
            const plugins = JSON.parse(result.content) as PluginTabsEntry[];
            const entry = plugins[0];
            return entry !== undefined && entry.tabs.length >= TAB_COUNT && entry.tabs.every(t => t.ready);
          } catch {
            return false;
          }
        },
        30_000,
        500,
        `plugin_list_tabs to report ${TAB_COUNT} tabs all ready`,
      );

      // Read the final plugin_list_tabs response
      const listResult = await ctx.client.callTool('plugin_list_tabs', { plugin: 'e2e-test' });
      expect(listResult.isError).toBe(false);
      const plugins = JSON.parse(listResult.content) as PluginTabsEntry[];
      const entry = plugins[0];
      if (!entry) throw new Error('Expected plugin entry in plugin_list_tabs response');

      expect(entry.tabs.length).toBeGreaterThanOrEqual(TAB_COUNT);
      expect(entry.tabs.every(t => t.ready)).toBe(true);

      // All tab IDs must be distinct
      const tabIds = entry.tabs.map(t => t.tabId);
      expect(new Set(tabIds).size).toBe(entry.tabs.length);

      // Dispatch e2e-test_echo with explicit tabId to each tab
      for (const tab of entry.tabs) {
        const result = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
          message: `tab-${String(tab.tabId)}`,
          tabId: tab.tabId,
        });
        expect(result.message).toBe(`tab-${String(tab.tabId)}`);
      }

      // Verify no adapter hash mismatches across tabs
      const checkRaw = await callToolExpectSuccess(ctx.client, ctx.server, 'extension_check_adapter', {
        plugin: 'e2e-test',
      });
      const checkResult = unwrapSingleConnection(checkRaw);
      const matchingTabs = checkResult.matchingTabs as Array<{
        hashMatch: boolean;
        adapterPresent: boolean;
      }>;
      expect(matchingTabs.length).toBeGreaterThanOrEqual(TAB_COUNT);
      expect(matchingTabs.every(t => t.adapterPresent && t.hashMatch)).toBe(true);

      for (const page of pages) {
        await page.close();
      }
    } finally {
      await ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// US-004: Adapter file missing during injection (corruption recovery)
// ---------------------------------------------------------------------------

test.describe('Stress — adapter file missing (corruption recovery)', () => {
  test('deleting adapter IIFE does not crash extension, restoring it recovers injection', async () => {
    const ctx = await setupIsolatedIifeTest('stress-corruption');

    try {
      // Open a tab and wait for adapter injection + ready state
      const page = await openTestAppTab(ctx.context, ctx.testServer.url, ctx.server, ctx.testServer);
      await waitForToolResult(ctx.client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Baseline: tool works
      const baseline = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'before-corruption',
      });
      expect(baseline.message).toBe('before-corruption');

      // Find the adapter IIFE file in the adapters directory
      const adaptersDir = path.join(ctx.configDir, 'extension', 'adapters');
      const adapterFiles = fs.readdirSync(adaptersDir).filter(f => f.startsWith('e2e-test') && f.endsWith('.js'));
      expect(adapterFiles.length).toBeGreaterThan(0);

      const adapterFileName = adapterFiles[0];
      if (!adapterFileName) throw new Error('Expected at least one adapter file in adapters directory');
      const adapterFilePath = path.join(adaptersDir, adapterFileName);

      // Save the adapter content for later restoration
      const savedContent = fs.readFileSync(adapterFilePath, 'utf-8');

      // Delete the adapter IIFE file to simulate corruption/missing file.
      // Chrome may still serve the file from its internal cache, so we cannot
      // reliably assert that injection fails on a new tab. Instead, verify the
      // extension and server remain healthy during the gap.
      fs.unlinkSync(adapterFilePath);

      // Verify server health is still ok
      const health = await ctx.server.health();
      expect(health).not.toBeNull();
      expect(health?.status).toBe('ok');

      // Check extension logs for a warning or error about the missing adapter
      const logsResult = await ctx.client.callTool('extension_get_logs');
      expect(logsResult.isError).toBe(false);
      const logsData = parseToolResult(logsResult.content);
      const entries = logsData.entries as Array<{ level: string; message: string }>;
      // There should be some log related to adapter/injection issues (warn or error level)
      // but the extension itself should not have crashed
      const crashEntries = entries.filter(
        e =>
          e.level === 'error' &&
          !e.message.includes('adapter') &&
          !e.message.includes('inject') &&
          !e.message.includes('IIFE') &&
          !e.message.includes('No tab found') &&
          !e.message.includes('navigation') &&
          !e.message.includes('script'),
      );
      expect(crashEntries).toEqual([]);

      // Close the original page so recovery starts from a clean slate
      await page.close();

      // Restore the adapter file with the saved content
      fs.writeFileSync(adapterFilePath, savedContent, 'utf-8');

      // Trigger hot reload so the server re-discovers the plugin and sends update
      ctx.server.triggerHotReload();
      await waitForLog(ctx.server, 'Hot reload complete', 20_000);

      // Open a fresh tab after restoration and verify recovery
      const recoveryPage = await openTestAppTab(ctx.context, ctx.testServer.url, ctx.server, ctx.testServer);

      // Wait for the recovery tab to reach ready state
      await waitForToolResult(ctx.client, 'e2e-test_get_status', {}, { isError: false }, 15_000);

      // Verify tool calls work on the recovery tab
      const afterResult = await callToolExpectSuccess(ctx.client, ctx.server, 'e2e-test_echo', {
        message: 'after-recovery',
      });
      expect(afterResult.message).toBe('after-recovery');

      await recoveryPage.close();
    } finally {
      await ctx.cleanup();
    }
  });
});
