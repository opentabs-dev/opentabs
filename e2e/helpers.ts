/**
 * Shared E2E test helpers — extracted from individual test files to eliminate
 * duplication. All test files import these helpers instead of defining their
 * own copies.
 */

import type { ChildProcess } from 'node:child_process';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BROWSER_TOOLS_CATALOG } from '@opentabs-dev/shared';
import type { BrowserContext, Page } from '@playwright/test';
import type { McpClient, McpServer, TestServer } from './fixtures.js';
import {
  cleanupTestConfigDir,
  copyE2eTestPlugin,
  createMcpClient,
  launchExtensionContext,
  ROOT,
  readPluginToolNames,
  startMcpServer,
  startTestServer,
  symlinkCrossPlatform,
  writeTestConfig,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// Extension introspection
// ---------------------------------------------------------------------------

/**
 * Get the extension ID from the background service worker URL.
 * The service worker URL follows the pattern: chrome-extension://<id>/dist/background.js
 */
export const getExtensionId = async (context: BrowserContext): Promise<string> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const sw of context.serviceWorkers()) {
      const m = sw.url().match(/chrome-extension:\/\/([^/]+)/);
      if (m?.[1]) return m[1];
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Could not find extension service worker within 10s');
};

/**
 * Open the side panel as a regular extension page in the browser context.
 */
export const openSidePanel = async (context: BrowserContext): Promise<Page> => {
  const extId = await getExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/side-panel/side-panel.html`, {
    waitUntil: 'load',
    timeout: 10_000,
  });
  return page;
};

/**
 * Set up the adapter symlink between the MCP server's config dir and the
 * extension's adapters directory.
 */
export const setupAdapterSymlink = (configDir: string, extensionDir: string): void => {
  const serverAdaptersParent = path.join(configDir, 'extension');
  fs.mkdirSync(serverAdaptersParent, { recursive: true });
  const serverAdaptersDir = path.join(serverAdaptersParent, 'adapters');
  const extensionAdaptersDir = path.join(extensionDir, 'adapters');
  fs.mkdirSync(extensionAdaptersDir, { recursive: true });
  fs.rmSync(serverAdaptersDir, { recursive: true, force: true });
  symlinkCrossPlatform(extensionAdaptersDir, serverAdaptersDir, 'dir');
};

// ---------------------------------------------------------------------------
// Log and health polling
// ---------------------------------------------------------------------------

/**
 * Wait until the server's accumulated logs contain `substring`.
 * Polls the logs array every `intervalMs` until found or timeout.
 */
export const waitForLog = async (
  server: McpServer,
  substring: string,
  timeoutMs = 15_000,
  intervalMs = 200,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.logs.join('\n').includes(substring)) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForLog timed out after ${timeoutMs}ms waiting for "${substring}".\n` +
      `Logs so far:\n${server.logs.join('\n')}`,
  );
};

/**
 * Wait for the extension to connect to the MCP server.
 * Polls /health until extensionConnected === true.
 */
export const waitForExtensionConnected = async (server: McpServer, timeoutMs = 45_000): Promise<void> => {
  await server.waitForHealth(h => h.extensionConnected, timeoutMs);
};

/**
 * Wait for the extension to be disconnected from the MCP server.
 * Polls /health until extensionConnected === false.
 */
export const waitForExtensionDisconnected = async (server: McpServer, timeoutMs = 10_000): Promise<void> => {
  await server.waitForHealth(h => !h.extensionConnected, timeoutMs);
};

// ---------------------------------------------------------------------------
// Generic condition polling
// ---------------------------------------------------------------------------

/**
 * Poll a predicate until it returns true or timeout. Use this instead of
 * fixed `setTimeout` waits — it's both faster (returns as soon as the
 * condition is met) and more reliable (doesn't depend on wall-clock guesses).
 */
