/**
 * Shared Playwright fixtures for OpenTabs E2E tests.
 *
 * Designed for PARALLEL execution — each test gets:
 *   - Its own dynamically-allocated ports (MCP server + test server)
 *   - Its own copy of the Chrome extension configured for those ports
 *   - Its own Chromium browser context with the extension loaded
 *   - Its own MCP client for tool dispatch
 *   - Proper cleanup on teardown
 *
 * Fixtures:
 *   - `testPorts`       — dynamically allocated free ports for this test
 *   - `mcpServer`       — MCP server subprocess on a unique port
 *   - `mcpServerNoHot`  — MCP server without --hot
 *   - `testServer`      — controllable test web server on a unique port
 *   - `extensionContext` — Chromium with the extension pointed at this test's MCP port
 *   - `backgroundPage`  — the extension's service-worker
 *   - `mcpClient`       — MCP streamable HTTP client pointed at this test's MCP server
 *
 * Usage in tests:
 *   import { test, expect } from "./fixtures.js";
 */

import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createServer, type Server as NetServer } from "node:net";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, "..");
const EXTENSION_DIR = path.join(ROOT, "platform/browser-extension");
const SERVER_DIST_DIR = path.join(ROOT, "platform/mcp-server/dist");
const TEST_SERVER_ENTRY = path.join(ROOT, "e2e/test-server.ts");
const E2E_TEST_PLUGIN_DIR = path.join(ROOT, "plugins/e2e-test");

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), ".opentabs");

// ---------------------------------------------------------------------------
// Health helper (MCP server)
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: string;
  version: string;
  extensionConnected: boolean;
  mcpClients: number;
  plugins: number;
}

async function fetchHealth(port: number): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
}

