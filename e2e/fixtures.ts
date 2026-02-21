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

import { test as base, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..');
const EXTENSION_DIR = path.join(ROOT, 'platform/browser-extension');
const SERVER_DIST_DIR = path.join(ROOT, 'platform/mcp-server/dist');
const TEST_SERVER_ENTRY = path.join(ROOT, 'e2e/test-server.ts');
const STRICT_CSP_SERVER_ENTRY = path.join(ROOT, 'e2e/strict-csp-test-server.ts');
const E2E_TEST_PLUGIN_DIR = path.join(ROOT, 'plugins/e2e-test');

// ---------------------------------------------------------------------------
// Health helper (MCP server)
// ---------------------------------------------------------------------------

interface PluginDetail {
  name: string;
  displayName: string;
  toolCount: number;
  tabState: string;
  source: string;
  sdkVersion: string | null;
  logBufferSize: number;
}

interface HealthResponse {
  status: string;
  version: string;
  sdkVersion: string;
  mode: 'dev' | 'production';
  extensionConnected: boolean;
  mcpClients: number;
  plugins: number;
  reloadCount: number;
  pluginDetails?: PluginDetail[];
}

const fetchHealth = async (port: number): Promise<HealthResponse | null> => {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
};

const waitForHealth = async (
  port: number,
  predicate: (h: HealthResponse) => boolean,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<HealthResponse> => {
  const deadline = Date.now() + timeoutMs;
  let last: HealthResponse | null = null;
  while (Date.now() < deadline) {
    last = await fetchHealth(port);
    if (last && predicate(last)) return last;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`waitForHealth timed out after ${timeoutMs}ms. Last: ${JSON.stringify(last)}`);
};

/**
 * Parse the actual port from a server's startup log line.
 * Matches patterns like "listening on http://localhost:12345" or
 * "Listening on http://localhost:12345".
 */
const parsePortFromLogs = (logs: string[]): number | null => {
  for (const line of logs) {
    const m = line.match(/[Ll]istening on http:\/\/localhost:(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
};

// ---------------------------------------------------------------------------
// Config management — per-test isolated config directories
// ---------------------------------------------------------------------------

interface OpentabsConfig {
  localPlugins: string[];
  tools: Record<string, boolean>;
  secret?: string;
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
/**
 * Read tool names from the e2e-test plugin's dist/tools.json instead of hardcoding.
 * Returns prefixed tool names (e.g., 'e2e-test_echo').
 */
const readPluginToolNames = (): string[] => {
  const toolsPath = path.join(E2E_TEST_PLUGIN_DIR, 'dist', 'tools.json');
  const raw: unknown = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'));
  // Support both legacy array format and current { tools: [...] } format
  const tools = (Array.isArray(raw) ? raw : (raw as { tools: unknown[] }).tools) as Array<{ name: string }>;
  return tools.map(t => `e2e-test_${t.name}`);
};

const createTestConfigDir = (): string => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-config-'));
  fs.chmodSync(configDir, 0o700);

  const absPluginPath = path.resolve(E2E_TEST_PLUGIN_DIR);

  const toolNames = readPluginToolNames();
  const tools: Record<string, boolean> = {};
  for (const tool of toolNames) {
    tools[tool] = true;
  }

  const config: OpentabsConfig = {
    localPlugins: [absPluginPath],
    tools,
    secret: crypto.randomUUID(),
  };

  const configPath = path.join(configDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  fs.chmodSync(configPath, 0o600);

  return configDir;
};

const cleanupTestConfigDir = (configDir: string): void => {
  try {
    fs.rmSync(configDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
};

/**
 * Read the config.json from an isolated test config directory.
 */
const readTestConfig = (configDir: string): OpentabsConfig => {
  const raw = fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8');
  return JSON.parse(raw) as OpentabsConfig;
};

/**
 * Write a new config.json to an isolated test config directory.
 */
const writeTestConfig = (configDir: string, config: OpentabsConfig): void => {
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config, null, 2) + '\n', 'utf-8');
};

/** Minimal plugin manifest tool definition */
interface MinimalToolDef {
  name: string;
  description: string;
}

/**
 * Create a minimal plugin directory with a valid package.json (opentabs field),
 * dist/tools.json, and a no-op adapter IIFE. Returns the absolute path to the
 * plugin directory.
 *
 * The plugin is fully discoverable by the MCP server but its adapter does
 * nothing useful — sufficient for tools/list verification and config tests.
 */
const createMinimalPlugin = (
  parentDir: string,
  pluginName: string,
  tools: MinimalToolDef[],
  urlPatterns: string[] = ['http://localhost/*'],
): string => {
  const pluginDir = path.join(parentDir, pluginName);
  fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });

  // package.json with opentabs field — the npm package name follows the convention
  const npmName = pluginName.startsWith('opentabs-plugin-') ? pluginName : `opentabs-plugin-${pluginName}`;
  const packageJson = {
    name: npmName,
    version: '0.0.1',
    type: 'module',
    main: 'dist/adapter.iife.js',
    opentabs: {
      displayName: `Test ${pluginName}`,
      description: `Minimal test plugin: ${pluginName}`,
      urlPatterns,
    },
  };

  fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf-8');

  // dist/tools.json — tool definitions (new manifest format with resources/prompts)
  const toolDefs = tools.map(t => ({
    name: t.name,
    displayName: t.name
      .split(/[_-]/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
    description: t.description,
    icon: 'wrench',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    output_schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
  }));

  const manifest = { tools: toolDefs, resources: [], prompts: [] };
  fs.writeFileSync(path.join(pluginDir, 'dist', 'tools.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  const iife = [
    '(function() {',
    '  if (!globalThis.__openTabs) globalThis.__openTabs = { adapters: {} };',
    `  globalThis.__openTabs.adapters[${JSON.stringify(pluginName)}] = {`,
    '    isReady: function() { return false; },',
    '    tools: {}',
    '  };',
    '})();',
  ].join('\n');

  fs.writeFileSync(path.join(pluginDir, 'dist', 'adapter.iife.js'), iife, 'utf-8');

  return path.resolve(pluginDir);
};

/**
 * Create a per-test copy of the e2e-test plugin so that file-watcher tests
 * can modify manifests and IIFEs without affecting other parallel tests.
 * Returns the absolute path to the plugin copy and the parent temp directory
 * for cleanup.
 */
const copyE2eTestPlugin = (): { pluginDir: string; tmpDir: string } => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-plugin-copy-'));
  const pluginDir = path.join(tmpDir, 'e2e-test');
  fs.cpSync(E2E_TEST_PLUGIN_DIR, pluginDir, { recursive: true });
  return { pluginDir: path.resolve(pluginDir), tmpDir };
};

// ---------------------------------------------------------------------------
// Reliable process kill helper
// ---------------------------------------------------------------------------

/**
 * Kill a child process reliably: send SIGTERM, wait for exit, escalate to
 * SIGKILL after `graceMs`, and always wait for the 'exit' event before
 * resolving. This prevents orphaned processes from surviving kill attempts.
 */
const killProcess = (proc: ChildProcess, graceMs = 5_000): Promise<void> => {
  if (proc.exitCode !== null) return Promise.resolve();
  return new Promise<void>(resolve => {
    const onExit = () => {
      clearTimeout(fallback);
      resolve();
    };
    proc.once('exit', onExit);
    const fallback = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }, graceMs);
    try {
      proc.kill('SIGTERM');
    } catch {
      // Process may have exited between the exitCode check and kill call
      clearTimeout(fallback);
      proc.removeListener('exit', onExit);
      resolve();
    }
  });
};

// ---------------------------------------------------------------------------
// MCP server subprocess manager
// ---------------------------------------------------------------------------

interface McpServer {
  proc: ChildProcess;
  logs: string[];
  /** The actual port the server is listening on (parsed from startup log). */
  port: number;
  /** The isolated config directory for this server instance (OPENTABS_CONFIG_DIR). */
  configDir: string;
  /** The per-test temp directory containing the hot-reload wrapper script. */
  wrapperDir: string;
  /** The entry point for this server instance (inside wrapperDir). */
  entryFile: string;
  /** The authentication secret from the config (auto-generated by the server if absent). */
  secret: string | undefined;
  waitForHealth: (predicate: (h: HealthResponse) => boolean, timeoutMs?: number) => Promise<HealthResponse>;
  triggerHotReload: () => void;
  kill: () => Promise<void>;
  health: () => Promise<HealthResponse | null>;
}

/**
 * Create a per-test wrapper file that imports the real server entry.
 *
 * Each test gets its own wrapper file in /tmp/ that contains a single
 * `import` statement pointing at the real dist/index.js via absolute path.
 * This gives each parallel test worker its own bun --hot entrypoint so
 * `triggerHotReload()` (which appends to the wrapper) only affects this
 * test's bun process.
 *
 * The real dist/ is imported directly (not copied) because:
 *   - Copied dist files in /tmp/ can't resolve workspace packages
 *     (@opentabs-dev/shared etc.) or node_modules, causing Bun to crash.
 *   - `bun --hot` re-evaluates the entire import tree when the wrapper
 *     file changes, so hot reload works without needing a local copy.
 */
const createServerWrapper = (): {
  wrapperDir: string;
  entryFile: string;
  rewriteWrapper: () => void;
} => {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-server-'));
  const entryFile = path.join(wrapperDir, 'server.js');

  const realEntry = path.join(SERVER_DIST_DIR, 'index.js');
  fs.writeFileSync(entryFile, `import ${JSON.stringify(realEntry)};\n`, 'utf-8');

  const rewriteWrapper = () => {
    fs.appendFileSync(entryFile, `\n// hot-reload-trigger-${Date.now()}\n`);
  };

  return { wrapperDir, entryFile, rewriteWrapper };
};

/**
 * Start the MCP server subprocess.
 *
 * Pass port=0 to let the OS assign a free port (eliminates TOCTOU race).
 * The actual port is parsed from the server's "MCP server v<version> listening on
 * http://localhost:<port>" startup log line.
 *
 * Each test gets its own wrapper file so `triggerHotReload` is isolated
 * from parallel tests — only this server's `bun --hot` sees the file change.
 */
const startMcpServer = (configDir: string, hot: boolean = true, explicitPort?: number): Promise<McpServer> =>
  new Promise<McpServer>((resolve, reject) => {
    const { wrapperDir, entryFile, rewriteWrapper } = createServerWrapper();
    // E2E tests require dev mode (file watchers, hot reload, config watching).
    const args = hot ? ['--hot', entryFile, '--dev'] : [entryFile, '--dev'];

    // PORT=0 → Bun.serve() picks a free ephemeral port, no EADDRINUSE.
    // If explicitPort is provided (e.g., kill/restart test reusing the same
    // port the extension is configured for), use that instead.
    const portStr = explicitPort !== undefined ? String(explicitPort) : '0';

    const proc = spawn('bun', args, {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: portStr,
        OPENTABS_CONFIG_DIR: configDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const logs: string[] = [];
    let resolved = false;

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        if (line.trim()) logs.push(line);
      }
      if (!resolved && text.includes('MCP server') && text.includes('listening on')) {
        const actualPort = parsePortFromLogs(logs);
        if (!actualPort) {
          resolved = true;
          void killProcess(proc);
          reject(new Error(`MCP server started but could not parse port from logs.\nLogs:\n${logs.join('\n')}`));
          return;
        }
        resolved = true;
        // Now that we know the port, wire up the server object
        server.port = actualPort;
        // Read the secret from config (the server auto-generates one if absent)
        try {
          const cfg = readTestConfig(configDir);
          server.secret = cfg.secret;
        } catch {
          // Config may not be readable yet — auth will be skipped
        }
        server.health = () => fetchHealth(actualPort);
        server.waitForHealth = (predicate, timeoutMs) => waitForHealth(actualPort, predicate, timeoutMs);
        resolve(server);
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('error', err => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    proc.on('exit', code => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`MCP server exited with code ${String(code)} before ready.\nLogs:\n${logs.join('\n')}`));
      }
    });

    const server: McpServer = {
      proc,
      logs,
      port: 0, // will be set once the server logs its actual port
      configDir,
      wrapperDir,
      entryFile,
      secret: undefined, // will be set once the server logs its actual port
      health: () => Promise.resolve(null),
      waitForHealth: () => Promise.reject(new Error('Server not started yet')),
      triggerHotReload() {
        // Modify THIS test's isolated copy of the server entry.
        // Only this server's bun --hot watches these files.
        rewriteWrapper();
      },
      async kill() {
        await killProcess(proc, 5_000);
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
        void killProcess(proc);
        reject(new Error(`MCP server did not start within 15s.\nLogs:\n${logs.join('\n')}`));
      }
    }, 15_000);
  });

// ---------------------------------------------------------------------------
// Test web server subprocess manager
// ---------------------------------------------------------------------------

interface TestServer {
  proc: ChildProcess;
  port: number;
  url: string;
  control: (endpoint: string, body?: Record<string, unknown>) => Promise<unknown>;
  controlGet: (endpoint: string) => Promise<unknown>;
  reset: () => Promise<void>;
  setAuth: (authenticated: boolean) => Promise<void>;
  setError: (error: boolean) => Promise<void>;
  setSlow: (delayMs: number) => Promise<void>;
  invocations: () => Promise<Array<{ ts: number; method: string; path: string; body: unknown }>>;
  kill: () => Promise<void>;
}

/**
 * Shared factory for starting a controllable test web server subprocess.
 *
 * PORT=0 lets the OS assign a free port. The actual port is parsed
 * from the server's "Listening on http://localhost:<port>" log line.
 */
const startServerProcess = (entryFile: string, label: string): Promise<TestServer> =>
  new Promise<TestServer>((resolve, reject) => {
    const proc = spawn('bun', [entryFile], {
      cwd: ROOT,
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const logs: string[] = [];

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        if (line.trim()) logs.push(line);
      }
      if (!resolved && text.includes('Listening on')) {
        const actualPort = parsePortFromLogs(logs);
        if (!actualPort) {
          resolved = true;
          void killProcess(proc);
          reject(new Error(`${label} started but could not parse port.\nLogs:\n${logs.join('\n')}`));
          return;
        }
        resolved = true;
        srv.port = actualPort;
        srv.url = `http://localhost:${String(actualPort)}`;
        resolve(srv);
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('error', err => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
    proc.on('exit', code => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`${label} exited with code ${String(code)}.\nLogs:\n${logs.join('\n')}`));
      }
    });

    const srv: TestServer = {
      proc,
      port: 0, // will be set once the server logs its actual port
      url: '', // will be set once the server logs its actual port
      async control(endpoint, body = {}) {
        const controlUrl = `${srv.url}/control`;
        const res = await fetch(`${controlUrl}/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) throw new Error(`Control POST ${endpoint} failed: ${res.status}`);
        return res.json() as Promise<unknown>;
      },
      async controlGet(endpoint) {
        const controlUrl = `${srv.url}/control`;
        const res = await fetch(`${controlUrl}/${endpoint}`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) throw new Error(`Control GET ${endpoint} failed: ${res.status}`);
        return res.json() as Promise<unknown>;
      },
      async reset() {
        await srv.control('reset');
      },
      async setAuth(authenticated) {
        await srv.control('set-auth', { authenticated });
      },
      async setError(error) {
        await srv.control('set-error', { error });
      },
      async setSlow(delayMs) {
        await srv.control('set-slow', { delayMs });
      },
      async invocations() {
        const data = (await srv.controlGet('invocations')) as {
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
        await killProcess(proc, 3_000);
      },
    };

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        void killProcess(proc);
        reject(new Error(`${label} did not start within 10s`));
      }
    }, 10_000);
  });

const startTestServer = (): Promise<TestServer> => startServerProcess(TEST_SERVER_ENTRY, 'Test server');

const startStrictCspServer = (): Promise<TestServer> =>
  startServerProcess(STRICT_CSP_SERVER_ENTRY, 'Strict-CSP server');

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
const createExtensionCopy = (
  mcpPort: number,
): {
  extensionDir: string;
  userDataDir: string;
} => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'opentabs-e2e-'));
  const extensionDir = path.join(tmpBase, 'extension');
  const userDataDir = path.join(tmpBase, 'user-data');

  try {
    // Copy extension directory, excluding build artifacts and source files
    // that are not needed at runtime (speeds up test setup).
    fs.cpSync(EXTENSION_DIR, extensionDir, {
      recursive: true,
      filter: (source: string) => !/[\\/](node_modules|src|\.tsbuildinfo)[\\/]?$/.test(source),
    });

    // Replace the default MCP server URL in BOTH the offscreen document and
    // the background script. The offscreen.js has DEFAULT_MCP_SERVER_URL and
    // background.js has the fallback URL in the offscreen:getUrl handler.
    // Both must be patched so the extension connects to this test's port.
    const testUrl = `ws://localhost:${mcpPort}/ws`;

    const offscreenPath = path.join(extensionDir, 'dist/offscreen/index.js');
    const offscreenCode = fs.readFileSync(offscreenPath, 'utf-8');
    const patchedOffscreen = offscreenCode.replace(/ws:\/\/localhost:9515\/ws/g, testUrl);
    if (patchedOffscreen === offscreenCode) {
      throw new Error(`Failed to patch offscreen.js — could not find "ws://localhost:9515/ws" in ${offscreenPath}`);
    }
    fs.writeFileSync(offscreenPath, patchedOffscreen, 'utf-8');

    const backgroundPath = path.join(extensionDir, 'dist/background.js');
    const backgroundCode = fs.readFileSync(backgroundPath, 'utf-8');
    const patchedBackground = backgroundCode.replace(/ws:\/\/localhost:9515\/ws/g, testUrl);
    if (patchedBackground === backgroundCode) {
      throw new Error(`Failed to patch background.js — could not find "ws://localhost:9515/ws" in ${backgroundPath}`);
    }
    fs.writeFileSync(backgroundPath, patchedBackground, 'utf-8');

    // Create adapters/ directory for plugin adapter IIFEs
    fs.mkdirSync(path.join(extensionDir, 'adapters'), { recursive: true });

    fs.mkdirSync(userDataDir, { recursive: true });
  } catch (error) {
    fs.rmSync(tmpBase, { recursive: true, force: true });
    throw error;
  }

  return { extensionDir, userDataDir };
};

// Set HEADED=1 to show browser windows for debugging. By default, Chrome
// launches in new headless mode (`--headless=new`) which supports extensions
// while keeping the desktop clear.
const SHOW_BROWSER = process.env['HEADED'] === '1';

const launchExtensionContext = async (
  mcpPort: number,
): Promise<{ context: BrowserContext; cleanupDir: string; extensionDir: string; mcpPort: number }> => {
  const { extensionDir, userDataDir } = createExtensionCopy(mcpPort);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-search-engine-choice-screen',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-features=Translate',
      '--disable-popup-blocking',
      ...(SHOW_BROWSER ? [] : ['--headless=new']),
    ],
    timeout: 30_000,
  });

  return { context, cleanupDir: path.dirname(extensionDir), extensionDir, mcpPort };
};