export const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
  intervalMs = 250,
  label = 'condition',
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms waiting for: ${label}`);
};

/**
 * Wait until a tool call returns the expected outcome (success or error).
 * Replaces fixed `setTimeout` waits after state changes (auth toggle, tab
 * close/reopen, error mode) — polls by actually calling the tool until
 * the result matches expectations.
 */
export const waitForToolResult = async (
  mcpClient: McpClient,
  toolName: string,
  args: Record<string, unknown>,
  expect: { isError: boolean },
  timeoutMs = 15_000,
  intervalMs = 500,
): Promise<{ content: string; isError: boolean }> => {
  const deadline = Date.now() + timeoutMs;
  let last: { content: string; isError: boolean } | undefined;
  while (Date.now() < deadline) {
    try {
      last = await mcpClient.callTool(toolName, args);
      if (last.isError === expect.isError) return last;
    } catch {
      // MCP call itself failed — retry
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForToolResult timed out after ${timeoutMs}ms waiting for ${toolName} ` +
      `isError=${String(expect.isError)}. Last result: ${last ? `isError=${String(last.isError)}, content=${last.content.slice(0, 200)}` : 'none'}`,
  );
};

/**
 * Poll `listTools()` until the tool list satisfies a predicate.
 * Replaces the `waitForLog('Manifest updated') + sleep(500)` pattern in
 * file-watcher and hot-reload tests.
 */
