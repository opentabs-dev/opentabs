/**
 * Adapter hash E2E tests — verifies:
 *   1. Hash-based skip: adapter re-injection is skipped on sync.full (reconnect)
 *      when the adapter hash matches the one already in the tab.
 *   2. extension.checkAdapter reports accurate hash and readiness information.
 *
 * These tests exercise the full dispatch stack: MCP server → WebSocket →
 * Chrome extension background → content script injection (or skip).
 */

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures.js';
import {
  callToolExpectSuccess,
  setupToolTest,
  unwrapSingleConnection,
  waitFor,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Hash-based skip on reconnect
// ---------------------------------------------------------------------------

test.describe('Adapter hash', () => {
  test('adapter re-injection is skipped on hot reload when hash matches', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify onActivate fired on initial injection
    const activated = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_onActivate_called);
    expect(activated).toBe(true);

    // Clear the onActivate flag. If the adapter is re-injected, onActivate
    // will be set to true again by the new adapter instance.
    await page.evaluate(() => {
      delete (globalThis as Record<string, unknown>).__opentabs_onActivate_called;
    });

    // Also clear onDeactivate — if injection is skipped, neither hook fires
    await page.evaluate(() => {
      delete (globalThis as Record<string, unknown>).__opentabs_onDeactivate_called;
    });

    // Trigger a hot reload — this causes the MCP server to restart its worker
    // and send a new sync.full to the extension. Since the adapter IIFE hasn't
    // changed, the hash matches and injection should be skipped entirely.
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();

    // Wait for the sync.full to be received and processed
    await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);

    // Give the extension time to process the sync.full and (not) re-inject.
    // The hash check happens synchronously during the injection pipeline,
    // so by the time tab.syncAll fires, the skip decision is already made.
    // We wait a short period to ensure no async re-injection is in flight.
    await waitFor(
      async () => {
        // Verify the adapter is still present (not removed during sync)
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

    // The key assertion: onActivate should NOT have been called again.
    // If the adapter was re-injected, the new instance's onActivate would
    // have set this flag to true.
    const reActivated = await page.evaluate(() => (globalThis as Record<string, unknown>).__opentabs_onActivate_called);
    expect(reActivated).toBeUndefined();

    // onDeactivate should also NOT have been called — no teardown happened
    const deactivated = await page.evaluate(
      () => (globalThis as Record<string, unknown>).__opentabs_onDeactivate_called,
    );
    expect(deactivated).toBeUndefined();

    // Verify tools still work after the hash-skipped reconnect
    await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'after-skip' }, { isError: false }, 15_000);
  });

  test('tools work after multiple consecutive hash-skipped reconnects', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Trigger three consecutive hot reloads — each should skip re-injection
    for (let i = 0; i < 3; i++) {
      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();
      await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);
    }

    // After three skipped reconnects, the adapter and tools should still work
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
      'e2e-test adapter to remain present after multiple hot reloads',
    );

    await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'after-triple-skip' }, { isError: false }, 15_000);
  });

  // ---------------------------------------------------------------------------
  // extension.checkAdapter
  // ---------------------------------------------------------------------------

  test('extension_check_adapter reports correct hash and readiness', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Call extension_check_adapter for the e2e-test plugin
    const resultRaw = await callToolExpectSuccess(mcpClient, mcpServer, 'extension_check_adapter', {
      plugin: 'e2e-test',
    });
    const result = unwrapSingleConnection(resultRaw);

    // Top-level fields
    expect(result.plugin).toBe('e2e-test');
    expect(result.expectedHash).toEqual(expect.any(String));
    expect((result.expectedHash as string).length).toBeGreaterThan(0);

    // There should be at least one matching tab
    const tabs = result.matchingTabs as Array<{
      tabId: number;
      tabUrl: string;
      adapterPresent: boolean;
      adapterHash: string | null;
      hashMatch: boolean;
      isReady: boolean;
      toolCount: number;
      toolNames: string[];
    }>;
    expect(tabs.length).toBeGreaterThanOrEqual(1);

    const tab = tabs[0];
    if (!tab) throw new Error('Expected at least one matching tab');
    expect(tab.adapterPresent).toBe(true);
    expect(tab.adapterHash).toEqual(expect.any(String));
    expect((tab.adapterHash as string).length).toBeGreaterThan(0);
    expect(tab.hashMatch).toBe(true);
    expect(tab.isReady).toBe(true);
    expect(tab.toolCount).toBeGreaterThan(0);
    expect(tab.toolNames).toEqual(expect.arrayContaining(['echo', 'get_status']));
  });

  test('extension_check_adapter hash matches after hash-skipped reconnect', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Trigger a hot reload (sync.full with same hash → skip re-injection)
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();
    await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);

    // Wait for tool dispatch to be operational after the reconnect
    await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

    // Verify checkAdapter still reports correct state after the skipped reconnect
    const resultRaw = await callToolExpectSuccess(mcpClient, mcpServer, 'extension_check_adapter', {
      plugin: 'e2e-test',
    });
    const result = unwrapSingleConnection(resultRaw);

    const tabs = result.matchingTabs as Array<{
      adapterPresent: boolean;
      adapterHash: string | null;
      hashMatch: boolean;
      isReady: boolean;
    }>;
    expect(tabs.length).toBeGreaterThanOrEqual(1);

    const tab = tabs[0];
    if (!tab) throw new Error('Expected at least one matching tab');
    expect(tab.adapterPresent).toBe(true);
    expect(tab.hashMatch).toBe(true);
    expect(tab.isReady).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Disk hash ground truth after reconnects
  // ---------------------------------------------------------------------------

  test('adapter hash matches disk file after 3 consecutive reconnects', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Trigger 3 consecutive hot reloads
    for (let i = 0; i < 3; i++) {
      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();
      await waitForLog(mcpServer, 'plugin(s) mapped', 20_000);
    }

    // Wait for tool dispatch to be operational after the reconnects
    await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

    // Get the hash reported by extension_check_adapter
    const resultRaw = await callToolExpectSuccess(mcpClient, mcpServer, 'extension_check_adapter', {
      plugin: 'e2e-test',
    });
    const result = unwrapSingleConnection(resultRaw);

    const tabs = result.matchingTabs as Array<{
      adapterPresent: boolean;
      adapterHash: string | null;
      hashMatch: boolean;
      isReady: boolean;
    }>;
    expect(tabs.length).toBeGreaterThanOrEqual(1);

    const tab = tabs[0];
    if (!tab) throw new Error('Expected at least one matching tab');
    expect(tab.hashMatch).toBe(true);
    expect(tab.adapterHash).toEqual(expect.any(String));

    const reportedHash = result.expectedHash as string;
    expect(reportedHash.length).toBe(64);

    // Read the adapter file from disk and extract the embedded hash
    const adaptersDir = path.join(mcpServer.configDir, 'extension', 'adapters');
    const entries = fs.readdirSync(adaptersDir);
    const adapterFiles = entries.filter(f => /^e2e-test-[0-9a-f]{8}\.js$/.test(f));
    expect(adapterFiles.length).toBe(1);

    const adapterFile = adapterFiles[0];
    if (!adapterFile) throw new Error('Expected exactly one e2e-test adapter file');
    const content = fs.readFileSync(path.join(adaptersDir, adapterFile), 'utf-8');

    // Extract the embedded __adapterHash from the IIFE content
    const hashMatch = content.match(/\.__adapterHash="([0-9a-f]{64})"/);
    expect(hashMatch).not.toBeNull();
    const diskHash = hashMatch?.[1];

    // The embedded hash in the disk file must equal the server's expectedHash
    expect(diskHash).toBe(reportedHash);

    // The per-tab hash must also match
    expect(tab.adapterHash).toBe(reportedHash);

    // Tool dispatch still works after the reconnects
    await waitForToolResult(mcpClient, 'e2e-test_echo', { message: 'after-hash-verify' }, { isError: false }, 15_000);
  });
});