const getBackgroundPage = async (context: BrowserContext, timeoutMs = 15_000): Promise<Page> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const sw of context.serviceWorkers()) {
      if (sw.url().includes('background')) {
        return sw as unknown as Page;
      }
    }
    for (const page of context.pages()) {
      if (page.url().includes('background')) {
        return page;
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  throw new Error(`Could not find extension background page within ${timeoutMs}ms`);
};

// ---------------------------------------------------------------------------
// MCP Client — calls tools through the MCP streamable HTTP API
// ---------------------------------------------------------------------------

/** A progress notification captured from the SSE stream */
interface ProgressNotification {
  progress: number;
  total: number;
  message?: string;
}

/** A resource entry returned by resources/list */
interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** Content returned by resources/read */
interface McpResourceContent {
  uri: string;
  text?: string;
  blob?: string;
  mimeType?: string;
}

/** A prompt entry returned by prompts/list */
interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

/** A prompt message returned by prompts/get */
interface McpPromptMessage {
  role: string;
  content: { type: string; text: string };
}

interface McpClient {
  initialize: () => Promise<void>;
  listTools: () => Promise<Array<{ name: string; description: string; inputSchema?: unknown }>>;
  callTool: (
    name: string,
    args?: Record<string, unknown>,
    options?: { timeout?: number },
  ) => Promise<{ content: string; isError: boolean }>;
  /** Call a tool with a progressToken and capture all progress notifications from the SSE stream. */
  callToolWithProgress: (
    name: string,
    args?: Record<string, unknown>,
    options?: { timeout?: number },
  ) => Promise<{ content: string; isError: boolean; progressNotifications: ProgressNotification[] }>;
  listResources: () => Promise<McpResource[]>;
  readResource: (uri: string) => Promise<McpResourceContent[]>;
  listPrompts: () => Promise<McpPrompt[]>;
  getPrompt: (name: string, args?: Record<string, string>) => Promise<McpPromptMessage[]>;
  close: () => Promise<void>;
  /** Reset the session so the next initialize() creates a fresh session. */
  resetSession: () => void;
}

const createMcpClient = (port: number, secret?: string): McpClient => {
  let sessionId: string | null = null;
  let nextId = 1;

  const mcpUrl = `http://localhost:${port}/mcp`;

  const request = async (body: unknown, timeoutMs = 30_000): Promise<Record<string, unknown>> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (secret) {
      headers['Authorization'] = `Bearer ${secret}`;
    }
    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
    }
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MCP request failed (${res.status}): ${text}`);
    }
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;

    const contentType = res.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      return (await res.json()) as Record<string, unknown>;
    }

    // SSE response — parse data: lines
    const text = await res.text();
    const dataLines = text
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trim());

    const messages: Record<string, unknown>[] = [];
    for (const raw of dataLines) {
      try {
        messages.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        // skip non-JSON
      }
    }

    if (messages.length === 0) {
      throw new Error(`MCP SSE response had no JSON-RPC messages.\nRaw:\n${text.slice(0, 2000)}`);
    }

    const reqId = (body as Record<string, unknown>).id;
    if (reqId !== undefined) {
      const match = messages.find(m => m.id === reqId && ('result' in m || 'error' in m));
      if (match) return match;
    }

    const lastResponse = [...messages].reverse().find(m => 'result' in m || 'error' in m);
    if (lastResponse) return lastResponse;

    return messages[messages.length - 1] as Record<string, unknown>;
  };

  // Arrow function properties instead of shorthand methods — Playwright's
  // fixture parser scans all functions in fixture files and misinterprets
  // shorthand method syntax as fixture definitions, causing parse errors.
  const client: McpClient = {
    resetSession: () => {
      sessionId = null;
    },

    initialize: async () => {
      await request({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'e2e-test-client', version: '0.0.1' },
        },
        id: nextId++,
      });
      if (!sessionId) {
        throw new Error('MCP initialize did not return a session ID');
      }
      // Fire-and-forget notification
      const notifHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (secret) {
        notifHeaders['Authorization'] = `Bearer ${secret}`;
      }
      if (sessionId) {
        notifHeaders['mcp-session-id'] = sessionId;
      }
      await fetch(mcpUrl, {
        method: 'POST',
        headers: notifHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {});
    },

    listTools: async () => {
      const res = await request({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: nextId++,
      });
      const result = res.result as {
        tools: Array<{ name: string; description: string; inputSchema?: unknown }>;
      };
      return result.tools;
    },

    callTool: async (name, args = {}, options) => {
      const res = await request(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name, arguments: args },
          id: nextId++,
        },
        options?.timeout,
      );

      // Handle JSON-RPC error responses (e.g. dispatch timeout)
      if (res.error) {
        const err = res.error as { message: string };
        return { content: err.message, isError: true };
      }

      const result = res.result as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      const text = result.content.map(c => c.text).join('');
      return { content: text, isError: result.isError === true };
    },

    callToolWithProgress: async (name, args = {}, options) => {
      const timeoutMs = options?.timeout ?? 60_000;
      const progressToken = `progress-${nextId}`;
      const reqId = nextId++;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (secret) {
        headers['Authorization'] = `Bearer ${secret}`;
      }
      if (sessionId) {
        headers['mcp-session-id'] = sessionId;
      }

      const res = await fetch(mcpUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name, arguments: args, _meta: { progressToken } },
          id: reqId,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`MCP request failed (${res.status}): ${text}`);
      }

      const sid = res.headers.get('mcp-session-id');
      if (sid) sessionId = sid;

      const contentType = res.headers.get('content-type') ?? '';
      const progressNotifications: ProgressNotification[] = [];

      if (contentType.includes('application/json')) {
        const json = (await res.json()) as Record<string, unknown>;
        if (json.error) {
          const err = json.error as { message: string };
          return { content: err.message, isError: true, progressNotifications };
        }
        const result = json.result as {
          content: Array<{ type: string; text: string }>;
          isError?: boolean;
        };
        const text = result.content.map(c => c.text).join('');
        return { content: text, isError: result.isError === true, progressNotifications };
      }

      // SSE response — parse all messages, extracting progress notifications
      const rawText = await res.text();
      const dataLines = rawText
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice('data:'.length).trim());

      let toolResult: Record<string, unknown> | null = null;

      for (const raw of dataLines) {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }

        // Progress notification: { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress, total, message? } }
        if (msg.method === 'notifications/progress') {
          const params = msg.params as Record<string, unknown>;
          const notif: ProgressNotification = {
            progress: params.progress as number,
            total: params.total as number,
          };
          if (typeof params.message === 'string') notif.message = params.message;
          progressNotifications.push(notif);
          continue;
        }

        // Tool result: match by request ID
        if (msg.id === reqId && ('result' in msg || 'error' in msg)) {
          toolResult = msg;
        }
      }

      if (!toolResult) {
        throw new Error(`No tool result found in SSE stream.\nRaw:\n${rawText.slice(0, 2000)}`);
      }

      if (toolResult.error) {
        const err = toolResult.error as { message: string };
        return { content: err.message, isError: true, progressNotifications };
      }

      const result = toolResult.result as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      const text = result.content.map(c => c.text).join('');
      return { content: text, isError: result.isError === true, progressNotifications };
    },

    listResources: async () => {
      const res = await request({
        jsonrpc: '2.0',
        method: 'resources/list',
        params: {},
        id: nextId++,
      });
      if (res.error) {
        const err = res.error as { message: string };
        throw new Error(`resources/list failed: ${err.message}`);
      }
      const result = res.result as { resources: McpResource[] };
      return result.resources;
    },

    readResource: async uri => {
      const res = await request(
        {
          jsonrpc: '2.0',
          method: 'resources/read',
          params: { uri },
          id: nextId++,
        },
        60_000,
      );
      if (res.error) {
        const err = res.error as { message: string };
        throw new Error(`resources/read failed: ${err.message}`);
      }
      const result = res.result as { contents: McpResourceContent[] };
      return result.contents;
    },

    listPrompts: async () => {
      const res = await request({
        jsonrpc: '2.0',
        method: 'prompts/list',
        params: {},
        id: nextId++,
      });
      if (res.error) {
        const err = res.error as { message: string };
        throw new Error(`prompts/list failed: ${err.message}`);
      }
      const result = res.result as { prompts: McpPrompt[] };
      return result.prompts;
    },

    getPrompt: async (name, args = {}) => {
      const res = await request(
        {
          jsonrpc: '2.0',
          method: 'prompts/get',
          params: { name, arguments: args },
          id: nextId++,
        },
        60_000,
      );
      if (res.error) {
        const err = res.error as { message: string };
        throw new Error(`prompts/get failed: ${err.message}`);
      }
      const result = res.result as { messages: McpPromptMessage[] };
      return result.messages;
    },

    close: async () => {
      if (!sessionId) return;
      try {
        const deleteHeaders: Record<string, string> = { 'mcp-session-id': sessionId };
        if (secret) {
          deleteHeaders['Authorization'] = `Bearer ${secret}`;
        }
        await fetch(mcpUrl, {
          method: 'DELETE',
          headers: deleteHeaders,
          signal: AbortSignal.timeout(3_000),
        });
      } catch {
        // best-effort
      }
      sessionId = null;
    },
  };

  return client;
};

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
  /** Strict-CSP test web server on an OS-assigned port (`script-src 'none'`). */
  strictCspServer: TestServer;
  /** Chromium browser context with the extension configured for this test's MCP port. */
  extensionContext: BrowserContext;
  /** The extension's service-worker / background page. */
  backgroundPage: Page;
  /** MCP client pointed at this test's MCP server. */
  mcpClient: McpClient;
}

const test = base.extend<TestFixtures>({
  mcpServer: async ({ browserName: _ }, use) => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, true);
    try {
      await use(server);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  },

  mcpServerNoHot: async ({ browserName: _ }, use) => {
    const configDir = createTestConfigDir();
    const server = await startMcpServer(configDir, false);
    try {
      await use(server);
    } finally {
      await server.kill();
      cleanupTestConfigDir(configDir);
    }
  },

  testServer: async ({ browserName: _ }, use) => {
    const srv = await startTestServer();
    try {
      await use(srv);
    } finally {
      await srv.kill();
    }
  },

  strictCspServer: async ({ browserName: _ }, use) => {
    const srv = await startStrictCspServer();
    try {
      await use(srv);
    } finally {
      await srv.kill();
    }
  },

  extensionContext: async ({ mcpServer }, use) => {
    // The extension must be patched with the ACTUAL port the MCP server
    // bound to (parsed from its startup log, not pre-allocated).
    const { context, cleanupDir, extensionDir } = await launchExtensionContext(mcpServer.port);

    // Symlink the MCP server's adapters dir to the extension copy's adapters dir.
    // The MCP server writes adapter IIFEs to <configDir>/extension/adapters/,
    // but the extension is loaded from a temp copy. The symlink makes the
    // files appear inside the extension so chrome.scripting.executeScript({ files })
    // can find them.
    //
    // The MCP server's reload sequence may have already created the adapters/
    // directory and written files there during startup. Remove it first so the
    // symlink can be created. The files will be re-written on sync.full when
    // the extension connects.
    const serverAdaptersParent = path.join(mcpServer.configDir, 'extension');
    fs.mkdirSync(serverAdaptersParent, { recursive: true });
    const serverAdaptersDir = path.join(serverAdaptersParent, 'adapters');
    const extensionAdaptersDir = path.join(extensionDir, 'adapters');
    fs.rmSync(serverAdaptersDir, { recursive: true, force: true });
    fs.symlinkSync(extensionAdaptersDir, serverAdaptersDir);

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
    const client = createMcpClient(mcpServer.port, mcpServer.secret);
    await client.initialize();
    await use(client);
    await client.close();
  },
});

/**
 * Fetch the WebSocket URL and auth secret from the MCP server's /ws-info endpoint.
 * Falls back to unauthenticated URL if the endpoint is unavailable.
 * Includes Bearer authentication when a secret is provided.
 */
const fetchWsUrl = async (port: number, secret?: string): Promise<string> => {
  try {
    const headers: Record<string, string> = {};
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
    const res = await fetch(`http://localhost:${port}/ws-info`, {
      headers,
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      const info = (await res.json()) as { wsUrl?: string };
      if (typeof info.wsUrl === 'string') return info.wsUrl;
    }
  } catch {
    // Server may not support /ws-info yet
  }
  return `ws://localhost:${port}/ws`;
};

