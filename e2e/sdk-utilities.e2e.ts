/**
 * E2E tests for SDK utility functions (US-006).
 *
 * Verifies that SDK utilities (waitForSelector, fetchJSON, getLocalStorage,
 * getPageGlobal, retry) work end-to-end through the full dispatch chain:
 * MCP client → MCP server → Chrome extension → page context → SDK utility → response.
 *
 * Uses the /sdk-test page on the test server which provides:
 *   - A delayed DOM element (#delayed-element, appears after 500ms)
 *   - localStorage key 'sdk-test-key' = 'sdk-test-value'
 *   - window.__sdkTestGlobal = { nested: { value: 42, deeply: { nested: { value: 'deep' } } } }
 *   - An element with known textContent (#known-text)
 *
 * The test server also provides:
 *   - POST /api/sdk-fetch-test — returns { ok: true, data: 'sdk-fetch-works' }
 *   - POST /api/flaky — fails the first 3 calls, then succeeds
 */

import { expect, test } from './fixtures.js';
import {
  callToolExpectSuccess,
  openTestAppTab,
  waitForExtensionConnected,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

/**
 * Open the /sdk-test page and wait for the adapter to be injected.
 * Navigates to the SDK test page instead of the default test app page.
 */
const setupSdkTest = async (
  mcpServer: Parameters<typeof waitForExtensionConnected>[0],
  testServer: { url: string; reset: () => Promise<void> },
  extensionContext: Parameters<typeof openTestAppTab>[0],
  mcpClient: Parameters<typeof waitForToolResult>[0],
) => {
  await waitForExtensionConnected(mcpServer);
  await waitForLog(mcpServer, 'plugin(s) mapped');
  await testServer.reset();

  // Open the /sdk-test page (adapter gets injected because url matches http://localhost/*)
  const page = await openTestAppTab(extensionContext, `${testServer.url}/sdk-test`, mcpServer);

  // Poll until the plugin reports "ready" state on this page
  await waitForToolResult(mcpClient, 'e2e-test__get_status', {}, { isError: false }, 15_000);

  return page;
};

// ---------------------------------------------------------------------------
// SDK Utilities — full stack E2E tests
// ---------------------------------------------------------------------------

test.describe('SDK utilities — full stack', () => {
  test('waitForSelector: waits for a delayed DOM element', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_wait_for_selector', {
      selector: '#delayed-element',
    });

    expect(output.ok).toBe(true);
    expect(output.tagName).toBe('div');
    expect(output.textContent).toBe('Delayed element appeared');

    await page.close();
  });

  test('fetchJSON: fetches JSON from the test server via SDK utility', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_fetch_json', {});

    expect(output.ok).toBe(true);
    expect(output.data).toBe('sdk-fetch-works');

    await page.close();
  });

  test('getLocalStorage: reads a value set by the SDK test page', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_get_local_storage', {
      key: 'sdk-test-key',
    });

    expect(output.ok).toBe(true);
    expect(output.value).toBe('sdk-test-value');

    await page.close();
  });

  test('getLocalStorage: returns null for missing key', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_get_local_storage', {
      key: 'nonexistent-key',
    });

    expect(output.ok).toBe(true);
    expect(output.value).toBeNull();

    await page.close();
  });

  test('getPageGlobal: reads a nested global property', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_get_page_global', {
      path: '__sdkTestGlobal.nested.value',
    });

    expect(output.ok).toBe(true);
    expect(output.found).toBe(true);
    expect(output.value).toBe(42);

    await page.close();
  });

  test('getPageGlobal: reads a deeply nested property (4 levels)', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_get_page_global', {
      path: '__sdkTestGlobal.nested.deeply.nested.value',
    });

    expect(output.ok).toBe(true);
    expect(output.found).toBe(true);
    expect(output.value).toBe('deep');

    await page.close();
  });

  test('getPageGlobal: returns not found for missing path', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_get_page_global', {
      path: '__nonexistent.deep.path',
    });

    expect(output.ok).toBe(true);
    expect(output.found).toBe(false);

    await page.close();
  });

  test('getPageGlobal: returns not found for non-existent intermediate segment', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    // __sdkTestGlobal.nested exists, but .nonexistent does not
    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_get_page_global', {
      path: '__sdkTestGlobal.nested.nonexistent.value',
    });

    expect(output.ok).toBe(true);
    expect(output.found).toBe(false);

    await page.close();
  });

  test('retry: retries a flaky endpoint until it succeeds', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    // The /api/flaky endpoint fails the first 3 calls, then succeeds.
    // sdk.retry is configured with maxAttempts: 5, delay: 100.
    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_retry', {});

    expect(output.ok).toBe(true);
    expect(output.data).toBe('flaky-success');
    // The server should have received 4 calls (3 failures + 1 success)
    expect(output.attempts).toBe(4);

    await page.close();
  });

  test('removeLocalStorage: removes a key from localStorage', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    // Set a localStorage key on the page to be removed by the tool
    await page.evaluate(() => localStorage.setItem('removeMe', 'value'));

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_remove_storage', {
      storageType: 'local',
      key: 'removeMe',
    });

    expect(output.existed).toBe(true);
    expect(output.afterRemoval).toBe(false);

    // Verify from the page context that the key is gone
    const valueAfter = await page.evaluate(() => localStorage.getItem('removeMe'));
    expect(valueAfter).toBeNull();

    await page.close();
  });

  test('removeSessionStorage: removes a key from sessionStorage', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    // Set a sessionStorage key on the page to be removed by the tool
    await page.evaluate(() => sessionStorage.setItem('removeMe', 'session-value'));

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_remove_storage', {
      storageType: 'session',
      key: 'removeMe',
    });

    expect(output.existed).toBe(true);
    expect(output.afterRemoval).toBe(false);

    // Verify from the page context that the key is gone
    const valueAfter = await page.evaluate(() => sessionStorage.getItem('removeMe'));
    expect(valueAfter).toBeNull();

    await page.close();
  });

  test('setSessionStorage: writes a value and reads it back', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_set_session_storage', {
      key: 'test-key',
      value: 'test-value',
    });

    expect(output.ok).toBe(true);
    expect(output.readBack).toBe('test-value');

    // Verify the value is in sessionStorage from the page context
    const stored = await page.evaluate(() => sessionStorage.getItem('test-key'));
    expect(stored).toBe('test-value');

    await page.close();
  });

  test('putJSON: sends a PUT request and returns ok and method', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_http_methods', {
      method: 'put',
      data: { foo: 'bar' },
    });

    expect(output.ok).toBe(true);
    expect(output.method).toBe('put');

    await page.close();
  });

  test('patchJSON: sends a PATCH request and returns ok and method', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_http_methods', {
      method: 'patch',
      data: { foo: 'bar' },
    });

    expect(output.ok).toBe(true);
    expect(output.method).toBe('patch');

    await page.close();
  });

  test('deleteJSON: sends a DELETE request and returns ok and method', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupSdkTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test__sdk_http_methods', {
      method: 'delete',
    });

    expect(output.ok).toBe(true);
    expect(output.method).toBe('delete');

    await page.close();
  });
});