export const waitForToolList = async (
  mcpClient: McpClient,
  predicate: (tools: Array<{ name: string; description: string; inputSchema?: unknown }>) => boolean,
  timeoutMs = 10_000,
  intervalMs = 300,
  label = 'tool list condition',
): Promise<Array<{ name: string; description: string; inputSchema?: unknown }>> => {
  const deadline = Date.now() + timeoutMs;
  let last: Array<{ name: string; description: string; inputSchema?: unknown }> = [];
  while (Date.now() < deadline) {
    try {
      last = await mcpClient.listTools();
      if (predicate(last)) return last;
    } catch {
      // MCP call failed — retry
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForToolList timed out after ${timeoutMs}ms waiting for: ${label}. ` +
      `Last tool names: [${last.map(t => t.name).join(', ')}]`,
  );
};

// ---------------------------------------------------------------------------
// Tool result parsing
// ---------------------------------------------------------------------------

/** Parse the JSON text content from a tool call result into an object. */
export const parseToolResult = (content: string): Record<string, unknown> =>
  JSON.parse(content) as Record<string, unknown>;

/**
 * Unwrap a multi-connection response (from extension_get_state, extension_check_adapter, etc.)
 * into the first connection's data. These tools return `{ connections: [{ connectionId, ...data }] }`
 * but single-connection tests expect the flat data format.
 */
export const unwrapSingleConnection = (data: Record<string, unknown>): Record<string, unknown> => {
  const connections = data.connections as Array<Record<string, unknown>> | undefined;
  if (!connections || connections.length === 0) {
    throw new Error('Expected at least one connection in multi-connection response');
  }
  return connections[0] as Record<string, unknown>;
};

/** Extract the machine-readable JSON block from a structured error response. */
export const parseErrorJson = (content: string): Record<string, unknown> => {
  const match = content.match(/```json\n(.+?)\n```/s);
  if (!match?.[1]) throw new Error(`No JSON block found in error response:\n${content}`);
  return JSON.parse(match[1]) as Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Browser tool names
// ---------------------------------------------------------------------------

/**
 * Known browser tool names that should always be present in `tools/list`,
 * regardless of which plugins are installed. Used by tests to verify that
 * built-in browser tools are registered correctly.
 */
export const BROWSER_TOOL_NAMES = BROWSER_TOOLS_CATALOG.map(t => t.name);

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

/**
 * Standard test preamble: wait for extension, open tab, poll until the
 * e2e-test plugin reports "ready" state, init MCP client.
 * Returns the page handle.
 */
export const setupToolTest = async (
  mcpServer: McpServer,
  testServer: TestServer,
  extensionContext: BrowserContext,
  mcpClient: McpClient,
): Promise<Page> => {
  await waitForExtensionConnected(mcpServer);
  await waitForLog(mcpServer, 'plugin(s) mapped');
  await testServer.reset();

  const page = await openTestAppTab(extensionContext, testServer.url, mcpServer, testServer);

  // Poll until the tool is actually callable (tab state = ready) instead
  // of using a fixed READY_SETTLE_MS sleep.
  await waitForToolResult(mcpClient, 'e2e-test_get_status', {}, { isError: false }, 15_000);

  return page;
};

/**
 * Call a tool and throw with diagnostics if the result is unexpectedly an error.
 */
export const callToolExpectSuccess = async (
  mcpClient: McpClient,
  mcpServer: McpServer,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => {
  const result = await mcpClient.callTool(toolName, args);
  if (result.isError) {
    throw new Error(
      `${toolName} returned isError=true.\n` +
        `Content: ${result.content}\n` +
        `MCP server logs (last 5):\n${mcpServer.logs.slice(-5).join('\n')}`,
    );
  }
  return parseToolResult(result.content);
};

// ---------------------------------------------------------------------------
// Test app tab helpers
// ---------------------------------------------------------------------------

/**
 * Open the test app tab and wait for the e2e-test adapter to be injected.
 * Polls with rich diagnostics — fails fast with context.
 */
export const openTestAppTab = async (
  context: BrowserContext,
  testServerUrl: string,
  mcpServer?: McpServer,
  testServer?: TestServer,
  timeoutMs = 20_000,
): Promise<Page> => {
  const page = await context.newPage();
  await page.goto(testServerUrl, { waitUntil: 'load' });

  const deadline = Date.now() + timeoutMs;
  let lastDiag = '';
  let lastDiagnosticTime = 0;

  while (Date.now() < deadline) {
    const injected = await page.evaluate(() => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as
        | { adapters?: Record<string, unknown> }
        | undefined;
      return {
        hasOpenTabs: ot !== undefined,
        hasAdapters: ot?.adapters !== undefined,
        hasE2eTest: ot?.adapters?.['e2e-test'] !== undefined,
        adapterNames: ot?.adapters ? Object.keys(ot.adapters) : [],
      };
    });

    if (injected.hasE2eTest) {
      return page;
    }

    // Build diagnostic snapshot periodically (every ~2 seconds of elapsed time)
    const now = Date.now();
    if (now - lastDiagnosticTime >= 2000) {
      lastDiagnosticTime = now;
      const parts: string[] = [
        `adapter: openTabs=${String(injected.hasOpenTabs)}, adapters=${String(injected.hasAdapters)}, e2e-test=${String(injected.hasE2eTest)}, names=[${injected.adapterNames.join(',')}]`,
      ];

      if (mcpServer) {
        const h = await mcpServer.health().catch(() => null);
        parts.push(`mcp: ${h ? `connected=${String(h.extensionConnected)}, plugins=${h.plugins}` : 'unreachable'}`);
      }

      if (testServer) {
        try {
          const diag = (await testServer.controlGet('diagnostics')) as Record<string, unknown>;
          const counts = diag.counts as Record<string, number> | undefined;
          const authChecks = counts?.authCheckCalls ?? '?';
          const adapterLikely =
            typeof diag.adapterLikelyInjected === 'boolean' || typeof diag.adapterLikelyInjected === 'string'
              ? diag.adapterLikelyInjected
              : '?';
          parts.push(`testServer: authChecks=${String(authChecks)}, adapterLikely=${String(adapterLikely)}`);
        } catch {
          parts.push('testServer: unreachable');
        }
      }

      lastDiag = parts.join(' | ');
    }

    await new Promise(r => setTimeout(r, 500));
  }

  const finalParts: string[] = [`Adapter not injected after ${timeoutMs}ms`];
  finalParts.push(`Last diagnostic: ${lastDiag}`);
  if (mcpServer) {
    finalParts.push(`MCP server logs (last 10):\n${mcpServer.logs.slice(-10).join('\n')}`);
  }
  finalParts.push(`Tab URL: ${page.url()}`);

  await page.close();
  throw new Error(finalParts.join('\n\n'));
};

// ---------------------------------------------------------------------------
// Isolated IIFE test setup — encapsulates repeated infrastructure for tests
// that use raw Playwright `test` (not fixture-based `fixtureTest`).
// ---------------------------------------------------------------------------

/**
 * Resources created by setupIsolatedIifeTest, with a cleanup() method
 * that tears down everything in the correct order.
 */
export interface IsolatedIifeTestContext {
  /** Per-test copy of the e2e-test plugin directory. */
  pluginDir: string;
  /** Config directory for this test's MCP server. */
  configDir: string;
  /** MCP server subprocess with hot reload enabled. */
  server: McpServer;
  /** Controllable test web server. */
  testServer: TestServer;
  /** Chromium browser context with the extension loaded. */
  context: BrowserContext;
  /** MCP client connected to this test's server. */
  client: McpClient;
  /** Tear down all resources (servers, client, browser, temp dirs). */
  cleanup: () => Promise<void>;
}

/**
 * Standard setup for isolated IIFE injection tests that need their own
 * plugin copy, config directory, MCP server, test server, extension context,
 * and MCP client.
 *
 * Encapsulates the repeated 8-step infrastructure that appears in every
 * non-fixture IIFE test: copyE2eTestPlugin, mkdtemp for config, build tool
 * config, startMcpServer, startTestServer, launchExtensionContext with adapter
 * symlink, createMcpClient, initialize + waitForExtensionConnected + waitForLog.
 *
 * Returns an IsolatedIifeTestContext with all resources and a cleanup() function.
 * Use in a try/finally block: `try { ... } finally { await ctx.cleanup(); }`
 */
export const setupIsolatedIifeTest = async (configDirPrefix: string): Promise<IsolatedIifeTestContext> => {
  const { pluginDir, tmpDir } = copyE2eTestPlugin();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), `opentabs-e2e-${configDirPrefix}-`));

  const prefixedToolNames = readPluginToolNames();
  const tools: Record<string, boolean> = {};
  for (const t of prefixedToolNames) {
    tools[t] = true;
  }
  writeTestConfig(configDir, { localPlugins: [pluginDir], tools });

  // Track resources as they're created so partial failures clean up
  // everything that was started before the throw.
  let server: McpServer | undefined;
  let testSrv: TestServer | undefined;
  let context: BrowserContext | undefined;
  let cleanupDir: string | undefined;

  try {
    server = await startMcpServer(configDir, true);
    testSrv = await startTestServer();

    const ext = await launchExtensionContext(server.port, server.secret);
    context = ext.context;
    cleanupDir = ext.cleanupDir;
    setupAdapterSymlink(configDir, ext.extensionDir);

    const client = createMcpClient(server.port, server.secret);

    await client.initialize();
    await waitForExtensionConnected(server);
    await waitForLog(server, 'plugin(s) mapped');

    // Capture definite values for the cleanup closure (avoids non-null assertions
    // since the outer let bindings are typed as T | undefined).
    const finalContext = context;
    const finalServer = server;
    const finalTestSrv = testSrv;
    const finalCleanupDir = cleanupDir;

    const cleanup = async () => {
      await client.close();
      await finalContext.close().catch(() => {});
      await finalServer.kill();
      await finalTestSrv.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(finalCleanupDir, { recursive: true, force: true });
      cleanupTestConfigDir(configDir);
    };

    return { pluginDir, configDir, server, testServer: testSrv, context, client, cleanup };
  } catch (error) {
    // Clean up any resources that were successfully created before the failure
    if (context) await context.close().catch(() => {});
    if (testSrv) await testSrv.kill().catch(() => {});
    if (server) await server.kill().catch(() => {});
    if (cleanupDir) fs.rmSync(cleanupDir, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    cleanupTestConfigDir(configDir);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// File watcher write-and-wait
// ---------------------------------------------------------------------------

/**
 * Write a file and wait for the file watcher to detect the change. If the
 * watcher misses it (FSEvents registration race on macOS), re-write with a
 * trivial modification and poll again.
 *
 * Replaces the `waitForLog('File watcher: Watching') + sleep(500)` pattern
 * that is brittle under CI load.
 *
 * @param server          MCP server whose logs to poll
 * @param writeFile       Callback that writes the file. Called with the retry
 *                        attempt number (0 on first try). On retries the caller
 *                        should produce a slightly different write to guarantee
 *                        a new FSEvents notification (e.g., append a comment).
 * @param expectedLog     Log substring that indicates the watcher processed the change
 * @param outerTimeoutMs  Total budget for all retries (default 20s)
 * @param innerTimeoutMs  Per-attempt poll budget (default 5s)
 */
export const writeAndWaitForWatcher = async (
  server: McpServer,
  writeFile: (attempt: number) => void,
  expectedLog: string,
  outerTimeoutMs = 20_000,
  innerTimeoutMs = 5_000,
): Promise<void> => {
  // Wait for the file watcher to be set up first
  await waitForLog(server, 'File watcher: Watching', 10_000);

  const outerDeadline = Date.now() + outerTimeoutMs;
  let attempt = 0;

  while (Date.now() < outerDeadline) {
    // Count existing occurrences so we can detect a NEW one after our write.
    const logsBefore = server.logs.filter(line => line.includes(expectedLog)).length;

    writeFile(attempt);

    // Poll for a new occurrence of the expected log
    const innerDeadline = Math.min(Date.now() + innerTimeoutMs, outerDeadline);
    while (Date.now() < innerDeadline) {
      const logsNow = server.logs.filter(line => line.includes(expectedLog)).length;
      if (logsNow > logsBefore) return;
      await new Promise(r => setTimeout(r, 200));
    }

    attempt++;
  }

  throw new Error(
    `writeAndWaitForWatcher timed out after ${outerTimeoutMs}ms waiting for "${expectedLog}".\n` +
      `Logs so far:\n${server.logs.join('\n')}`,
  );
};

// ---------------------------------------------------------------------------
// IIFE manipulation
// ---------------------------------------------------------------------------

/**
 * Replace the main IIFE closing pattern `})();` with the given injection before it.
 * The adapter file ends with `})();<freeze-block>})();\n//# sourceMappingURL=...`
 * so we match the first `})();` that is immediately followed by `(function(){`
 * (the freeze block). Throws if the regex does not match.
 */
