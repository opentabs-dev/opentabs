/**
 * Full E2E tests — MCP client → MCP server → extension → injected adapter → test web server.
 *
 * These tests exercise the COMPLETE tool dispatch path, not just the WebSocket
 * lifecycle. A real Chromium browser with the extension loaded opens a tab to
 * the controllable test web server, the adapter IIFE is injected, and tools
 * are invoked through the MCP streamable HTTP protocol. The test web server's
 * /control endpoints toggle auth, error modes, and record invocations so we
 * can assert on exactly what the plugin relayed.
 *
 * Prerequisites (all pre-built, not created at test time):
 *   - `npm run build` has been run (platform dist/ files exist)
 *   - `plugins/e2e-test` has been built (`cd plugins/e2e-test && npm run build`)
 *   - Chromium is installed for Playwright
 *
 * All tests use dynamic ports and are safe for parallel execution.
 */

import fs from 'node:fs';
import path from 'node:path';
import { E2E_TEST_PLUGIN_DIR, expect, test } from './fixtures.js';
import {
  callToolExpectSuccess,
  openTestAppTab,
  parseToolResult,
  setupToolTest,
  waitFor,
  waitForExtensionConnected,
  waitForLog,
  waitForToolResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Tool dispatch — full stack roundtrip
// ---------------------------------------------------------------------------

test.describe('Tool dispatch — full stack', () => {
  test('echo tool: message roundtrips through MCP → extension → adapter → test server → back', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // List tools — e2e-test tools should be present
    const tools = await mcpClient.listTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('e2e-test_echo');
    expect(toolNames).toContain('e2e-test_greet');
    expect(toolNames).toContain('e2e-test_list_items');
    expect(toolNames).toContain('e2e-test_get_status');
    expect(toolNames).toContain('e2e-test_create_item');
    expect(toolNames).toContain('e2e-test_failing_tool');

    // Call echo tool
    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'hello from e2e' });
    expect(output.ok).toBe(true);
    expect(output.message).toBe('hello from e2e');

    // Verify the test server recorded the invocation
    const invocations = await testServer.invocations();
    const echoInvocations = invocations.filter(i => i.path === '/api/echo');
    expect(echoInvocations.length).toBeGreaterThanOrEqual(1);
    const lastEcho = echoInvocations[echoInvocations.length - 1];
    if (!lastEcho) throw new Error('No echo invocation found');
    expect((lastEcho.body as Record<string, unknown>).message).toBe('hello from e2e');

    await page.close();
  });

  test('greet tool: server computes output from input', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_greet', { name: 'Playwright' });
    expect(output.ok).toBe(true);
    expect(output.greeting).toBe('Hello, Playwright!');

    await page.close();
  });

  test('list_items tool: returns paginated array with defaults', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_list_items', {});
    expect(output.ok).toBe(true);
    expect(Array.isArray(output.items)).toBe(true);
    expect((output.items as unknown[]).length).toBeGreaterThan(0);
    expect(typeof output.total).toBe('number');

    await page.close();
  });

  test('list_items tool: respects limit and offset params', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_list_items', { limit: 2, offset: 1 });
    expect(output.ok).toBe(true);
    const items = output.items as Array<{ id: string; name: string }>;
    expect(items.length).toBe(2);
    const item0 = items[0];
    const item1 = items[1];
    if (!item0 || !item1) throw new Error('Expected 2 items');
    expect(item0.name).toBe('Bravo');
    expect(item1.name).toBe('Charlie');

    await page.close();
  });

  test('get_status tool: zero-input tool returns server state', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_get_status', {});
    expect(output.ok).toBe(true);
    expect(output.authenticated).toBe(true);
    expect(typeof output.uptime).toBe('number');
    expect(output.version).toBe('1.0.0-test');

    await page.close();
  });

  test('create_item tool: creates a resource and returns its ID', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_create_item', {
      name: 'Test Item',
      description: 'Created during E2E test',
    });
    expect(output.ok).toBe(true);
    const item = output.item as Record<string, unknown>;
    expect(item.name).toBe('Test Item');
    expect(item.description).toBe('Created during E2E test');
    expect(typeof item.id).toBe('string');
    expect(typeof item.created_at).toBe('string');

    // Verify it was actually persisted
    const listOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_list_items', { limit: 100 });
    const allItems = listOutput.items as Array<{ id: string; name: string }>;
    expect(allItems.some(i => i.name === 'Test Item')).toBe(true);

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