/**
 * Fetch the WebSocket URL and auth secret as separate values from /ws-info.
 * Used by tests that need to connect with the secret via Sec-WebSocket-Protocol.
 * Includes Bearer authentication when a secret is provided.
 */
const fetchWsInfo = async (port: number, secret?: string): Promise<{ wsUrl: string; wsSecret: string | null }> => {
  try {
    const headers: Record<string, string> = {};
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
    const res = await fetch(`http://localhost:${port}/ws-info`, {
      headers,
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      const info = (await res.json()) as { wsUrl?: string; wsSecret?: string };
      return {
        wsUrl: typeof info.wsUrl === 'string' ? info.wsUrl : `ws://localhost:${port}/ws`,
        wsSecret: typeof info.wsSecret === 'string' ? info.wsSecret : null,
      };
    }
  } catch {
    // Server may not support /ws-info yet
  }
  return { wsUrl: `ws://localhost:${port}/ws`, wsSecret: null };
};

export { expect } from '@playwright/test';
export {
  test,
  waitForHealth,
  fetchHealth,
  fetchWsUrl,
  fetchWsInfo,
  createTestConfigDir,
  cleanupTestConfigDir,
  readTestConfig,
  writeTestConfig,
  createMinimalPlugin,
  copyE2eTestPlugin,
  createMcpClient,
  startTestServer,
  startStrictCspServer,
  startMcpServer,
  createExtensionCopy,
  launchExtensionContext,
  readPluginToolNames,
  E2E_TEST_PLUGIN_DIR,
  ROOT,
};
export type {
  HealthResponse,
  PluginDetail,
  McpServer,
  TestServer,
  McpClient,
  OpentabsConfig,
  ProgressNotification,
  McpResource,
  McpResourceContent,
  McpPrompt,
  McpPromptMessage,
};
