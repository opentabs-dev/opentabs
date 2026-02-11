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
 *   - `bun run build` has been run (platform dist/ files exist)
 *   - `plugins/e2e-test` has been built (`cd plugins/e2e-test && bun run build`)
 *   - Chromium is installed for Playwright
 *
 * All tests use dynamic ports and are safe for parallel execution.
 */

import {
  test,
  expect,
  type McpServer,
  type McpClient,
  type TestServer,
} from "./fixtures.js";
import type { BrowserContext, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Time to wait after opening a tab for the extension's isReady() probe to
 *  complete and for the MCP server to register the tab state. */
const READY_SETTLE_MS = 3_000;

async function waitForLog(
  server: McpServer,
  substring: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.logs.join("\n").includes(substring)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `waitForLog timed out after ${timeoutMs}ms waiting for "${substring}".\n` +
      `Logs so far:\n${server.logs.join("\n")}`,
  );
}

async function waitForExtensionConnected(
  server: McpServer,
  timeoutMs = 45_000,
): Promise<void> {
  await server.waitForHealth((h) => h.extensionConnected === true, timeoutMs);
}

/**
 * Open the test app tab and wait for the adapter to be injected.
 * Polls with rich diagnostics — fails fast with context.
 */
async function openTestAppTab(
  context: BrowserContext,
  testServerUrl: string,
  mcpServer?: McpServer,
  testServer?: TestServer,
  timeoutMs = 20_000,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(testServerUrl, { waitUntil: "load" });

  const deadline = Date.now() + timeoutMs;
  let lastDiag = "";

  while (Date.now() < deadline) {
    const injected = await page.evaluate(() => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as
        | { adapters?: Record<string, unknown> }
        | undefined;
      return {
        hasOpenTabs: ot != null,
        hasAdapters: ot?.adapters != null,
        hasE2eTest: ot?.adapters?.["e2e-test"] != null,
        adapterNames: ot?.adapters ? Object.keys(ot.adapters) : [],
      };
    });

    if (injected.hasE2eTest) {
      return page;
    }

    // Build diagnostic snapshot periodically
    if (Date.now() % 2000 < 500) {
      const parts: string[] = [
        `adapter: openTabs=${injected.hasOpenTabs}, adapters=${injected.hasAdapters}, e2e-test=${injected.hasE2eTest}, names=[${injected.adapterNames.join(",")}]`,
      ];

      if (mcpServer) {
        const h = await mcpServer.health().catch(() => null);
        parts.push(
          `mcp: ${h ? `connected=${h.extensionConnected}, plugins=${h.plugins}` : "unreachable"}`,
        );
      }

      if (testServer) {
        try {
          const diag = (await testServer.controlGet("diagnostics")) as Record<
            string,
            unknown
          >;
          const counts = diag.counts as Record<string, number> | undefined;
          parts.push(
            `testServer: authChecks=${counts?.authCheckCalls ?? "?"}, adapterLikely=${diag.adapterLikelyInjected ?? "?"}`,
          );
        } catch {
          parts.push("testServer: unreachable");
        }
      }

      lastDiag = parts.join(" | ");
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  const finalParts: string[] = [`Adapter not injected after ${timeoutMs}ms`];
  finalParts.push(`Last diagnostic: ${lastDiag}`);
  if (mcpServer) {
    finalParts.push(
      `MCP server logs (last 10):\n${mcpServer.logs.slice(-10).join("\n")}`,
    );
  }
  finalParts.push(`Tab URL: ${page.url()}`);

  await page.close();
  throw new Error(finalParts.join("\n\n"));
}

function parseToolResult(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

/**
 * Standard test preamble: wait for extension, open tab, settle, init MCP client.
 * Returns the page handle.
 */
async function setupToolTest(
  mcpServer: McpServer,
  testServer: TestServer,
  extensionContext: BrowserContext,
  mcpClient: McpClient,
): Promise<Page> {
  await waitForExtensionConnected(mcpServer);
  await waitForLog(mcpServer, "tab.syncAll received");
  await testServer.reset();

  const page = await openTestAppTab(
    extensionContext,
    testServer.url,
    mcpServer,
    testServer,
  );
  await new Promise((r) => setTimeout(r, READY_SETTLE_MS));
  await mcpClient.initialize();
  return page;
}

/**
 * Call a tool and throw with diagnostics if the result is unexpectedly an error.
 */
async function callToolExpectSuccess(
  mcpClient: McpClient,
  mcpServer: McpServer,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await mcpClient.callTool(toolName, args);
  if (result.isError) {
    throw new Error(
      `${toolName} returned isError=true.\n` +
        `Content: ${result.content}\n` +
        `MCP server logs (last 5):\n${mcpServer.logs.slice(-5).join("\n")}`,
    );
  }
  return parseToolResult(result.content);
}

// ---------------------------------------------------------------------------
// Tool dispatch — full stack roundtrip
// ---------------------------------------------------------------------------

test.describe("Tool dispatch — full stack", () => {
  test("echo tool: message roundtrips through MCP → extension → adapter → test server → back", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    // List tools — e2e-test tools should be present
    const tools = await mcpClient.listTools();
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("e2e-test_echo");
    expect(toolNames).toContain("e2e-test_greet");
    expect(toolNames).toContain("e2e-test_list_items");
    expect(toolNames).toContain("e2e-test_get_status");
    expect(toolNames).toContain("e2e-test_create_item");
    expect(toolNames).toContain("e2e-test_failing_tool");

    // Call echo tool
    const output = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_echo",
      { message: "hello from e2e" },
    );
    expect(output.ok).toBe(true);
    expect(output.message).toBe("hello from e2e");

    // Verify the test server recorded the invocation
    const invocations = await testServer.invocations();
    const echoInvocations = invocations.filter((i) => i.path === "/api/echo");
    expect(echoInvocations.length).toBeGreaterThanOrEqual(1);
    const lastEcho = echoInvocations[echoInvocations.length - 1];
    expect((lastEcho.body as Record<string, unknown>).message).toBe(
      "hello from e2e",
    );

    await page.close();
  });

  test("greet tool: server computes output from input", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    const output = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_greet",
      { name: "Playwright" },
    );
    expect(output.ok).toBe(true);
    expect(output.greeting).toBe("Hello, Playwright!");

    await page.close();
  });

  test("list_items tool: returns paginated array with defaults", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    const output = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_list_items",
      {},
    );
    expect(output.ok).toBe(true);
    expect(Array.isArray(output.items)).toBe(true);
    expect((output.items as unknown[]).length).toBeGreaterThan(0);
    expect(typeof output.total).toBe("number");

    await page.close();
  });

  test("list_items tool: respects limit and offset params", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    const output = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_list_items",
      { limit: 2, offset: 1 },
    );
    expect(output.ok).toBe(true);
    const items = output.items as Array<{ id: string; name: string }>;
    expect(items.length).toBe(2);
    expect(items[0].name).toBe("Bravo");
    expect(items[1].name).toBe("Charlie");

    await page.close();
  });

  test("get_status tool: zero-input tool returns server state", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    const output = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_get_status",
      {},
    );
    expect(output.ok).toBe(true);
    expect(output.authenticated).toBe(true);
    expect(typeof output.uptime).toBe("number");
    expect(output.version).toBe("1.0.0-test");

    await page.close();
  });

  test("create_item tool: creates a resource and returns its ID", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    const output = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_create_item",
      { name: "Test Item", description: "Created during E2E test" },
    );
    expect(output.ok).toBe(true);
    const item = output.item as Record<string, unknown>;
    expect(item.name).toBe("Test Item");
    expect(item.description).toBe("Created during E2E test");
    expect(typeof item.id).toBe("string");
    expect(typeof item.created_at).toBe("string");

    // Verify it was actually persisted
    const listOutput = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_list_items",
      { limit: 100 },
    );
    const allItems = listOutput.items as Array<{ id: string; name: string }>;
    expect(allItems.some((i) => i.name === "Test Item")).toBe(true);

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

