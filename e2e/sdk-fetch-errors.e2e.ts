/**
 * E2E tests for fetchFromPage error categorization.
 *
 * Verifies that fetchFromPage maps HTTP status codes to the correct
 * ToolError categories through the full dispatch chain: adapter IIFE →
 * extension → MCP server → MCP client. Each test calls the
 * sdk_fetch_error_categories tool with a specific test server endpoint
 * and asserts on the structured error response.
 */

import { expect, test } from './fixtures.js';
import { parseErrorJson, setupToolTest } from './helpers.js';

// ---------------------------------------------------------------------------
// fetchFromPage error categorization — full stack
// ---------------------------------------------------------------------------

test.describe('fetchFromPage error categorization', () => {
  test('401 produces category=auth, retryable=false', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__sdk_fetch_error_categories', {
      endpoint: '/api/status-code/401',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('[ERROR');
    expect(result.content).toContain('category=auth');
    expect(result.content).toContain('retryable=false');

    const json = parseErrorJson(result.content);
    expect(json.category).toBe('auth');
    expect(json.retryable).toBe(false);

    await page.close();
  });

  test('404 produces category=not_found, retryable=false', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__sdk_fetch_error_categories', {
      endpoint: '/api/status-code/404',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('[ERROR');
    expect(result.content).toContain('category=not_found');
    expect(result.content).toContain('retryable=false');

    const json = parseErrorJson(result.content);
    expect(json.category).toBe('not_found');
    expect(json.retryable).toBe(false);

    await page.close();
  });

  test('429 produces category=rate_limit, retryable=true, retryAfterMs', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__sdk_fetch_error_categories', {
      endpoint: '/api/status-code/429',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('[ERROR');
    expect(result.content).toContain('category=rate_limit');
    expect(result.content).toContain('retryable=true');
    expect(result.content).toContain('retryAfterMs=3000');

    const json = parseErrorJson(result.content);
    expect(json.category).toBe('rate_limit');
    expect(json.retryable).toBe(true);
    expect(json.retryAfterMs).toBe(3000);

    await page.close();
  });

  test('timeout produces category=timeout, retryable=true', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Use a very short timeout (1s) against the slow-forever endpoint
    const result = await mcpClient.callTool('e2e-test__sdk_fetch_error_categories', {
      endpoint: '/api/slow-forever',
      timeoutMs: 1000,
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('[ERROR');
    expect(result.content).toContain('category=timeout');
    expect(result.content).toContain('retryable=true');

    const json = parseErrorJson(result.content);
    expect(json.category).toBe('timeout');
    expect(json.retryable).toBe(true);

    await page.close();
  });

  test('500 produces category=internal', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__sdk_fetch_error_categories', {
      endpoint: '/api/status-code/500',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('[ERROR');
    expect(result.content).toContain('category=internal');
    expect(result.content).toContain('retryable=false');

    const json = parseErrorJson(result.content);
    expect(json.category).toBe('internal');
    expect(json.retryable).toBe(false);

    await page.close();
  });
});