async function waitForHealth(
  port: number,
  predicate: (h: HealthResponse) => boolean,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<HealthResponse> {
  const deadline = Date.now() + timeoutMs;
  let last: HealthResponse | null = null;
  while (Date.now() < deadline) {
    last = await fetchHealth(port);
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForHealth timed out after ${timeoutMs}ms. Last: ${JSON.stringify(last)}`,
  );
}

/**
 * Parse the actual port from a server's startup log line.
 * Matches patterns like "listening on http://localhost:12345" or
 * "Listening on http://localhost:12345".
 */
function parsePortFromLogs(logs: string[]): number | null {
  for (const line of logs) {
    const m = line.match(/[Ll]istening on http:\/\/localhost:(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Config management — per-test isolated config directories
// ---------------------------------------------------------------------------

interface OpentabsConfig {
  plugins: string[];
  tools: Record<string, boolean>;
}

/**
 * Create an isolated config directory for a single test.
 * Writes a config.json with the e2e-test plugin registered and all its
 * tools enabled. Returns the path to the temp directory — pass it as
 * OPENTABS_CONFIG_DIR to the MCP server subprocess.
 *
 * This eliminates the shared ~/.opentabs/config.json problem where
 * parallel tests clobber each other's config.
 */
function createTestConfigDir(): string {
  const configDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opentabs-e2e-config-"),
  );

  const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

  const toolNames = [
    "echo",
    "greet",
    "list_items",
    "get_status",
    "create_item",
    "failing_tool",
  ];
  const tools: Record<string, boolean> = {};
  for (const tool of toolNames) {
    tools[`e2e-test_${tool}`] = true;
  }

  const config: OpentabsConfig = {
    plugins: [absPluginPath],
    tools,
  };

  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );

  return configDir;
}

function cleanupTestConfigDir(configDir: string): void {
  try {
    fs.rmSync(configDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// MCP server subprocess manager
// ---------------------------------------------------------------------------

export interface McpServer {
  proc: ChildProcess;
  logs: string[];
  /** The actual port the server is listening on (parsed from startup log). */
  port: number;
  /** The isolated config directory for this server instance (OPENTABS_CONFIG_DIR). */
  configDir: string;
  /** The per-test copy of the server dist directory. */
  distDir: string;
  /** The entry point for this server instance (inside distDir). */
  entryFile: string;
  waitForHealth: (
    predicate: (h: HealthResponse) => boolean,
    timeoutMs?: number,
  ) => Promise<HealthResponse>;
  triggerHotReload: () => void;
  kill: () => Promise<void>;
  health: () => Promise<HealthResponse | null>;
}

/**
 * Create a per-test wrapper file that imports the real server entry.
 *
 * Why a wrapper instead of copying dist/?
 *   - The real dist/index.js imports from node_modules (e.g., @modelcontextprotocol/sdk).
 *     A copy in /tmp/ can't resolve those because node_modules isn't there.
 *   - `bun --hot` watches the file it was invoked with. By giving each test its
 *     own wrapper file, `triggerHotReload()` appends to THAT wrapper — only this
 *     test's bun process sees the change. Other parallel workers are unaffected.
 *
 * The wrapper is a single `import` statement pointing at the real entry via
 * absolute path. Bun re-evaluates the entire import tree on hot reload.
 */
function createServerWrapper(): {
  wrapperDir: string;
  entryFile: string;
  rewriteWrapper: () => void;
} {
  const wrapperDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opentabs-e2e-server-"),
  );
  const entryFile = path.join(wrapperDir, "server.js");

  // Copy ALL dist files into the wrapper dir so bun --hot can watch them
  // and re-evaluate on change. We can't just import the original dist/
  // because ESM module cache means re-importing returns the cached module
  // without re-executing side effects. With a full copy, bun --hot watches
  // these files directly and re-evaluates them from scratch.
  const distCopyDir = path.join(wrapperDir, "dist");
  fs.cpSync(SERVER_DIST_DIR, distCopyDir, { recursive: true });

  // The entry file imports from the local copy (relative paths work for
  // intra-package imports like ./state.js, ./config.js). For node_modules
  // deps (@modelcontextprotocol/sdk etc.), bun resolves from CWD which is
  // set to ROOT in the spawn call.
  const localEntry = path.join(distCopyDir, "index.js");
  fs.writeFileSync(
    entryFile,
    `import ${JSON.stringify(localEntry)};\n`,
    "utf-8",
  );

  // rewriteWrapper: called by triggerHotReload to force bun --hot to
  // re-evaluate. We modify the ACTUAL entry file (the local copy of
  // index.js) because bun --hot watches transitive imports.
  const rewriteWrapper = () => {
    fs.appendFileSync(localEntry, `\n// hot-reload-trigger-${Date.now()}\n`);
  };

  return { wrapperDir, entryFile, rewriteWrapper };
}

/**
 * Start the MCP server subprocess.
 *
 * Pass port=0 to let the OS assign a free port (eliminates TOCTOU race).
 * The actual port is parsed from the server's "MCP server listening on
 * http://localhost:<port>" startup log line.
 *
 * Each test gets its own wrapper file so `triggerHotReload` is isolated
 * from parallel tests — only this server's `bun --hot` sees the file change.
 */
function startMcpServer(
  configDir: string,
  hot: boolean = true,
  explicitPort?: number,
): Promise<McpServer> {
  return new Promise<McpServer>((resolve, reject) => {
    const { wrapperDir, entryFile, rewriteWrapper } = createServerWrapper();
    const args = hot ? ["--hot", entryFile] : [entryFile];

    // PORT=0 → Bun.serve() picks a free ephemeral port, no EADDRINUSE.
    // If explicitPort is provided (e.g., kill/restart test reusing the same
    // port the extension is configured for), use that instead.
    const portStr = explicitPort !== undefined ? String(explicitPort) : "0";

    const proc = spawn("bun", args, {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: portStr,
        OPENTABS_CONFIG_DIR: configDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const logs: string[] = [];
    let resolved = false;

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        if (line.trim()) logs.push(line);
      }
      if (!resolved && text.includes("MCP server listening")) {
        const actualPort = parsePortFromLogs(logs);
        if (!actualPort) {
          resolved = true;
          proc.kill();
          reject(
            new Error(
              `MCP server started but could not parse port from logs.\nLogs:\n${logs.join("\n")}`,
            ),
          );
          return;
        }
        resolved = true;
        // Now that we know the port, wire up the server object
        server.port = actualPort;
        server.health = () => fetchHealth(actualPort);
        server.waitForHealth = (predicate, timeoutMs) =>
          waitForHealth(actualPort, predicate, timeoutMs);
        resolve(server);
      }
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);

    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    proc.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        reject(
          new Error(
            `MCP server exited with code ${code} before ready.\nLogs:\n${logs.join("\n")}`,
          ),
        );
      }
    });

    const server: McpServer = {
      proc,
      logs,
      port: 0, // will be set once the server logs its actual port
      configDir,
      distDir: wrapperDir,
      entryFile,
      health: () => Promise.resolve(null),
      waitForHealth: () => Promise.reject(new Error("Server not started yet")),
      triggerHotReload() {
        // Modify THIS test's isolated copy of the server entry.
        // Only this server's bun --hot watches these files.
        rewriteWrapper();
      },
      async kill() {
        if (proc.exitCode !== null) return;
        return new Promise<void>((res) => {
          proc.on("exit", () => res());
          proc.kill("SIGTERM");
          setTimeout(() => {
            try {
              proc.kill("SIGKILL");
            } catch {
              /* already dead */
            }
            res();
          }, 5_000);
        });
      },
    };

    // Clean up the per-test wrapper directory when the server is killed
    const origKill = server.kill.bind(server);
    server.kill = async () => {
      await origKill();
      try {
        fs.rmSync(wrapperDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    };

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        reject(
          new Error(
            `MCP server did not start within 15s.\nLogs:\n${logs.join("\n")}`,
          ),
        );
      }
    }, 15_000);
  });
}