export const replaceIifeClosing = (iife: string, injection: string): string => {
  const modified = iife.replace(/}\)\(\);(\(function\(\)\{)/, `${injection}\n})();$1`);
  if (modified === iife) {
    throw new Error(
      'IIFE regex replacement did not match — the adapter.iife.js closing pattern may have changed. ' +
        'Expected to find })();(function(){ (main IIFE close followed by freeze block).',
    );
  }
  return modified;
};

// ---------------------------------------------------------------------------
// Side panel permission helpers
// ---------------------------------------------------------------------------

/**
 * Click a Radix Select trigger (by aria-label) and choose an option by display text.
 * Waits for the popover to fully open before clicking the option, and waits for
 * it to close after selection — prevents animation race conditions during rapid toggling.
 */
export const selectPermission = async (page: Page, ariaLabel: string, optionText: string): Promise<void> => {
  await page.locator(`[aria-label="${ariaLabel}"]`).click();
  const listbox = page.locator('[role="listbox"]');
  await listbox.waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('[role="option"]', { hasText: optionText }).click();
  await listbox.waitFor({ state: 'hidden', timeout: 5_000 });
};

/**
 * Check if the latest published @opentabs-dev/opentabs-plugin-slack has the
 * required build artifacts (adapter.iife.js and tools.json). Returns false if
 * the published package only has tsc output (missing opentabs-plugin build).
 */
