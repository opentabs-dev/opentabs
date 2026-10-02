/**
 * E2E test: tool payload size limits track Chrome's 64 MiB extension-message cap.
 *
 *   - A 20 MiB payload round-trips through a real tab
 *   - An input just over the extension's MAX_INPUT_SIZE (63 MiB) fails fast with
 *     a clear error instead of hanging in chrome.scripting.executeScript
 */

import { expect, test } from './fixtures.js';
import { setupToolTest } from './helpers.js';

const MIB = 1024 * 1024;

test.describe('Tool payload size limits', () => {
  test('round-trips a 20 MiB payload through a tab', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    test.setTimeout(120_000);
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const message = 'x'.repeat(20 * MIB);
    const result = await mcpClient.callTool('e2e-test__echo', { message }, { timeout: 90_000 });

    expect(result.isError).toBe(false);
    expect((JSON.parse(result.content) as { message: string }).message).toBe(message);
  });

  test('rejects input over the 63 MiB dispatch limit with a clear error', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.setTimeout(120_000);
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test__echo', { message: 'x'.repeat(63 * MIB) }, { timeout: 90_000 });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Tool input too large');
    expect(result.content).toContain('limit: 63MiB');
  });
});