// ---------------------------------------------------------------------------
// Test web server subprocess manager
// ---------------------------------------------------------------------------

export interface TestServer {
  proc: ChildProcess;
  port: number;
  url: string;
  control: (
    endpoint: string,
    body?: Record<string, unknown>,
  ) => Promise<unknown>;
  controlGet: (endpoint: string) => Promise<unknown>;
  reset: () => Promise<void>;
  setAuth: (authenticated: boolean) => Promise<void>;
  setError: (error: boolean) => Promise<void>;
  setSlow: (delayMs: number) => Promise<void>;
  invocations: () => Promise<
    Array<{ ts: number; method: string; path: string; body: unknown }>
  >;
  kill: () => Promise<void>;
}

/**
 * Start the controllable test web server.
 *
 * PORT=0 lets the OS assign a free port. The actual port is parsed
 * from the server's "Listening on http://localhost:<port>" log line.
 */
function startTestServer(): Promise<TestServer> {
  return new Promise<TestServer>((resolve, reject) => {
    const proc = spawn("bun", [TEST_SERVER_ENTRY], {
      cwd: ROOT,
      env: { ...process.env, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let resolved = false;
    const logs: string[] = [];

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        if (line.trim()) logs.push(line);
      }
      if (!resolved && text.includes("Listening on")) {
        const actualPort = parsePortFromLogs(logs);
        if (!actualPort) {
          resolved = true;
          proc.kill();
          reject(
            new Error(
              `Test server started but could not parse port.\nLogs:\n${logs.join("\n")}`,
            ),
          );
          return;
        }
        resolved = true;
        srv.port = actualPort;
        srv.url = `http://localhost:${actualPort}`;
        resolve(srv);
      }
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);

    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
    proc.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        reject(
          new Error(
            `Test server exited with code ${code}.\nLogs:\n${logs.join("\n")}`,
          ),
        );
      }
    });

    const srv: TestServer = {
      proc,
      port: 0, // will be set once the server logs its actual port
      url: "", // will be set once the server logs its actual port
      async control(endpoint, body = {}) {
        const controlUrl = `${srv.url}/control`;
        const res = await fetch(`${controlUrl}/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5_000),
        });
        return res.json();
      },
      async controlGet(endpoint) {
        const controlUrl = `${srv.url}/control`;
        const res = await fetch(`${controlUrl}/${endpoint}`, {
          signal: AbortSignal.timeout(5_000),
        });
        return res.json();
      },
      async reset() {
        await srv.control("reset");
      },
      async setAuth(authenticated) {
        await srv.control("set-auth", { authenticated });
      },
      async setError(error) {
        await srv.control("set-error", { error });
      },
      async setSlow(delayMs) {
        await srv.control("set-slow", { delayMs });
      },
      async invocations() {
        const data = (await srv.controlGet("invocations")) as {
          invocations: Array<{
            ts: number;
            method: string;
            path: string;
            body: unknown;
          }>;
        };
        return data.invocations;
      },
      async kill() {
        if (proc.exitCode !== null) return;
        return new Promise<void>((res) => {
          proc.on("exit", () => res());
          proc.kill("SIGTERM");
          setTimeout(() => {
            try {
              proc.kill("SIGKILL");
            } catch {
              /* */
            }
            res();
          }, 3_000);
        });
      },
    };

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        reject(new Error("Test server did not start within 10s"));
      }
    }, 10_000);
  });
}

// ---------------------------------------------------------------------------
// Extension context — per-test copy with correct MCP port
// ---------------------------------------------------------------------------

/**
 * Create a copy of the extension directory with the MCP server URL
 * baked directly into the offscreen.js file via string replacement.
 *
 * This is the most reliable approach — no async chrome.storage races,
 * no timing issues between background and offscreen startup. The
 * default URL `ws://localhost:9515/ws` is simply replaced with the
 * test's actual MCP server port.
 */
function createExtensionCopy(mcpPort: number): {
  extensionDir: string;
  userDataDir: string;
} {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "opentabs-e2e-"));
  const extensionDir = path.join(tmpBase, "extension");
  const userDataDir = path.join(tmpBase, "user-data");

  // Copy extension directory recursively
  fs.cpSync(EXTENSION_DIR, extensionDir, { recursive: true });

  // Replace the default MCP server URL in the offscreen document.
  // The compiled offscreen.js contains the string "ws://localhost:9515/ws"
  // (the DEFAULT_MCP_SERVER_URL constant). We replace it with the test port.
  const offscreenPath = path.join(extensionDir, "dist/offscreen/offscreen.js");
  const offscreenCode = fs.readFileSync(offscreenPath, "utf-8");
  const patchedCode = offscreenCode.replace(
    /ws:\/\/localhost:9515\/ws/g,
    `ws://localhost:${mcpPort}/ws`,
  );
  if (patchedCode === offscreenCode) {
    throw new Error(
      `Failed to patch offscreen.js — could not find "ws://localhost:9515/ws" in ${offscreenPath}`,
    );
  }
  fs.writeFileSync(offscreenPath, patchedCode, "utf-8");

  fs.mkdirSync(userDataDir, { recursive: true });

  return { extensionDir, userDataDir };
}

async function launchExtensionContext(
  mcpPort: number,
): Promise<{ context: BrowserContext; cleanupDir: string; mcpPort: number }> {
  const { extensionDir, userDataDir } = createExtensionCopy(mcpPort);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-features=Translate",
      "--disable-popup-blocking",
    ],
    timeout: 30_000,
  });

  return { context, cleanupDir: path.dirname(extensionDir), mcpPort };
}