test.describe("Error propagation", () => {
  test("failing_tool: ToolError propagates through the full stack as MCP error", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    const result = await mcpClient.callTool("e2e-test_failing_tool", {
      error_code: "not_found",
      error_message: "Item does not exist",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Item does not exist");

    await page.close();
  });

  test("failing_tool with defaults: uses default error code and message", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    const result = await mcpClient.callTool("e2e-test_failing_tool", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("This tool always fails");

    await page.close();
  });

  test("auth off: extension returns unavailable (-32002) because isReady()=false", async ({
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
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    // First verify echo works while authenticated
    const okResult = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_echo",
      { message: "before auth off" },
    );
    expect(okResult.message).toBe("before auth off");

    // Toggle auth off
    await testServer.setAuth(false);

    // Wait for the extension to notice (it re-probes on next dispatch)
    await new Promise((r) => setTimeout(r, 1_000));

    // Now echo should fail with "unavailable" (not "not_authed")
    const failResult = await mcpClient.callTool("e2e-test_echo", {
      message: "after auth off",
    });
    expect(failResult.isError).toBe(true);
    expect(failResult.content.toLowerCase()).toMatch(/unavailable|not ready/);

    // Toggle auth back on
    await testServer.setAuth(true);
    await new Promise((r) => setTimeout(r, 1_000));

    // Should work again
    const recoveredOutput = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_echo",
      { message: "auth restored" },
    );
    expect(recoveredOutput.message).toBe("auth restored");

    await page.close();
  });

  test("error mode: isReady returns false because auth.check gets 500 → tools unavailable", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    // When error mode is on, ALL endpoints return 500 — including /api/auth.check.
    // isReady() catches the error and returns false → extension returns -32002.
    // This is correct: server errors make the service unavailable, not just errored.
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    // Enable error mode
    await testServer.setError(true);
    await new Promise((r) => setTimeout(r, 1_000));

    // Tools should fail with unavailable
    const echoResult = await mcpClient.callTool("e2e-test_echo", {
      message: "should fail",
    });
    expect(echoResult.isError).toBe(true);

    // Disable error mode
    await testServer.setError(false);
    await new Promise((r) => setTimeout(r, 1_000));

    // Tools should recover
    const recoveredOutput = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_echo",
      { message: "recovered" },
    );
    expect(recoveredOutput.message).toBe("recovered");

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Tab state transitions
// ---------------------------------------------------------------------------

test.describe("Tab state transitions", () => {
  test("no matching tab → tool dispatch returns -32001 (closed)", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, "tab.syncAll received");
    await testServer.reset();
    await mcpClient.initialize();

    // Don't open any tab to the test server.
    const result = await mcpClient.callTool("e2e-test_echo", {
      message: "no tab",
    });
    expect(result.isError).toBe(true);
    expect(result.content.toLowerCase()).toMatch(/closed|no matching tab/);
  });

  test("tab open + auth on → tool works; toggle auth off → unavailable; toggle back → works", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    // Tool should work (ready)
    const readyOutput = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_echo",
      { message: "ready state" },
    );
    expect(readyOutput.message).toBe("ready state");

    // Toggle auth off → isReady=false → unavailable
    await testServer.setAuth(false);
    // Force page reload so extension re-probes on onUpdated
    await page.reload({ waitUntil: "load" });
    // Wait for adapter re-injection and settle
    await page.waitForFunction(
      () => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.["e2e-test"] != null;
      },
      { timeout: 10_000 },
    );
    await new Promise((r) => setTimeout(r, 2_000));

    // Tool dispatch should fail with unavailable
    const unavailResult = await mcpClient.callTool("e2e-test_echo", {
      message: "unavailable state",
    });
    expect(unavailResult.isError).toBe(true);
    expect(unavailResult.content.toLowerCase()).toMatch(
      /unavailable|not ready/,
    );

    // Toggle auth back on
    await testServer.setAuth(true);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(
      () => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, unknown> }
          | undefined;
        return ot?.adapters?.["e2e-test"] != null;
      },
      { timeout: 10_000 },
    );
    await new Promise((r) => setTimeout(r, READY_SETTLE_MS));

    // Tool should work again
    const recoveredOutput = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_echo",
      { message: "recovered state" },
    );
    expect(recoveredOutput.message).toBe("recovered state");

    await page.close();
  });

  test("close tab → tool fails → reopen tab → tool works again", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    // Tool works with tab open
    const okOutput = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_echo",
      { message: "tab open" },
    );
    expect(okOutput.message).toBe("tab open");

    // Close the tab
    await page.close();
    await new Promise((r) => setTimeout(r, 2_000));

    // Tool dispatch should now fail (closed)
    const closedResult = await mcpClient.callTool("e2e-test_echo", {
      message: "tab closed",
    });
    expect(closedResult.isError).toBe(true);

    // Reopen the tab
    const page2 = await openTestAppTab(
      extensionContext,
      testServer.url,
      mcpServer,
      testServer,
    );
    await new Promise((r) => setTimeout(r, READY_SETTLE_MS));

    // Tool should work again
    const reopenOutput = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_echo",
      { message: "tab reopened" },
    );
    expect(reopenOutput.message).toBe("tab reopened");

    await page2.close();
  });
});