test.describe('Error propagation', () => {
  test('failing_tool: ToolError propagates through the full stack as MCP error', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test_failing_tool', {
      error_code: 'not_found',
      error_message: 'Item does not exist',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Item does not exist');

    await page.close();
  });

  test('failing_tool with defaults: uses default error code and message', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    const result = await mcpClient.callTool('e2e-test_failing_tool', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('This tool always fails');

    await page.close();
  });

  test('auth off: extension returns unavailable (-32002) because isReady()=false', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // When auth is off, isReady() returns false. The extension checks isReady()
    // before EVERY tool dispatch and short-circuits with -32002 "unavailable"
    // if it returns false. The tool handler never runs — so the ToolError from
    // the test server's "not_authed" response is never reached.
    //
    // This is CORRECT platform behavior: the readiness probe protects tools.
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // First verify echo works while authenticated
    const okResult = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'before auth off' });
    expect(okResult.message).toBe('before auth off');

    // Toggle auth off
    await testServer.setAuth(false);

    // Poll until the tool returns an error (extension re-probes on next dispatch)
    const failResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'after auth off' },
      { isError: true },
    );
    expect(failResult.content.toLowerCase()).toMatch(/unavailable|not ready/);

    // Toggle auth back on
    await testServer.setAuth(true);

    // Poll until the tool succeeds again
    const recoveredResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'auth restored' },
      { isError: false },
    );
    const recoveredOutput = parseToolResult(recoveredResult.content);
    expect(recoveredOutput.message).toBe('auth restored');

    await page.close();
  });

  test('error mode: isReady returns false because auth.check gets 500 → tools unavailable', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // When error mode is on, ALL endpoints return 500 — including /api/auth.check.
    // isReady() catches the error and returns false → extension returns -32002.
    // This is correct: server errors make the service unavailable, not just errored.
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Enable error mode
    await testServer.setError(true);

    // Poll until the tool returns an error
    const echoResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'should fail' },
      { isError: true },
    );
    expect(echoResult.isError).toBe(true);

    // Disable error mode
    await testServer.setError(false);

    // Poll until the tool succeeds again
    const recoveredResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'recovered' },
      { isError: false },
    );
    const recoveredOutput = parseToolResult(recoveredResult.content);
    expect(recoveredOutput.message).toBe('recovered');

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Tab state transitions
// ---------------------------------------------------------------------------

test.describe('Tab state transitions', () => {
  test('no matching tab → tool dispatch returns -32001 (closed)', async ({
    mcpServer,
    testServer,
    extensionContext: _extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');
    await testServer.reset();

    // Don't open any tab to the test server.
    const result = await mcpClient.callTool('e2e-test_echo', {
      message: 'no tab',
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toMatch(/closed|no matching tab/);
  });

  test('tab open + auth on → tool works; toggle auth off → unavailable; toggle back → works', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Tool should work (ready)
    const readyOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'ready state' });
    expect(readyOutput.message).toBe('ready state');

    // Toggle auth off → isReady=false → unavailable
    await testServer.setAuth(false);
    // Force page reload so extension re-probes on onUpdated
    await page.reload({ waitUntil: 'load' });
    // Wait for adapter re-injection
    await page.waitForFunction(
      () => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      },
      { timeout: 10_000 },
    );

    // Poll until the tool returns unavailable instead of fixed sleep
    const unavailResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'unavailable state' },
      { isError: true },
    );
    expect(unavailResult.content.toLowerCase()).toMatch(/unavailable|not ready/);

    // Toggle auth back on
    await testServer.setAuth(true);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      },
      { timeout: 10_000 },
    );

    // Poll until the tool succeeds instead of fixed READY_SETTLE_MS sleep
    const recoveredResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'recovered state' },
      { isError: false },
    );
    const recoveredOutput = parseToolResult(recoveredResult.content);
    expect(recoveredOutput.message).toBe('recovered state');

    await page.close();
  });

  test('close tab → tool fails → reopen tab → tool works again', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Tool works with tab open
    const okOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'tab open' });
    expect(okOutput.message).toBe('tab open');

    // Close the tab
    await page.close();

    // Poll until the tool fails (tab closed) instead of fixed sleep
    const closedResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'tab closed' },
      { isError: true },
    );
    expect(closedResult.isError).toBe(true);

    // Reopen the tab
    const page2 = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    // Poll until the tool succeeds instead of fixed READY_SETTLE_MS sleep
    const reopenResult = await waitForToolResult(
      mcpClient,
      'e2e-test_echo',
      { message: 'tab reopened' },
      { isError: false },
    );
    const reopenOutput = parseToolResult(reopenResult.content);
    expect(reopenOutput.message).toBe('tab reopened');

    await page2.close();
  });
});

// ---------------------------------------------------------------------------
// Console.warn transparency logging
// ---------------------------------------------------------------------------

