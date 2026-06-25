/**
 * E2E tests for structured error propagation.
 *
 * Verifies that ToolError factory methods (auth, rateLimited, notFound,
 * validation, timeout, internal) produce structured error responses that
 * propagate through the full dispatch chain: adapter → extension → MCP server
 * → MCP client. Each test invokes a dedicated error tool and verifies the
 * response contains the correct human-readable prefix and machine-readable
 * JSON block.
 */

import { expect, test } from './fixtures.js';
import { parseErrorJson, setupToolTest } from './helpers.js';

// ---------------------------------------------------------------------------
// Structured error propagation — full stack
// ---------------------------------------------------------------------------

test.describe('Structured error propagation', () => {
  test('auth error: ToolError.auth() produces category=auth, retryable=false', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__error_auth', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Not authenticated');
    expect(result.content).toContain('[ERROR');
    expect(result.content).toContain('code=AUTH_ERROR');
    expect(result.content).toContain('category=auth');
    expect(result.content).toContain('retryable=false');

    const json = parseErrorJson(result.content);
    expect(json.code).toBe('AUTH_ERROR');
    expect(json.category).toBe('auth');
    expect(json.retryable).toBe(false);
    expect(json).not.toHaveProperty('retryAfterMs');

    await page.close();
  });

  test('rate limited error: ToolError.rateLimited() produces category=rate_limit, retryable=true, retryAfterMs', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__error_rate_limited', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Too many requests');
    expect(result.content).toContain('code=RATE_LIMITED');
    expect(result.content).toContain('category=rate_limit');
    expect(result.content).toContain('retryable=true');
    expect(result.content).toContain('retryAfterMs=5000');

    const json = parseErrorJson(result.content);
    expect(json.code).toBe('RATE_LIMITED');
    expect(json.category).toBe('rate_limit');
    expect(json.retryable).toBe(true);
    expect(json.retryAfterMs).toBe(5000);

    await page.close();
  });

  test('not found error: ToolError.notFound() produces category=not_found, retryable=false', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__error_not_found', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Resource does not exist');
    expect(result.content).toContain('code=NOT_FOUND');
    expect(result.content).toContain('category=not_found');
    expect(result.content).toContain('retryable=false');

    const json = parseErrorJson(result.content);
    expect(json.code).toBe('NOT_FOUND');
    expect(json.category).toBe('not_found');
    expect(json.retryable).toBe(false);
    expect(json).not.toHaveProperty('retryAfterMs');

    await page.close();
  });

  test('validation error: ToolError.validation() produces category=validation, retryable=false', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__error_validation', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid input');
    expect(result.content).toContain('code=VALIDATION_ERROR');
    expect(result.content).toContain('category=validation');
    expect(result.content).toContain('retryable=false');

    const json = parseErrorJson(result.content);
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.category).toBe('validation');
    expect(json.retryable).toBe(false);
    expect(json).not.toHaveProperty('retryAfterMs');

    await page.close();
  });

  test('timeout error: ToolError.timeout() produces category=timeout, retryable=true', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__error_timeout', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('timed out');
    expect(result.content).toContain('code=TIMEOUT');
    expect(result.content).toContain('category=timeout');
    expect(result.content).toContain('retryable=true');

    const json = parseErrorJson(result.content);
    expect(json.code).toBe('TIMEOUT');
    expect(json.category).toBe('timeout');
    expect(json.retryable).toBe(true);
    expect(json).not.toHaveProperty('retryAfterMs');

    await page.close();
  });

  test('internal error: ToolError.internal() produces category=internal, retryable=false', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__error_internal', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unexpected server error');
    expect(result.content).toContain('code=INTERNAL_ERROR');
    expect(result.content).toContain('category=internal');
    expect(result.content).toContain('retryable=false');

    const json = parseErrorJson(result.content);
    expect(json.code).toBe('INTERNAL_ERROR');
    expect(json.category).toBe('internal');
    expect(json.retryable).toBe(false);
    expect(json).not.toHaveProperty('retryAfterMs');

    await page.close();
  });

  // -------------------------------------------------------------------------
  // Custom error codes — verify factory methods accept and propagate custom codes
  // -------------------------------------------------------------------------

  test('auth with custom code: propagates CUSTOM_AUTH instead of default AUTH_ERROR', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__error_custom_code', { factory: 'auth' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Custom auth error');
    expect(result.content).toContain('code=CUSTOM_AUTH');
    expect(result.content).toContain('category=auth');
    expect(result.content).toContain('retryable=false');

    const json = parseErrorJson(result.content);
    expect(json.code).toBe('CUSTOM_AUTH');
    expect(json.category).toBe('auth');
    expect(json.retryable).toBe(false);

    await page.close();
  });

  test('not_found with custom code: propagates CUSTOM_NOT_FOUND instead of default NOT_FOUND', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__error_custom_code', { factory: 'not_found' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Custom not found');
    expect(result.content).toContain('code=CUSTOM_NOT_FOUND');
    expect(result.content).toContain('category=not_found');
    expect(result.content).toContain('retryable=false');

    const json = parseErrorJson(result.content);
    expect(json.code).toBe('CUSTOM_NOT_FOUND');
    expect(json.category).toBe('not_found');
    expect(json.retryable).toBe(false);

    await page.close();
  });

  test('rate_limited with custom code: propagates CUSTOM_RATE_LIMIT with retryAfterMs', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__error_custom_code', { factory: 'rate_limited' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Custom rate limit');
    expect(result.content).toContain('code=CUSTOM_RATE_LIMIT');
    expect(result.content).toContain('category=rate_limit');
    expect(result.content).toContain('retryable=true');
    expect(result.content).toContain('retryAfterMs=3000');

    const json = parseErrorJson(result.content);
    expect(json.code).toBe('CUSTOM_RATE_LIMIT');
    expect(json.category).toBe('rate_limit');
    expect(json.retryable).toBe(true);
    expect(json.retryAfterMs).toBe(3000);

    await page.close();
  });

  test('validation with custom code: propagates CUSTOM_VALIDATION instead of default VALIDATION_ERROR', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__error_custom_code', { factory: 'validation' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Custom validation');
    expect(result.content).toContain('code=CUSTOM_VALIDATION');
    expect(result.content).toContain('category=validation');
    expect(result.content).toContain('retryable=false');

    const json = parseErrorJson(result.content);
    expect(json.code).toBe('CUSTOM_VALIDATION');
    expect(json.category).toBe('validation');
    expect(json.retryable).toBe(false);

    await page.close();
  });

  test('timeout with custom code: propagates CUSTOM_TIMEOUT instead of default TIMEOUT', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__error_custom_code', { factory: 'timeout' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Custom timeout');
    expect(result.content).toContain('code=CUSTOM_TIMEOUT');
    expect(result.content).toContain('category=timeout');
    expect(result.content).toContain('retryable=true');

    const json = parseErrorJson(result.content);
    expect(json.code).toBe('CUSTOM_TIMEOUT');
    expect(json.category).toBe('timeout');
    expect(json.retryable).toBe(true);

    await page.close();
  });

  test('internal with custom code: propagates CUSTOM_INTERNAL instead of default INTERNAL_ERROR', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__error_custom_code', { factory: 'internal' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Custom internal');
    expect(result.content).toContain('code=CUSTOM_INTERNAL');
    expect(result.content).toContain('category=internal');
    expect(result.content).toContain('retryable=false');

    const json = parseErrorJson(result.content);
    expect(json.code).toBe('CUSTOM_INTERNAL');
    expect(json.category).toBe('internal');
    expect(json.retryable).toBe(false);

    await page.close();
  });

  test('plain ToolError(msg, code) without opts still includes retryable=false (default)', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__failing_tool', {
      error_code: 'deliberate_failure',
      error_message: 'This tool always fails',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('This tool always fails');
    expect(result.content).toContain('code=deliberate_failure');
    expect(result.content).toContain('retryable=false');

    // retryable=false is a structured field, so JSON block is present
    const json = parseErrorJson(result.content);
    expect(json.code).toBe('deliberate_failure');
    expect(json.retryable).toBe(false);
    expect(json).not.toHaveProperty('category');
    expect(json).not.toHaveProperty('retryAfterMs');

    await page.close();
  });
});
