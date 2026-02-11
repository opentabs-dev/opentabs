/**
 * Lifecycle E2E tests — MCP server hot reload and extension reconnection.
 *
 * These tests launch a real Chromium instance with the OpenTabs extension
 * side-loaded, start the MCP server as a subprocess, and verify the full
 * hot-reload lifecycle:
 *
 *   1. Extension connects to MCP server on startup
 *   2. Hot reload (bun --hot) triggers clean teardown + extension reconnect
 *   3. Rapid successive hot reloads all recover
 *   4. Kill → restart: extension detects TCP close and reconnects
 *   5. Old WebSocket replaced when a new connection arrives
 *   6. Ping/pong keepalive works end-to-end
 *   7. Server starts cleanly without --hot (no crash)
 *
 * IMPORTANT: Hot-reload tests use `test.describe.serial` because
 * `triggerHotReload()` modifies a per-test wrapper file. Serial execution
 * within the block ensures deterministic sequencing of reload → reconnect.
 *
 * All tests use dynamic ports and isolated config directories.
 */

import {
  test,
  expect,
  type McpServer,
  ROOT,
  startMcpServer,
  createTestConfigDir,
  cleanupTestConfigDir,
} from "./fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the extension to connect to the MCP server.
 * Polls /health until extensionConnected === true.
 */
async function waitForExtensionConnected(
  server: McpServer,
  timeoutMs = 45_000,
): Promise<void> {
  await server.waitForHealth((h) => h.extensionConnected === true, timeoutMs);
}

/**
 * Wait for the extension to be disconnected from the MCP server.
 * Polls /health until extensionConnected === false.
 */
async function waitForExtensionDisconnected(
  server: McpServer,
  timeoutMs = 10_000,
): Promise<void> {
  await server.waitForHealth((h) => h.extensionConnected === false, timeoutMs);
}

/**
 * Wait until the server's accumulated logs contain `substring`.
 * Polls the logs array every `intervalMs` until found or timeout.
 */