test.describe('Console.warn transparency logging', () => {
  test('tool invocation logs [OpenTabs] warning in the target tab console', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Capture console.warn messages from the page
    const warnings: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'warning') {
        warnings.push(msg.text());
      }
    });

    // Invoke a tool
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
      message: 'console test',
    });

    // Poll until the [opentabs] warning appears instead of fixed sleep
    await waitFor(() => warnings.some(w => w.includes('[opentabs]')), 5_000, 200, '[opentabs] console.warn to appear');

    // Verify the console.warn format: "[opentabs] e2e-test.echo invoked — <link>"
    const openTabsWarning = warnings.find(w => w.includes('[opentabs]'));
    expect(openTabsWarning).toBeDefined();
    expect(openTabsWarning).toContain('e2e-test');
    expect(openTabsWarning).toContain('echo');
    expect(openTabsWarning).toContain('invoked');

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Invocation recording
// ---------------------------------------------------------------------------

test.describe('Invocation recording', () => {
  test('test server records all API calls made by the plugin', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);
    // Clear invocations AFTER setup (setup generates auth.check calls)
    await testServer.reset();

    // Make several tool calls
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
      message: 'inv-1',
    });
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_greet', {
      name: 'Tester',
    });
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_list_items', {
      limit: 3,
    });
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_get_status', {});
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_create_item', {
      name: 'Recorded',
    });

    // Fetch invocation log from the test server
    const invocations = await testServer.invocations();
    const toolInvocations = invocations.filter(i => i.path !== '/api/auth.check');

    const paths = toolInvocations.map(i => i.path);
    expect(paths).toContain('/api/echo');
    expect(paths).toContain('/api/greet');
    expect(paths).toContain('/api/list-items');
    expect(paths).toContain('/api/status');
    expect(paths).toContain('/api/create-item');

    // Verify bodies were correctly relayed
    const echoInv = toolInvocations.find(i => i.path === '/api/echo');
    expect(echoInv).toBeDefined();
    if (!echoInv) throw new Error('echoInv not found');
    expect((echoInv.body as Record<string, unknown>).message).toBe('inv-1');

    const greetInv = toolInvocations.find(i => i.path === '/api/greet');
    expect(greetInv).toBeDefined();
    if (!greetInv) throw new Error('greetInv not found');
    expect((greetInv.body as Record<string, unknown>).name).toBe('Tester');

    const createInv = toolInvocations.find(i => i.path === '/api/create-item');
    expect(createInv).toBeDefined();
    if (!createInv) throw new Error('createInv not found');
    expect((createInv.body as Record<string, unknown>).name).toBe('Recorded');

    await page.close();
  });

  test('invocations are ordered chronologically', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);
    await testServer.reset();

    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
      message: 'first',
    });
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
      message: 'second',
    });
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', {
      message: 'third',
    });

    const invocations = await testServer.invocations();
    const echoInvocations = invocations.filter(i => i.path === '/api/echo');
    expect(echoInvocations.length).toBeGreaterThanOrEqual(3);

    // Timestamps should be ascending
    for (let i = 1; i < echoInvocations.length; i++) {
      const current = echoInvocations[i];
      const previous = echoInvocations[i - 1];
      if (!current || !previous) throw new Error(`Missing invocation at index ${i}`);
      expect(current.ts).toBeGreaterThanOrEqual(previous.ts);
    }

    // Messages should match order
    const lastThree = echoInvocations.slice(-3);
    const first = lastThree[0];
    const second = lastThree[1];
    const third = lastThree[2];
    if (!first || !second || !third) throw new Error('Expected at least 3 echo invocations');
    expect((first.body as Record<string, unknown>).message).toBe('first');
    expect((second.body as Record<string, unknown>).message).toBe('second');
    expect((third.body as Record<string, unknown>).message).toBe('third');

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Adapter injection
// ---------------------------------------------------------------------------