// ---------------------------------------------------------------------------
// Console.warn transparency logging
// ---------------------------------------------------------------------------

test.describe("Console.warn transparency logging", () => {
  test("tool invocation logs [OpenTabs] warning in the target tab console", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    // Capture console.warn messages from the page
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") {
        warnings.push(msg.text());
      }
    });

    // Invoke a tool
    await callToolExpectSuccess(mcpClient, mcpServer, "e2e-test_echo", {
      message: "console test",
    });

    // Give the warning time to propagate
    await new Promise((r) => setTimeout(r, 1_000));

    // Verify the console.warn format: "[OpenTabs] e2e-test.echo invoked — <link>"
    const openTabsWarning = warnings.find((w) => w.includes("[OpenTabs]"));
    expect(openTabsWarning).toBeDefined();
    expect(openTabsWarning).toContain("e2e-test");
    expect(openTabsWarning).toContain("echo");
    expect(openTabsWarning).toContain("invoked");

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Invocation recording
// ---------------------------------------------------------------------------

test.describe("Invocation recording", () => {
  test("test server records all API calls made by the plugin", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );
    // Clear invocations AFTER setup (setup generates auth.check calls)
    await testServer.reset();

    // Make several tool calls
    await callToolExpectSuccess(mcpClient, mcpServer, "e2e-test_echo", {
      message: "inv-1",
    });
    await callToolExpectSuccess(mcpClient, mcpServer, "e2e-test_greet", {
      name: "Tester",
    });
    await callToolExpectSuccess(mcpClient, mcpServer, "e2e-test_list_items", {
      limit: 3,
    });
    await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_get_status",
      {},
    );
    await callToolExpectSuccess(mcpClient, mcpServer, "e2e-test_create_item", {
      name: "Recorded",
    });

    // Fetch invocation log from the test server
    const invocations = await testServer.invocations();
    const toolInvocations = invocations.filter(
      (i) => i.path !== "/api/auth.check",
    );

    const paths = toolInvocations.map((i) => i.path);
    expect(paths).toContain("/api/echo");
    expect(paths).toContain("/api/greet");
    expect(paths).toContain("/api/list-items");
    expect(paths).toContain("/api/status");
    expect(paths).toContain("/api/create-item");

    // Verify bodies were correctly relayed
    const echoInv = toolInvocations.find((i) => i.path === "/api/echo");
    expect(echoInv).toBeDefined();
    expect((echoInv!.body as Record<string, unknown>).message).toBe("inv-1");

    const greetInv = toolInvocations.find((i) => i.path === "/api/greet");
    expect(greetInv).toBeDefined();
    expect((greetInv!.body as Record<string, unknown>).name).toBe("Tester");

    const createInv = toolInvocations.find(
      (i) => i.path === "/api/create-item",
    );
    expect(createInv).toBeDefined();
    expect((createInv!.body as Record<string, unknown>).name).toBe("Recorded");

    await page.close();
  });

  test("invocations are ordered chronologically", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );
    await testServer.reset();

    await callToolExpectSuccess(mcpClient, mcpServer, "e2e-test_echo", {
      message: "first",
    });
    await callToolExpectSuccess(mcpClient, mcpServer, "e2e-test_echo", {
      message: "second",
    });
    await callToolExpectSuccess(mcpClient, mcpServer, "e2e-test_echo", {
      message: "third",
    });

    const invocations = await testServer.invocations();
    const echoInvocations = invocations.filter((i) => i.path === "/api/echo");
    expect(echoInvocations.length).toBeGreaterThanOrEqual(3);

    // Timestamps should be ascending
    for (let i = 1; i < echoInvocations.length; i++) {
      expect(echoInvocations[i].ts).toBeGreaterThanOrEqual(
        echoInvocations[i - 1].ts,
      );
    }

    // Messages should match order
    const lastThree = echoInvocations.slice(-3);
    expect((lastThree[0].body as Record<string, unknown>).message).toBe(
      "first",
    );
    expect((lastThree[1].body as Record<string, unknown>).message).toBe(
      "second",
    );
    expect((lastThree[2].body as Record<string, unknown>).message).toBe(
      "third",
    );

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Adapter injection
// ---------------------------------------------------------------------------

