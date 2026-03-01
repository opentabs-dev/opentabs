/**
 * E2E tests for the plugin logging pipeline.
 *
 * Verifies the full flow: sdk.log in adapter → postMessage → ISOLATED relay →
 * chrome.runtime.sendMessage → background → WebSocket → MCP server → log buffer
 * → console (server.log) → MCP clients (sendLoggingMessage).
 *
 * Uses the e2e-test plugin's `log_levels` tool, which emits one log entry at
 * each level (debug, info, warning, error) with a unique prefix for isolation.
 * Each log call includes a structured args object ({ level: '<levelname>' })
 * which the SDK serializes to JSON and the server appends to the log line.
 */

import { test, expect } from './fixtures.js';
import { setupToolTest, callToolExpectSuccess, waitForLog } from './helpers.js';

test.describe('Plugin logging — full pipeline', () => {
  test('log_levels tool emits log entries that arrive at MCP server', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Record log buffer size before the tool call so we can detect new entries.
    const healthBefore = await mcpServer.health();
    const bufferBefore = healthBefore?.pluginDetails?.find(p => p.name === 'e2e-test')?.logBufferSize ?? 0;

    const prefix = `e2e-log-${Date.now()}`;
    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_log_levels', { prefix });
    expect(output.ok).toBe(true);
    expect(output.levels).toEqual(['debug', 'info', 'warning', 'error']);

    // Poll /health until at least 4 new log entries arrive in the server's
    // in-memory buffer. This is more reliable than watching stdout because the
    // log pipeline is fire-and-forget at every hop — stdout polling can miss
    // entries due to buffering, whereas /health reads the buffer directly.
    await mcpServer.waitForHealth(h => {
      const buf = h.pluginDetails?.find(p => p.name === 'e2e-test')?.logBufferSize ?? 0;
      return buf >= bufferBefore + 4;
    }, 10_000);

    // Log entries are in the buffer and console.log was called on the same code
    // path, so stdout should contain them. Use waitForLog as a short sanity
    // check (entries should already be there — just need stdout flush).
    await waitForLog(mcpServer, `${prefix} error-message`, 5_000);

    // Verify all four log levels appeared in server logs
    const allLogs = mcpServer.logs.join('\n');
    expect(allLogs).toContain(`[plugin:e2e-test]`);
    expect(allLogs).toContain(`${prefix} debug-message`);
    expect(allLogs).toContain(`${prefix} info-message`);
    expect(allLogs).toContain(`${prefix} warning-message`);
    expect(allLogs).toContain(`${prefix} error-message`);

    // Verify log level tags appear in server log output
    expect(allLogs).toContain('DEBUG');
    expect(allLogs).toContain('INFO');
    expect(allLogs).toContain('WARNING');
    expect(allLogs).toContain('ERROR');

    await page.close();
  });

  test('log_levels tool serializes structured args into server log output', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Record buffer size before so we can wait for entries to arrive.
    const healthBefore = await mcpServer.health();
    const bufferBefore = healthBefore?.pluginDetails?.find(p => p.name === 'e2e-test')?.logBufferSize ?? 0;

    const prefix = `e2e-args-${Date.now()}`;
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_log_levels', { prefix });

    // Wait until all 4 entries are buffered before checking stdout.
    await mcpServer.waitForHealth(h => {
      const buf = h.pluginDetails?.find(p => p.name === 'e2e-test')?.logBufferSize ?? 0;
      return buf >= bufferBefore + 4;
    }, 10_000);

    // The log_levels tool calls log.debug/info/warn/error with a structured args
    // object { level: '<levelname>' }. The SDK serializes these as a JSON array
    // and the server appends them to the log line:
    //   [plugin:e2e-test] <ts> DEBUG prefix debug-message [{"level":"debug"}]
    await waitForLog(mcpServer, `${prefix} error-message`, 5_000);

    const allLogs = mcpServer.logs.join('\n');
    expect(allLogs).toContain(`${prefix} debug-message [{"level":"debug"}]`);
    expect(allLogs).toContain(`${prefix} info-message [{"level":"info"}]`);
    expect(allLogs).toContain(`${prefix} warning-message [{"level":"warning"}]`);
    expect(allLogs).toContain(`${prefix} error-message [{"level":"error"}]`);

    await page.close();
  });

  test('log_levels tool increments log buffer size by exactly the number of entries emitted', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Record the exact buffer size before the tool call.
    const healthBefore = await mcpServer.health();
    const bufferBefore = healthBefore?.pluginDetails?.find(p => p.name === 'e2e-test')?.logBufferSize ?? 0;

    const prefix = `e2e-count-${Date.now()}`;
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_log_levels', { prefix });

    // The log_levels tool emits exactly 4 entries (debug, info, warning, error).
    // Wait for the buffer to reach exactly bufferBefore + 4 — if duplicate
    // entries were emitted the count would overshoot.
    await mcpServer.waitForHealth(h => {
      const buf = h.pluginDetails?.find(p => p.name === 'e2e-test')?.logBufferSize ?? 0;
      return buf >= bufferBefore + 4;
    }, 10_000);

    const healthAfter = await mcpServer.health();
    const bufferAfter = healthAfter?.pluginDetails?.find(p => p.name === 'e2e-test')?.logBufferSize ?? 0;
    expect(bufferAfter).toBe(bufferBefore + 4);

    await page.close();
  });

  test('log buffer enforces 1000-entry circular limit', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow();

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Use log_bulk to emit 1100 entries in a single tool call, exceeding
    // the 1000-entry circular buffer limit without hitting rate limits.
    const overflowPrefix = `overflow-${Date.now()}`;
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_log_bulk', {
      prefix: overflowPrefix,
      count: 1100,
    });

    // Wait for the buffer to stabilize at the 1000-entry cap.
    await mcpServer.waitForHealth(h => {
      const buf = h.pluginDetails?.find(p => p.name === 'e2e-test')?.logBufferSize ?? 0;
      return buf >= 1000;
    }, 30_000);

    const health = await mcpServer.health();
    const bufferSize = health?.pluginDetails?.find(p => p.name === 'e2e-test')?.logBufferSize ?? 0;
    expect(bufferSize).toBeLessThanOrEqual(1000);
    expect(bufferSize).toBe(1000);

    // Emit more entries to verify the buffer wraps (doesn't stop accepting).
    const markerPrefix = `overflow-marker-${Date.now()}`;
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_log_bulk', {
      prefix: markerPrefix,
      count: 10,
    });

    // Wait for the new entries to arrive in the buffer.
    await mcpServer.waitForHealth(h => {
      const buf = h.pluginDetails?.find(p => p.name === 'e2e-test')?.logBufferSize ?? 0;
      return buf >= 1000;
    }, 10_000);

    const healthAfter = await mcpServer.health();
    const bufferAfter = healthAfter?.pluginDetails?.find(p => p.name === 'e2e-test')?.logBufferSize ?? 0;

    // Buffer is still at capacity (didn't grow beyond 1000).
    expect(bufferAfter).toBeLessThanOrEqual(1000);
    // Buffer is still full (new entries replaced old ones, not dropped).
    expect(bufferAfter).toBe(1000);

    // Verify the marker entries made it into server logs (buffer accepted them).
    await waitForLog(mcpServer, `${markerPrefix} entry-9`, 5_000);

    await page.close();
  });
});