test.describe('Adapter injection', () => {
  test('adapter is injected into matching tab and exposes isReady + tools', async ({
    mcpServer,
    testServer,
    extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');
    await testServer.reset();

    const page = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    const adapterInfo = await page.evaluate(() => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as
        | { adapters?: Record<string, unknown> }
        | undefined;
      const adapter = ot?.adapters?.['e2e-test'] as
        | {
            name: string;
            tools: Array<{ name: string }>;
            isReady: () => Promise<boolean>;
          }
        | undefined;
      if (!adapter) return null;
      return {
        name: adapter.name,
        toolNames: adapter.tools.map(t => t.name),
        hasIsReady: typeof adapter.isReady === 'function',
      };
    });

    expect(adapterInfo).not.toBeNull();
    if (!adapterInfo) throw new Error('adapterInfo is null');
    expect(adapterInfo.name).toBe('e2e-test');
    expect(adapterInfo.hasIsReady).toBe(true);
    expect(adapterInfo.toolNames).toContain('echo');
    expect(adapterInfo.toolNames).toContain('greet');
    expect(adapterInfo.toolNames).toContain('list_items');
    expect(adapterInfo.toolNames).toContain('get_status');
    expect(adapterInfo.toolNames).toContain('create_item');
    expect(adapterInfo.toolNames).toContain('failing_tool');

    await page.close();
  });

  test('adapter is NOT injected into non-matching tabs', async ({ mcpServer, extensionContext }) => {
    await waitForExtensionConnected(mcpServer);

    const page = await extensionContext.newPage();
    await page.goto('about:blank', { waitUntil: 'load' });

    // Negative assertion: adapter should NOT be injected into non-matching tabs.
    // Poll a few times over 2s to confirm it stays absent (injection happens
    // within ~500ms of load for matching tabs).
    let injected = false;
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 500));
      injected = await page.evaluate(() => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.['e2e-test'] !== undefined;
      });
      if (injected) break;
    }

    expect(injected).toBe(false);

    await page.close();
  });

  test('isReady reflects auth state when called directly in the page', async ({
    mcpServer,
    testServer,
    extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');
    await testServer.reset();

    const page = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    // isReady should be true (auth is on by default)
    const ready1 = await page.evaluate(async () => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as {
        adapters: Record<string, { isReady: () => Promise<boolean> } | undefined>;
      };
      const adapter = ot.adapters['e2e-test'];
      if (!adapter) throw new Error('e2e-test adapter not found');
      return adapter.isReady();
    });
    expect(ready1).toBe(true);

    // Toggle auth off
    await testServer.setAuth(false);

    const ready2 = await page.evaluate(async () => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as {
        adapters: Record<string, { isReady: () => Promise<boolean> } | undefined>;
      };
      const adapter = ot.adapters['e2e-test'];
      if (!adapter) throw new Error('e2e-test adapter not found');
      return adapter.isReady();
    });
    expect(ready2).toBe(false);

    // Restore
    await testServer.setAuth(true);

    const ready3 = await page.evaluate(async () => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as {
        adapters: Record<string, { isReady: () => Promise<boolean> } | undefined>;
      };
      const adapter = ot.adapters['e2e-test'];
      if (!adapter) throw new Error('e2e-test adapter not found');
      return adapter.isReady();
    });
    expect(ready3).toBe(true);

    await page.close();
  });

  test('injected adapter __adapterHash matches the manifest adapterHash', async ({
    mcpServer,
    testServer,
    extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, 'tab.syncAll received');
    await testServer.reset();

    const page = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

    // Read expected hash from the embedded hash-setter in the adapter IIFE
    const iifePath = path.join(E2E_TEST_PLUGIN_DIR, 'dist', 'adapter.iife.js');
    const iifeContent = fs.readFileSync(iifePath, 'utf-8');
    const hashMatch = iifeContent.match(/\.__adapterHash="([0-9a-f]{64})"/);
    expect(hashMatch).not.toBeNull();
    const expectedHash = hashMatch?.[1];
    expect(expectedHash).toBeDefined();
    expect(typeof expectedHash).toBe('string');
    expect((expectedHash as string).length).toBe(64);

    // Read actual hash from the injected adapter in the page
    const actualHash = await page.evaluate(() => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as
        | { adapters?: Record<string, { __adapterHash?: string }> }
        | undefined;
      return ot?.adapters?.['e2e-test']?.__adapterHash;
    });

    expect(actualHash).toBe(expectedHash);

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Sequential tool calls — verifies no state leaks
// ---------------------------------------------------------------------------

test.describe('Sequential tool calls', () => {
  test('multiple different tools in sequence all return correct results', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow(); // 7 sequential tool calls — needs extra time under parallel load

    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Verify extension is still connected before starting the barrage
    const h = await mcpServer.health();
    if (!h?.extensionConnected) {
      throw new Error(
        `Extension not connected before sequential calls.\n` +
          `Health: ${JSON.stringify(h)}\n` +
          `MCP server logs (last 10):\n${mcpServer.logs.slice(-10).join('\n')}`,
      );
    }

    const echoOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'seq-1' });
    expect(echoOutput.message).toBe('seq-1');

    const greetOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_greet', { name: 'Sequential' });
    expect(greetOutput.greeting).toBe('Hello, Sequential!');

    const statusOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_get_status', {});
    expect(statusOutput.version).toBe('1.0.0-test');

    const createOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_create_item', { name: 'SeqItem' });
    expect((createOutput.item as Record<string, unknown>).name).toBe('SeqItem');

    const listOutput = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_list_items', { limit: 100 });
    const items = listOutput.items as Array<{ name: string }>;
    expect(items.some(i => i.name === 'SeqItem')).toBe(true);

    // Failing tool should fail without affecting subsequent calls
    const failResult = await mcpClient.callTool('e2e-test_failing_tool', {});
    expect(failResult.isError).toBe(true);

    // Verify tools still work after a failure
    const echo2Output = await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'after-fail' });
    expect(echo2Output.message).toBe('after-fail');

    await page.close();
  });
});