test.describe("Adapter injection", () => {
  test("adapter is injected into matching tab and exposes isReady + tools", async ({
    mcpServer,
    testServer,
    extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, "tab.syncAll received");
    await testServer.reset();

    const page = await openTestAppTab(
      extensionContext,
      testServer.url,
      mcpServer,
      testServer,
    );

    const adapterInfo = await page.evaluate(() => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as
        | { adapters?: Record<string, unknown> }
        | undefined;
      const adapter = ot?.adapters?.["e2e-test"] as
        | {
            name: string;
            tools: Array<{ name: string }>;
            isReady: () => Promise<boolean>;
          }
        | undefined;
      if (!adapter) return null;
      return {
        name: adapter.name,
        toolNames: adapter.tools.map((t) => t.name),
        hasIsReady: typeof adapter.isReady === "function",
      };
    });

    expect(adapterInfo).not.toBeNull();
    expect(adapterInfo!.name).toBe("e2e-test");
    expect(adapterInfo!.hasIsReady).toBe(true);
    expect(adapterInfo!.toolNames).toContain("echo");
    expect(adapterInfo!.toolNames).toContain("greet");
    expect(adapterInfo!.toolNames).toContain("list_items");
    expect(adapterInfo!.toolNames).toContain("get_status");
    expect(adapterInfo!.toolNames).toContain("create_item");
    expect(adapterInfo!.toolNames).toContain("failing_tool");

    await page.close();
  });

  test("adapter is NOT injected into non-matching tabs", async ({
    mcpServer,
    extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);

    const page = await extensionContext.newPage();
    await page.goto("https://example.com", {
      waitUntil: "load",
      timeout: 15_000,
    });
    await new Promise((r) => setTimeout(r, 3_000));

    const hasAdapter = await page.evaluate(() => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as
        | { adapters?: Record<string, unknown> }
        | undefined;
      return ot?.adapters?.["e2e-test"] != null;
    });

    expect(hasAdapter).toBe(false);

    await page.close();
  });

  test("isReady reflects auth state when called directly in the page", async ({
    mcpServer,
    testServer,
    extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, "tab.syncAll received");
    await testServer.reset();

    const page = await openTestAppTab(
      extensionContext,
      testServer.url,
      mcpServer,
      testServer,
    );

    // isReady should be true (auth is on by default)
    const ready1 = await page.evaluate(async () => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as {
        adapters: Record<string, { isReady: () => Promise<boolean> }>;
      };
      return ot.adapters["e2e-test"].isReady();
    });
    expect(ready1).toBe(true);

    // Toggle auth off
    await testServer.setAuth(false);

    const ready2 = await page.evaluate(async () => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as {
        adapters: Record<string, { isReady: () => Promise<boolean> }>;
      };
      return ot.adapters["e2e-test"].isReady();
    });
    expect(ready2).toBe(false);

    // Restore
    await testServer.setAuth(true);

    const ready3 = await page.evaluate(async () => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as {
        adapters: Record<string, { isReady: () => Promise<boolean> }>;
      };
      return ot.adapters["e2e-test"].isReady();
    });
    expect(ready3).toBe(true);

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Sequential tool calls — verifies no state leaks
// ---------------------------------------------------------------------------

