/**
 * E2E tests for the notifyReadinessChanged pipeline.
 *
 * Verifies the full flow: postMessage('opentabs:readiness-changed') in MAIN world →
 * ISOLATED world relay → chrome.runtime.sendMessage → background handler →
 * re-probe isReady() → tab state change reported to MCP server.
 *
 * Uses the e2e-test plugin's `sdk_notify_readiness_changed` tool and the test
 * server's auth toggle to simulate SPA login/logout flows.
 */

import { expect, test } from './fixtures.js';
import { callToolExpectSuccess, setupToolTest, waitForToolResult } from './helpers.js';

test.describe('notifyReadinessChanged — full pipeline', () => {
  test('calling notifyReadinessChanged while ready keeps state ready', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify plugin is in ready state before calling
    const healthBefore = await mcpServer.health();
    const stateBefore = healthBefore?.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
    expect(stateBefore).toBe('ready');

    // Call the tool that invokes notifyReadinessChanged
    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_notify_readiness_changed');
    expect(output.ok).toBe(true);

    // Wait for the re-probe pipeline to propagate and verify state is still ready
    await expect
      .poll(
        async () => {
          const h = await mcpServer.health();
          return h?.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
        },
        { timeout: 10_000, message: 'tabState should remain ready after notifyReadinessChanged' },
      )
      .toBe('ready');

    // Tool dispatch still works
    const echoResult = await mcpClient.callTool('e2e-test__echo', { message: 'still ready' });
    expect(echoResult.isError).toBe(false);
    expect(echoResult.content).toContain('still ready');

    await page.close();
  });

  test('readiness-changed postMessage triggers re-probe that detects unavailable → ready transition without page reload', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify plugin starts in ready state
    await expect
      .poll(
        async () => {
          const h = await mcpServer.health();
          return h?.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
        },
        { timeout: 10_000, message: 'Plugin should start ready' },
      )
      .toBe('ready');

    // Toggle auth off — isReady() will return false on next probe
    await testServer.setAuth(false);

    // Force re-probe by reloading page (existing mechanism) to establish unavailable state
    await page.reload({ waitUntil: 'load' });

    // Wait for adapter re-injection — _readinessNonce is set by the ISOLATED world
    // relay (part of the browser extension) so it's always present after injection
    await page.waitForFunction(
      () => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
        return ot !== undefined && typeof ot._readinessNonce === 'string';
      },
      { timeout: 15_000 },
    );

    // Wait for state to become unavailable
    await expect
      .poll(
        async () => {
          const h = await mcpServer.health();
          return h?.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
        },
        { timeout: 30_000, message: 'Plugin should become unavailable after auth toggle' },
      )
      .toBe('unavailable');

    // Toggle auth back on — isReady() will return true on next probe
    await testServer.setAuth(true);

    // Post the readiness-changed message directly (same message that
    // notifyReadinessChanged() from the SDK would post). The nonce and plugin
    // name are read from globalThis.__openTabs, which the extension's relay
    // set up during injection.
    await page.evaluate(() => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown>;
      const nonce = ot._readinessNonce as string;
      window.postMessage({ type: 'opentabs:readiness-changed', plugin: 'e2e-test', nonce }, '*');
    });

    // The ISOLATED relay validates the nonce, forwards to background, which
    // re-probes isReady() and detects the state change: unavailable → ready
    await expect
      .poll(
        async () => {
          const h = await mcpServer.health();
          return h?.pluginDetails?.find(p => p.name === 'e2e-test')?.tabState;
        },
        {
          timeout: 30_000,
          message: 'Plugin should become ready after readiness-changed postMessage without page reload',
        },
      )
      .toBe('ready');

    // Verify tool dispatch works again
    await waitForToolResult(mcpClient, 'e2e-test__echo', { message: 'back online' }, { isError: false }, 15_000);

    await page.close();
  });
});