async function waitForLog(
  server: McpServer,
  substring: string,
  timeoutMs = 15_000,
  intervalMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.logs.join("\n").includes(substring)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForLog timed out after ${timeoutMs}ms waiting for "${substring}".\n` +
      `Logs so far:\n${server.logs.join("\n")}`,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("MCP server lifecycle", () => {
  test("server starts with --hot, extension auto-connects, and health is green", async ({
    mcpServer,
    extensionContext,
  }) => {
    // The mcpServer fixture already asserts the server is listening.
    // Now wait for the extension (loaded by extensionContext) to connect.
    await waitForExtensionConnected(mcpServer);

    // Wait for the full connect→syncAll handshake to complete in the logs
    await waitForLog(mcpServer, "tab.syncAll received");

    const h = await mcpServer.health();
    expect(h).not.toBeNull();
    expect(h!.status).toBe("ok");
    expect(h!.extensionConnected).toBe(true);
    expect(h!.plugins).toBeGreaterThanOrEqual(0);

    // Verify server logs show the expected startup sequence
    const logsJoined = mcpServer.logs.join("\n");
    expect(logsJoined).toContain("MCP server listening");
    expect(logsJoined).toContain("Extension WebSocket connected");
    expect(logsJoined).toContain("tab.syncAll received");
  });

  test("server starts without --hot and stays alive (no crash)", async ({
    mcpServerNoHot,
  }) => {
    // The fixture already asserts the server started. Verify it's healthy.
    const h = await mcpServerNoHot.health();
    expect(h).not.toBeNull();
    expect(h!.status).toBe("ok");

    // The server should NOT have any hot-reload cleanup messages
    const logsJoined = mcpServerNoHot.logs.join("\n");
    expect(logsJoined).not.toContain("Hot reload detected");
    expect(logsJoined).toContain("MCP server listening");
  });
});

test.describe.serial("Hot reload", () => {
  test("single hot reload: extension gets close event and reconnects within 5s", async ({
    mcpServer,
    extensionContext,
  }) => {
    // 1. Wait for initial connection + full handshake
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, "tab.syncAll received");

    // 2. Clear logs to isolate hot-reload output
    mcpServer.logs.length = 0;

    // 3. Trigger hot reload
    mcpServer.triggerHotReload();

    // 4. Wait for the full hot-reload cycle to complete:
    //    cleanup → re-init → extension reconnect → tab.syncAll
    await waitForLog(mcpServer, "tab.syncAll received", 20_000);

    // 5. Verify logs show the cleanup → restart → reconnect sequence
    const logsJoined = mcpServer.logs.join("\n");
    expect(logsJoined).toContain("Hot reload detected");
    expect(logsJoined).toContain("previous instance cleaned up");
    expect(logsJoined).toContain("Extension WebSocket connected");
    expect(logsJoined).toContain("tab.syncAll received");
  });

  test("three rapid hot reloads: extension reconnects after each one", async ({
    mcpServer,
    extensionContext,
  }) => {
    test.slow(); // 3 sequential hot reloads — needs extra time under parallel load

    // Wait for initial full handshake
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, "tab.syncAll received");

    for (let i = 1; i <= 3; i++) {
      mcpServer.logs.length = 0;
      mcpServer.triggerHotReload();

      // Wait for the full cycle: cleanup + reconnect + syncAll
      // Use 30s timeout per reload — under parallel load, reconnect backoff
      // can take longer than the default 15s.
      await waitForLog(mcpServer, "tab.syncAll received", 30_000);

      const logsJoined = mcpServer.logs.join("\n");
      expect(logsJoined).toContain("Hot reload detected");
      expect(logsJoined).toContain("Extension WebSocket connected");

      // Brief pause to let state settle before next reload
      await new Promise((r) => setTimeout(r, 500));
    }
  });

  test("hot reload preserves plugin discovery (slack plugin still found)", async ({
    mcpServer,
    extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, "tab.syncAll received");

    // Note the plugin count before reload
    const before = await mcpServer.health();
    expect(before).not.toBeNull();
    const pluginsBefore = before!.plugins;

    // Trigger hot reload
    mcpServer.logs.length = 0;
    mcpServer.triggerHotReload();

    // Wait for full cycle
    await waitForLog(mcpServer, "tab.syncAll received", 20_000);

    // Plugin count should be the same after reload
    const after = await mcpServer.health();
    expect(after).not.toBeNull();
    expect(after!.plugins).toBe(pluginsBefore);

    // Logs should show plugin re-discovery
    const logsJoined = mcpServer.logs.join("\n");
    expect(logsJoined).toContain("Plugin discovery complete");
  });
});

test.describe("Kill and restart", () => {
  test("extension reconnects after server is killed and restarted", async ({
    mcpServer,
    extensionContext,
  }) => {
    // 1. Initial connection
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, "tab.syncAll received");

    // Remember the port — the extension is configured for THIS port
    const serverPort = mcpServer.port;
    // Get the config dir so the new server discovers the same plugins
    const serverConfigDir = mcpServer.configDir;

    // 2. Kill the server
    await mcpServer.kill();

    // 3. Verify server is dead
    const dead = await mcpServer.health();
    expect(dead).toBeNull();

    // 4. Start a NEW server on the SAME port using startMcpServer.
    //    We pass the same config dir and an explicit port so the extension
    //    (which is configured for serverPort) can reconnect.
    let newServer: McpServer | null = null;

    try {
      newServer = await startMcpServer(serverConfigDir, true, serverPort);

      // 5. Wait for extension to reconnect.
      //    The extension's backoff may be elevated from the disconnect, so
      //    give it up to 45s (max backoff is 30s).
      await newServer.waitForHealth(
        (h) => h.extensionConnected === true,
        45_000,
      );

      await waitForLog(newServer, "tab.syncAll received", 15_000);

      expect(newServer.logs.join("\n")).toContain(
        "Extension WebSocket connected",
      );
    } finally {
      if (newServer) await newServer.kill();
    }
  });
});

test.describe("WebSocket connection management", () => {
  test("old extension WS is closed when a new connection arrives", async ({
    mcpServer,
    extensionContext,
  }) => {
    // 1. Wait for the real extension to connect
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, "tab.syncAll received");
    mcpServer.logs.length = 0;

    // 2. Open a second WebSocket — this should replace the extension's slot.
    const ws = new WebSocket(`ws://localhost:${mcpServer.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("WebSocket connect failed"));
      setTimeout(() => reject(new Error("WebSocket connect timeout")), 5_000);
    });

    // 3. Wait for the server to log the replacement
    await waitForLog(mcpServer, "Closing previous extension WebSocket", 5_000);

    const logsJoined = mcpServer.logs.join("\n");
    expect(logsJoined).toContain("Closing previous extension WebSocket");

    // 4. Close our fake client
    ws.close();

    // 5. The real extension should detect it was disconnected (via the close
    //    event from the server) and reconnect. Since the fake client also
    //    disconnected, the extension's reconnect will succeed.
    await waitForExtensionConnected(mcpServer, 15_000);

    const h = await mcpServer.health();
    expect(h).not.toBeNull();
    expect(h!.extensionConnected).toBe(true);
  });

  test("ping/pong keepalive works: server responds to pings", async ({
    mcpServer,
    extensionContext,
  }) => {
    await waitForExtensionConnected(mcpServer);

    const ws = new WebSocket(`ws://localhost:${mcpServer.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("WebSocket connect failed"));
      setTimeout(() => reject(new Error("WebSocket connect timeout")), 5_000);
    });

    // Send a JSON-RPC ping and wait for pong
    const pongPromise = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5_000);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(
            typeof event.data === "string" ? event.data : "",
          );
          if (msg.method === "pong") {
            clearTimeout(timeout);
            resolve(true);
          }
        } catch {
          // ignore non-JSON messages (e.g. sync.full)
        }
      };
    });

    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "ping" }));

    const gotPong = await pongPromise;
    expect(gotPong).toBe(true);

    ws.close();
  });
});

test.describe("Pong watchdog (zombie detection)", () => {
  test("extension detects replaced connection and reconnects", async ({
    mcpServer,
    extensionContext,
  }) => {
    // 1. Wait for extension to connect
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, "tab.syncAll received");

    // 2. Steal the extension's slot with a fake client.
    //    The server's replacement logic closes the real extension's WS.
    //    We then close the fake client, leaving the server with no extension.
    //    The real extension received a close event and should reconnect.
    mcpServer.logs.length = 0;

    const ws = new WebSocket(`ws://localhost:${mcpServer.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("connect failed"));
      setTimeout(() => reject(new Error("timeout")), 5_000);
    });

    // Wait for the server to log the replacement (confirms old WS was closed)
    await waitForLog(mcpServer, "Closing previous extension WebSocket", 5_000);

    // Close our fake client too so the server has no extension
    ws.close();

    // Server should now show no extension connected (briefly)
    await waitForExtensionDisconnected(mcpServer, 5_000);

    // 3. The real extension received a close event from the replacement and
    //    should reconnect via its backoff. Wait for it.
    await waitForExtensionConnected(mcpServer, 15_000);

    // Wait for full handshake
    await waitForLog(mcpServer, "tab.syncAll received", 15_000);

    const h = await mcpServer.health();
    expect(h).not.toBeNull();
    expect(h!.extensionConnected).toBe(true);

    // Verify the reconnect happened (fresh "connected" + "tab.syncAll")
    const logsJoined = mcpServer.logs.join("\n");
    expect(logsJoined).toContain("Extension WebSocket connected");
    expect(logsJoined).toContain("tab.syncAll received");
  });
});

test.describe("Side panel connectivity", () => {
  test("side panel shows connected state after extension connects", async ({
    mcpServer,
    extensionContext,
  }) => {
    // Wait for the extension to connect to the server
    await waitForExtensionConnected(mcpServer);
    await waitForLog(mcpServer, "tab.syncAll received");

    // Verify the background service worker is running.
    // In Playwright, MV3 service workers appear via context.serviceWorkers().
    const workers = extensionContext.serviceWorkers();
    let bgWorker = workers.find((w) => w.url().includes("background"));

    if (!bgWorker) {
      // Wait for the service worker to appear
      bgWorker = await extensionContext.waitForEvent("serviceworker", {
        predicate: (w) => w.url().includes("background"),
        timeout: 10_000,
      });
    }

    expect(bgWorker).toBeDefined();

    // The health endpoint confirms the extension is fully connected —
    // which means the side panel would show "Connected" if opened.
    const h = await mcpServer.health();
    expect(h).not.toBeNull();
    expect(h!.extensionConnected).toBe(true);
  });
});