test.describe("Sequential tool calls", () => {
  test("multiple different tools in sequence all return correct results", async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    test.slow(); // 7 sequential tool calls — needs extra time under parallel load

    const page = await setupToolTest(
      mcpServer,
      testServer,
      extensionContext,
      mcpClient,
    );

    // Verify extension is still connected before starting the barrage
    const h = await mcpServer.health();
    if (!h || !h.extensionConnected) {
      throw new Error(
        `Extension not connected before sequential calls.\n` +
          `Health: ${JSON.stringify(h)}\n` +
          `MCP server logs (last 10):\n${mcpServer.logs.slice(-10).join("\n")}`,
      );
    }

    const echoOutput = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_echo",
      { message: "seq-1" },
    );
    expect(echoOutput.message).toBe("seq-1");

    const greetOutput = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_greet",
      { name: "Sequential" },
    );
    expect(greetOutput.greeting).toBe("Hello, Sequential!");

    const statusOutput = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_get_status",
      {},
    );
    expect(statusOutput.version).toBe("1.0.0-test");

    const createOutput = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_create_item",
      { name: "SeqItem" },
    );
    expect((createOutput.item as Record<string, unknown>).name).toBe("SeqItem");

    const listOutput = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_list_items",
      { limit: 100 },
    );
    const items = listOutput.items as Array<{ name: string }>;
    expect(items.some((i) => i.name === "SeqItem")).toBe(true);

    // Failing tool should fail without affecting subsequent calls
    const failResult = await mcpClient.callTool("e2e-test_failing_tool", {});
    expect(failResult.isError).toBe(true);

    // Verify tools still work after a failure
    const echo2Output = await callToolExpectSuccess(
      mcpClient,
      mcpServer,
      "e2e-test_echo",
      { message: "after-fail" },
    );
    expect(echo2Output.message).toBe("after-fail");

    await page.close();
  });
});