async function getBackgroundPage(
  context: BrowserContext,
  timeoutMs = 15_000,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const sw of context.serviceWorkers()) {
      if (sw.url().includes("background")) {
        return sw as unknown as Page;
      }
    }
    for (const page of context.backgroundPages()) {
      if (page.url().includes("background")) {
        return page;
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  throw new Error(
    `Could not find extension background page within ${timeoutMs}ms`,
  );
}

// ---------------------------------------------------------------------------
// MCP Client — calls tools through the MCP streamable HTTP API
// ---------------------------------------------------------------------------

export interface McpClient {
  initialize: () => Promise<void>;
  listTools: () => Promise<Array<{ name: string; description: string }>>;
  callTool: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ content: string; isError: boolean }>;
  close: () => Promise<void>;
  sessionId: string | null;
}

function createMcpClient(port: number): McpClient {
  let sessionId: string | null = null;
  let nextId = 1;

  const mcpUrl = `http://localhost:${port}/mcp`;

  async function request(body: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) {
      headers["mcp-session-id"] = sessionId;
    }
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`MCP request failed (${res.status}): ${text}`);
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;

    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      return (await res.json()) as Record<string, unknown>;
    }

    // SSE response — parse data: lines
    const text = await res.text();
    const dataLines = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());

    const messages: Record<string, unknown>[] = [];
    for (const raw of dataLines) {
      try {
        messages.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        // skip non-JSON
      }
    }

    if (messages.length === 0) {
      throw new Error(
        `MCP SSE response had no JSON-RPC messages.\nRaw:\n${text.slice(0, 2000)}`,
      );
    }

    const reqId = (body as Record<string, unknown>).id;
    if (reqId !== undefined) {
      const match = messages.find(
        (m) => m.id === reqId && ("result" in m || "error" in m),
      );
      if (match) return match;
    }

    const lastResponse = [...messages]
      .reverse()
      .find((m) => "result" in m || "error" in m);
    if (lastResponse) return lastResponse;

    return messages[messages.length - 1];
  }

  const client: McpClient = {
    get sessionId() {
      return sessionId;
    },
    set sessionId(v: string | null) {
      sessionId = v;
    },

    async initialize() {
      await request({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "e2e-test-client", version: "0.0.1" },
        },
        id: nextId++,
      });
      if (!sessionId) {
        throw new Error("MCP initialize did not return a session ID");
      }
      // Fire-and-forget notification
      const notifHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (sessionId) {
        notifHeaders["mcp-session-id"] = sessionId;
      }
      await fetch(mcpUrl, {
        method: "POST",
        headers: notifHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {});
    },

    async listTools() {
      const res = await request({
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
        id: nextId++,
      });
      const result = res.result as {
        tools: Array<{ name: string; description: string }>;
      };
      return result.tools;
    },

    async callTool(name, args = {}) {
      const res = await request({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name, arguments: args },
        id: nextId++,
      });
      const result = res.result as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      const text = result.content.map((c) => c.text).join("");
      return { content: text, isError: result.isError === true };
    },

    async close() {
      if (!sessionId) return;
      try {
        await fetch(mcpUrl, {
          method: "DELETE",
          headers: { "mcp-session-id": sessionId },
          signal: AbortSignal.timeout(3_000),
        });
      } catch {
        // best-effort
      }
      sessionId = null;
    },
  };

  return client;
}