export const npmSlackPluginHasArtifacts = (): boolean => {
  try {
    const output = execSync('npm pack @opentabs-dev/opentabs-plugin-slack --dry-run 2>&1', {
      encoding: 'utf8',
      timeout: 30_000,
    });
    return output.includes('dist/tools.json') && output.includes('dist/adapter.iife.js');
  } catch {
    return false;
  }
};

/** Expand all collapsed "N hidden" tool sections within a plugin card. */
export const expandHiddenTools = async (page: Page): Promise<void> => {
  const hiddenToggles = page.locator('button', { hasText: /\d+ hidden/ });
  const count = await hiddenToggles.count();
  for (let i = 0; i < count; i++) {
    await hiddenToggles.nth(i).click();
  }
};

// ---------------------------------------------------------------------------
// Pre-script mock server
// ---------------------------------------------------------------------------

/** Result returned by startMockPreScriptServer. */
export interface MockPreScriptServer {
  /** Base URL of the mock server (e.g. http://127.0.0.1:12345). */
  url: string;
  /** Expected bearer token embedded in the mock page's bootstrap script. */
  expectedToken: string;
  /** Kill the mock server process. */
  kill: () => Promise<void>;
}

/**
 * Spawn the pre-script mock server (e2e/prescript-mock-server.ts) on an
 * ephemeral port. Resolves once the server is listening and the expected token
 * has been fetched from /control/server-info.
 *
 * Used by pre-script E2E tests that need a page simulating the PR #69
 * Outlook/MSAL failure mode (fetch-before-override bootstrap).
 */
export const startMockPreScriptServer = (): Promise<MockPreScriptServer> =>
  new Promise<MockPreScriptServer>((resolve, reject) => {
    const serverScript = path.join(ROOT, 'e2e', 'prescript-mock-server.ts');

    const proc: ChildProcess = spawn('node', ['--import', 'tsx/esm', serverScript], {
      cwd: ROOT,
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const logs: string[] = [];
    let resolved = false;

    const killProc = (): Promise<void> => {
      if (proc.exitCode !== null) return Promise.resolve();
      return new Promise<void>(res => {
        const fallback = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            /* already dead */
          }
        }, 200);
        proc.once('exit', () => {
          clearTimeout(fallback);
          res();
        });
        try {
          proc.kill('SIGTERM');
        } catch {
          clearTimeout(fallback);
          res();
        }
      });
    };

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        if (line.trim()) logs.push(line.trim());
      }

      if (!resolved) {
        const m = text.match(/Listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (m) {
          resolved = true;
          // m[1] is always defined when the regex matches (capture group 1)
          const serverUrl = m[1] as string;

          // Fetch the expected token from /control/server-info.
          fetch(`${serverUrl}/control/server-info`, { signal: AbortSignal.timeout(5_000) })
            .then(r => r.json())
            .then((info: unknown) => {
              const token = (info as Record<string, unknown>).token;
              if (typeof token !== 'string') {
                throw new Error(`/control/server-info returned unexpected shape: ${JSON.stringify(info)}`);
              }
              resolve({ url: serverUrl, expectedToken: token, kill: killProc });
            })
            .catch((err: unknown) => {
              void killProc();
              reject(new Error(`Failed to fetch /control/server-info: ${String(err)}`));
            });
        }
      }
    };

    const startupDeadline = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        void killProc();
        reject(new Error(`startMockPreScriptServer: timed out after 10s.\nLogs:\n${logs.join('\n')}`));
      }
    }, 10_000);

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('error', (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(startupDeadline);
        reject(err);
      }
    });

    proc.on('exit', (code: number | null) => {
      clearTimeout(startupDeadline);
      if (!resolved) {
        resolved = true;
        reject(
          new Error(
            `startMockPreScriptServer: process exited early with code ${String(code)}.\nLogs:\n${logs.join('\n')}`,
          ),
        );
      }
    });
  });