// ---------------------------------------------------------------------------
// Custom test fixture type
// ---------------------------------------------------------------------------

interface TestFixtures {
  /** MCP server subprocess — started with bun --hot on an OS-assigned port. */
  mcpServer: McpServer;
  /** MCP server subprocess started WITHOUT --hot. */
  mcpServerNoHot: McpServer;
  /** Controllable test web server on an OS-assigned port. */
  testServer: TestServer;
  /** Chromium browser context with the extension configured for this test's MCP port. */
  extensionContext: BrowserContext;
  /** The extension's service-worker / background page. */
  backgroundPage: Page;
  /** MCP client pointed at this test's MCP server. */
  mcpClient: McpClient;
}

export const test = base.extend<TestFixtures>({
  // eslint-disable-next-line no-empty-pattern
  mcpServer: async ({}, use) => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);
    await use(server);
    await server.kill();
    cleanupTestConfigDir(configDir);
  },

  // eslint-disable-next-line no-empty-pattern
  mcpServerNoHot: async ({}, use) => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);
    await use(server);
    await server.kill();
    cleanupTestConfigDir(configDir);
  },

  // eslint-disable-next-line no-empty-pattern
  testServer: async ({}, use) => {
    const srv = await startTestServer();
    await use(srv);
    await srv.kill();
  },

  extensionContext: async ({ mcpServer }, use) => {
    // The extension must be patched with the ACTUAL port the MCP server
    // bound to (parsed from its startup log, not pre-allocated).
    const { context, cleanupDir } = await launchExtensionContext(
      mcpServer.port,
    );
    await use(context);
    await context.close();
    try {
      fs.rmSync(cleanupDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  },

  backgroundPage: async ({ extensionContext }, use) => {
    const bg = await getBackgroundPage(extensionContext);
    await use(bg);
  },

  mcpClient: async ({ mcpServer }, use) => {
    const client = createMcpClient(mcpServer.port);
    await use(client);
    await client.close();
  },
});

export { expect } from "@playwright/test";
export {
  waitForHealth,
  fetchHealth,
  createTestConfigDir,
  cleanupTestConfigDir,
  createMcpClient,
  startTestServer,
  startMcpServer,
  E2E_TEST_PLUGIN_DIR,
  ROOT,
};
export type { OpentabsConfig };
