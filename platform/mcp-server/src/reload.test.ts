import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stopFileWatching } from './file-watcher.js';
import { performConfigReload, performReload } from './reload.js';
import { resetGlobalPathsCache } from './resolver.js';
import type { ExtensionConnection, ServerState } from './state.js';
import { createState, getMergedTabMapping } from './state.js';
import { checkForUpdates } from './version-check.js';

vi.mock('./version-check.js');

/**
 * Integration tests for the reload module.
 *
 * Uses a real temp config directory (via OPENTABS_CONFIG_DIR) to exercise the
 * full reload path: config loading → plugin discovery → state swap → pruning →
 * extension sync → client notification.
 *
 * These tests run in production mode (no OPENTABS_DEV env var), so file watchers
 * and config watching are NOT started. Dev-mode file watcher behavior is covered
 * by E2E tests that start the server with --dev.
 */

const originalConfigDir = process.env.OPENTABS_CONFIG_DIR;

/** Create a minimal mock McpServerInstance that tracks method calls */
const createMockServer = () => ({
  setRequestHandler: () => {},
  connect: () => Promise.resolve(),
  sendToolListChanged: () => Promise.resolve(),
  sendLoggingMessage: () => Promise.resolve(),
});

/** Typed empty transports map */
const emptyTransports = (): Map<string, WebStandardStreamableHTTPServerTransport> => new Map();

/** Write a config.json to the given directory */
const writeConfig = (configDir: string, localPlugins: string[] = []): void => {
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({ localPlugins, permissions: {} }));
};

/** Create a minimal valid plugin directory with package.json, tools.json, and adapter */
const createPluginDir = (baseDir: string, name: string): string => {
  const pluginDir = join(baseDir, name);
  const distDir = join(pluginDir, 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'package.json'),
    JSON.stringify({
      name: `opentabs-plugin-${name}`,
      version: '1.0.0',
      main: 'dist/adapter.iife.js',
      opentabs: {
        displayName: name,
        description: 'A test plugin',
        urlPatterns: ['http://localhost/*'],
      },
    }),
  );
  writeFileSync(
    join(distDir, 'tools.json'),
    JSON.stringify([
      {
        name: 'test_tool',
        displayName: 'Test Tool',
        description: 'A test tool',
        icon: 'wrench',
        input_schema: {},
        output_schema: {},
      },
    ]),
  );
  writeFileSync(join(distDir, 'adapter.iife.js'), '(function(){window.__test=true})()');
  return pluginDir;
};

describe('performReload', () => {
  let configDir: string;
  let state: ServerState;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'opentabs-reload-test-'));
    writeConfig(configDir);
    process.env.OPENTABS_CONFIG_DIR = configDir;
    state = createState();

    // Clear the globalThis reload chain
    (globalThis as Record<string, unknown>).__opentabs_reload_chain__ = undefined;
    // Isolate from real globally-installed npm plugins by pointing the global paths cache
    // to an empty list, so auto-discovery finds no global node_modules directories.
    (globalThis as Record<string, unknown>).__opentabs_global_paths__ = [];
  });

  afterEach(() => {
    stopFileWatching(state);
    rmSync(configDir, { recursive: true, force: true });
    resetGlobalPathsCache();
  });

  afterAll(() => {
    if (originalConfigDir !== undefined) {
      process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.OPENTABS_CONFIG_DIR;
    }
  });

  test('returns reload result with timestamp and duration', async () => {
    const result = await performReload(state, [], emptyTransports(), false);

    expect(result.lastReloadTimestamp).toBeGreaterThan(0);
    expect(result.lastReloadDurationMs).toBeGreaterThanOrEqual(0);
  });

  test('loads plugin paths from config into state', async () => {
    writeConfig(configDir, ['/path/to/alpha', '/path/to/beta']);
    await performReload(state, [], emptyTransports(), false);

    expect(state.pluginPaths).toEqual(['/path/to/alpha', '/path/to/beta']);
  });

  test('discovers plugins from local paths', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');
    writeConfig(configDir, [pluginDir]);

    await performReload(state, [], emptyTransports(), false);

    expect(state.registry.plugins.has('my-plugin')).toBe(true);
    const plugin = state.registry.plugins.get('my-plugin');
    expect(plugin?.version).toBe('1.0.0');
    expect(plugin?.tools).toHaveLength(1);
  });

  test('prunes stale tabMapping entries for removed plugins', async () => {
    const conn: ExtensionConnection = {
      ws: { send() {}, close() {} },
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    };
    state.extensionConnections.set('test-conn', conn);
    conn.tabMapping.set('old-plugin', {
      state: 'ready',
      tabs: [{ tabId: 1, url: 'http://example.com', title: 'Example', ready: true }],
    });
    conn.tabMapping.set('my-plugin', {
      state: 'ready',
      tabs: [{ tabId: 2, url: 'http://alpha.com', title: 'Alpha', ready: true }],
    });

    const pluginDir = createPluginDir(configDir, 'my-plugin');
    writeConfig(configDir, [pluginDir]);

    await performReload(state, [], emptyTransports(), false);

    expect(getMergedTabMapping(state).has('old-plugin')).toBe(false);
    expect(getMergedTabMapping(state).has('my-plugin')).toBe(true);
  });

  test('prunes stale activeDispatches entries for removed plugins', async () => {
    state.activeDispatches.set('old-plugin', 2);
    state.activeDispatches.set('my-plugin', 1);

    const pluginDir = createPluginDir(configDir, 'my-plugin');
    writeConfig(configDir, [pluginDir]);

    await performReload(state, [], emptyTransports(), false);

    expect(state.activeDispatches.has('old-plugin')).toBe(false);
    expect(state.activeDispatches.has('my-plugin')).toBe(true);
  });

  test('prunes stale pluginPermissions entries for removed plugins', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');

    // Write config with 'browser' in the permissions map so it survives the config swap.
    // reloadCore replaces state.pluginPermissions with { ...config.permissions } before
    // pruning, so only keys present in config.permissions can be tested for pruning behavior.
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        localPlugins: [pluginDir],
        permissions: {
          'my-plugin': { permission: 'auto' },
          'old-plugin': { permission: 'ask' },
          browser: { permission: 'auto' },
        },
      }),
    );

    await performReload(state, [], emptyTransports(), false);

    // 'old-plugin' is not in the registry — pruned by pruneStaleState
    expect('old-plugin' in state.pluginPermissions).toBe(false);
    // 'browser' is preserved by pruneStaleState even though it's not a plugin in the registry
    expect('browser' in state.pluginPermissions).toBe(true);
    // 'my-plugin' is in the registry — preserved
    expect('my-plugin' in state.pluginPermissions).toBe(true);
  });

  test('prunes stale per-tool overrides within surviving plugin permissions', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');

    // Write config with per-tool overrides including a stale tool name
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        localPlugins: [pluginDir],
        permissions: {
          'my-plugin': {
            permission: 'ask',
            tools: {
              test_tool: 'auto', // matches the tool in createPluginDir
              removed_tool: 'off', // stale — no such tool in registry
            },
          },
        },
      }),
    );

    await performReload(state, [], emptyTransports(), false);

    const pluginPerms = state.pluginPermissions['my-plugin'];
    expect(pluginPerms?.tools?.test_tool).toBe('auto');
    expect(pluginPerms?.tools?.removed_tool).toBeUndefined();
  });

  test('prunes stale per-tool overrides for browser pseudo-plugin', async () => {
    writeConfig(configDir);

    // Pre-populate pluginPermissions with browser tool overrides
    // (config.permissions is empty, so browser entry won't survive config swap)
    // Instead, write it into the config
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        localPlugins: [],
        permissions: {
          browser: {
            permission: 'auto',
            tools: {
              existing_tool: 'ask',
              removed_tool: 'off',
            },
          },
        },
      }),
    );

    await performReload(state, [], emptyTransports(), false);

    // After reload, cachedBrowserTools has the actual browser tools.
    // The pruning should remove 'removed_tool' and 'existing_tool' since
    // neither matches any actual browser tool names in cachedBrowserTools.
    const browserPerms = state.pluginPermissions.browser;
    // Both tool names are stale (not real browser tool names)
    expect(browserPerms?.tools?.removed_tool).toBeUndefined();
    expect(browserPerms?.tools?.existing_tool).toBeUndefined();
  });

  test('rebuilds toolLookup after reload', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');
    writeConfig(configDir, [pluginDir]);

    await performReload(state, [], emptyTransports(), false);

    expect(state.registry.toolLookup.has('my-plugin_test_tool')).toBe(true);
    const entry = state.registry.toolLookup.get('my-plugin_test_tool');
    expect(entry?.pluginName).toBe('my-plugin');
    expect(entry?.toolName).toBe('test_tool');
  });

  test('does not start file watchers in production mode', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');
    writeConfig(configDir, [pluginDir]);

    await performReload(state, [], emptyTransports(), false);

    // File watchers are dev-only — production mode discovers once at startup
    expect(state.fileWatching.entries).toHaveLength(0);
  });

  test('does NOT throw when extension is disconnected (sync skipped)', async () => {
    state.extensionConnections.clear();

    // sendSyncFull is guarded by `isExtensionConnected(state)` — test verifies
    // the reload completes without error when no extension is connected
    await performReload(state, [], emptyTransports(), false);
  });

  test('re-registers MCP handlers on hot reload', async () => {
    let registerCalled = 0;
    const srv = {
      ...createMockServer(),
      setRequestHandler: () => {
        registerCalled++;
      },
    };

    await performReload(state, [srv], emptyTransports(), true);

    // registerMcpHandlers calls setRequestHandler 2 times: tools/list, tools/call
    expect(registerCalled).toBe(2);
  });

  test('does NOT re-register MCP handlers on initial load', async () => {
    let registerCalled = 0;
    const srv = {
      ...createMockServer(),
      setRequestHandler: () => {
        registerCalled++;
      },
    };

    await performReload(state, [srv], emptyTransports(), false);

    expect(registerCalled).toBe(0);
  });

  test('filters outdatedPlugins to only include still-present npm packages', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');
    writeConfig(configDir, [pluginDir]);

    // Local plugins have no npmPackageName, so both npm entries are pruned
    state.outdatedPlugins = [
      {
        name: 'opentabs-plugin-alpha',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        updateCommand: 'npm update -g opentabs-plugin-alpha',
      },
      {
        name: 'opentabs-plugin-gone',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        updateCommand: 'npm update -g opentabs-plugin-gone',
      },
    ];

    await performReload(state, [], emptyTransports(), false);

    expect(state.outdatedPlugins).toHaveLength(0);
  });

  test('notifies MCP sessions of tool list changes on hot reload', async () => {
    let toolNotifyCalled = 0;
    const srv = {
      ...createMockServer(),
      sendToolListChanged: () => {
        toolNotifyCalled++;
        return Promise.resolve();
      },
    };

    await performReload(state, [srv], emptyTransports(), true);

    // notifyToolListChanged is called exactly once from the hot reload path
    // (reloadCore does not notify — each caller is responsible)
    expect(toolNotifyCalled).toBe(1);
  });

  test('preserves skipPermissions=true across reload', async () => {
    state.skipPermissions = true;

    await performReload(state, [createMockServer()], emptyTransports(), false);

    expect(state.skipPermissions).toBe(true);
  });

  test('preserves skipPermissions=false across reload (e.g. after "Restore approvals")', async () => {
    // Simulate: env var was set at startup (skipPermissions=true), then user clicked
    // "Restore approvals" (skipPermissions=false). Reload should NOT re-read the env var.
    state.skipPermissions = false;

    await performReload(state, [createMockServer()], emptyTransports(), false);

    expect(state.skipPermissions).toBe(false);
  });
});

describe('performReload — concurrent reload guard', () => {
  let configDir: string;
  let state: ServerState;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'opentabs-reload-guard-'));
    writeConfig(configDir);
    process.env.OPENTABS_CONFIG_DIR = configDir;
    state = createState();

    (globalThis as Record<string, unknown>).__opentabs_reload_chain__ = undefined;
    (globalThis as Record<string, unknown>).__opentabs_global_paths__ = [];
  });

  afterEach(() => {
    stopFileWatching(state);
    rmSync(configDir, { recursive: true, force: true });
    resetGlobalPathsCache();
  });

  afterAll(() => {
    if (originalConfigDir !== undefined) {
      process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.OPENTABS_CONFIG_DIR;
    }
  });

  test('concurrent reloads both complete successfully', async () => {
    const executionOrder: string[] = [];

    const reload1 = performReload(state, [], emptyTransports(), false).then(() => {
      executionOrder.push('reload1-done');
    });
    const reload2 = performReload(state, [], emptyTransports(), false).then(() => {
      executionOrder.push('reload2-done');
    });

    await Promise.all([reload1, reload2]);

    expect(executionOrder).toContain('reload1-done');
    expect(executionOrder).toContain('reload2-done');
    expect(executionOrder).toHaveLength(2);
  });

  test('reload blocks until the previous chain link resolves', async () => {
    let resolveBlocker!: () => void;
    const blocker = new Promise<void>(resolve => {
      resolveBlocker = resolve;
    });

    // Simulate an in-flight reload by placing an unresolved promise in the chain
    (globalThis as Record<string, unknown>).__opentabs_reload_chain__ = blocker;

    let completed = false;
    const reloadPromise = performReload(state, [], emptyTransports(), false).then(() => {
      completed = true;
    });

    // Let microtasks flush — the reload should be blocked on the unresolved chain link
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(completed).toBe(false);

    // Unblock the chain — the reload should now proceed and complete
    resolveBlocker();
    await reloadPromise;
    expect(completed).toBe(true);
  });

  test('reload chain link is resolved after reload completes', async () => {
    await performReload(state, [], emptyTransports(), false);

    // The chain stores the resolved promise (not undefined) so subsequent
    // callers can chain onto it without a race window
    const chain = (globalThis as Record<string, unknown>).__opentabs_reload_chain__;
    expect(chain).toBeInstanceOf(Promise);
    // Awaiting a resolved promise completes immediately
    await chain;
  });
});

describe('performConfigReload', () => {
  let configDir: string;
  let state: ServerState;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'opentabs-config-reload-'));
    writeConfig(configDir);
    process.env.OPENTABS_CONFIG_DIR = configDir;
    state = createState();

    (globalThis as Record<string, unknown>).__opentabs_reload_chain__ = undefined;
    // Isolate from real globally-installed npm plugins by pointing the global paths cache
    // to an empty list, so auto-discovery finds no global node_modules directories.
    (globalThis as Record<string, unknown>).__opentabs_global_paths__ = [];
  });

  afterEach(() => {
    stopFileWatching(state);
    rmSync(configDir, { recursive: true, force: true });
    resetGlobalPathsCache();
  });

  afterAll(() => {
    if (originalConfigDir !== undefined) {
      process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.OPENTABS_CONFIG_DIR;
    }
  });

  test('returns plugin count and duration', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');
    writeConfig(configDir, [pluginDir]);

    const result = await performConfigReload(state, [], emptyTransports());

    expect(result.plugins).toBeGreaterThanOrEqual(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('prunes stale tabMapping entries', async () => {
    const conn: ExtensionConnection = {
      ws: { send() {}, close() {} },
      connectionId: 'test-conn',
      profileLabel: 'test-conn',
      tabMapping: new Map(),
      activeNetworkCaptures: new Set(),
    };
    state.extensionConnections.set('test-conn', conn);
    conn.tabMapping.set('removed-plugin', {
      state: 'ready',
      tabs: [{ tabId: 1, url: 'http://example.com', title: 'Example', ready: true }],
    });

    await performConfigReload(state, [], emptyTransports());

    expect(getMergedTabMapping(state).has('removed-plugin')).toBe(false);
  });

  test('does not start file watchers in production mode', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');
    writeConfig(configDir, [pluginDir]);

    expect(state.fileWatching.entries).toHaveLength(0);

    await performConfigReload(state, [], emptyTransports());

    // File watchers are dev-only — production mode discovers once at startup
    expect(state.fileWatching.entries).toHaveLength(0);
  });

  test('notifies all sessions of tool list changes', async () => {
    let toolNotifyCalled = 0;
    const srv = {
      ...createMockServer(),
      sendToolListChanged: () => {
        toolNotifyCalled++;
        return Promise.resolve();
      },
    };

    await performConfigReload(state, [srv], emptyTransports());

    expect(toolNotifyCalled).toBeGreaterThanOrEqual(1);
  });

  test('state fields are not mutated when rebuildCachedBrowserTools throws', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');
    writeConfig(configDir, [pluginDir]);

    // Install a browser tool whose .input getter throws, simulating a schema build failure.
    // rebuildCachedBrowserTools maps over state.browserTools and accesses bt.input for each.
    const badBrowserTool: Record<string, unknown> = {
      name: 'bad_tool',
      description: 'bad',
      handler: () => Promise.resolve([]),
    };
    Object.defineProperty(badBrowserTool, 'input', {
      get() {
        throw new Error('intentional schema build failure');
      },
      enumerable: true,
    });
    state.browserTools = [badBrowserTool as unknown as (typeof state.browserTools)[0]];

    const initialRegistry = state.registry;
    const initialPluginPermissions = state.pluginPermissions;

    // performConfigReload catches the error from rebuildCachedBrowserTools and logs it.
    // State must retain all previous values — no partial mutation should have occurred.
    await performConfigReload(state, [], emptyTransports());

    expect(state.registry).toBe(initialRegistry);
    expect(state.registry.plugins.has('my-plugin')).toBe(false);
    expect(state.pluginPermissions).toBe(initialPluginPermissions);
  });

  test('concurrent config reloads both complete successfully', async () => {
    const transports = emptyTransports();

    const results = await Promise.all([
      performConfigReload(state, [], transports),
      performConfigReload(state, [], transports),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(results[1].durationMs).toBeGreaterThanOrEqual(0);

    // Chain stores a resolved promise (not undefined)
    const chain = (globalThis as Record<string, unknown>).__opentabs_reload_chain__;
    expect(chain).toBeInstanceOf(Promise);
  });

  test('config reload blocks until the previous chain link resolves', async () => {
    let resolveBlocker!: () => void;
    const blocker = new Promise<void>(resolve => {
      resolveBlocker = resolve;
    });

    // Simulate an in-flight reload by placing an unresolved promise in the chain
    (globalThis as Record<string, unknown>).__opentabs_reload_chain__ = blocker;

    let completed = false;
    const reloadPromise = performConfigReload(state, [], emptyTransports()).then(() => {
      completed = true;
    });

    // Let microtasks flush — the reload should be blocked on the unresolved chain link
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(completed).toBe(false);

    // Unblock the chain — the reload should now proceed and complete
    resolveBlocker();
    await reloadPromise;
    expect(completed).toBe(true);
  });
});

describe('reviewedVersion reset on plugin update', () => {
  let configDir: string;
  let state: ServerState;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'opentabs-version-reset-'));
    writeConfig(configDir);
    process.env.OPENTABS_CONFIG_DIR = configDir;
    state = createState();

    (globalThis as Record<string, unknown>).__opentabs_reload_chain__ = undefined;
    (globalThis as Record<string, unknown>).__opentabs_global_paths__ = [];
  });

  afterEach(() => {
    stopFileWatching(state);
    rmSync(configDir, { recursive: true, force: true });
    resetGlobalPathsCache();
  });

  afterAll(() => {
    if (originalConfigDir !== undefined) {
      process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.OPENTABS_CONFIG_DIR;
    }
  });

  test('version mismatch resets permission to off and clears reviewedVersion', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');

    // Plugin is at v1.0.0 (from createPluginDir), but config says reviewedVersion 0.9.0
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        localPlugins: [pluginDir],
        permissions: {
          'my-plugin': { permission: 'auto', reviewedVersion: '0.9.0' },
        },
      }),
    );

    await performReload(state, [], emptyTransports(), false);

    expect(state.pluginPermissions['my-plugin']?.permission).toBe('off');
    expect(state.pluginPermissions['my-plugin']?.reviewedVersion).toBeUndefined();
  });

  test('version match preserves permission and reviewedVersion', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');

    // Plugin is at v1.0.0, reviewedVersion matches
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        localPlugins: [pluginDir],
        permissions: {
          'my-plugin': { permission: 'auto', reviewedVersion: '1.0.0' },
        },
      }),
    );

    await performReload(state, [], emptyTransports(), false);

    expect(state.pluginPermissions['my-plugin']?.permission).toBe('auto');
    expect(state.pluginPermissions['my-plugin']?.reviewedVersion).toBe('1.0.0');
  });

  test('absent reviewedVersion preserves permission', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');

    // No reviewedVersion — fresh install, permission stays at configured value
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        localPlugins: [pluginDir],
        permissions: {
          'my-plugin': { permission: 'ask' },
        },
      }),
    );

    await performReload(state, [], emptyTransports(), false);

    expect(state.pluginPermissions['my-plugin']?.permission).toBe('ask');
    expect(state.pluginPermissions['my-plugin']?.reviewedVersion).toBeUndefined();
  });

  test('version reset is persisted to config.json', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');

    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        localPlugins: [pluginDir],
        permissions: {
          'my-plugin': { permission: 'auto', reviewedVersion: '0.9.0' },
        },
      }),
    );

    await performReload(state, [], emptyTransports(), false);

    // savePluginPermissions is fire-and-forget — wait for the async write to complete
    await new Promise(resolve => setTimeout(resolve, 200));

    const persisted = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'));
    expect(persisted.permissions['my-plugin'].permission).toBe('off');
    expect(persisted.permissions['my-plugin'].reviewedVersion).toBeUndefined();
  });

  test('version mismatch clears per-tool overrides', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');

    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        localPlugins: [pluginDir],
        permissions: {
          'my-plugin': {
            permission: 'auto',
            tools: { test_tool: 'auto', other_tool: 'ask' },
            reviewedVersion: '0.9.0',
          },
        },
      }),
    );

    await performReload(state, [], emptyTransports(), false);

    expect(state.pluginPermissions['my-plugin']?.permission).toBe('off');
    expect(state.pluginPermissions['my-plugin']?.reviewedVersion).toBeUndefined();
    expect(state.pluginPermissions['my-plugin']?.tools).toBeUndefined();
  });

  test('version reset persists cleared tools to config.json', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');

    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        localPlugins: [pluginDir],
        permissions: {
          'my-plugin': {
            permission: 'auto',
            tools: { test_tool: 'auto' },
            reviewedVersion: '0.9.0',
          },
        },
      }),
    );

    await performReload(state, [], emptyTransports(), false);

    // savePluginPermissions is fire-and-forget — wait for the async write to complete
    await new Promise(resolve => setTimeout(resolve, 200));

    const persisted = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'));
    expect(persisted.permissions['my-plugin'].permission).toBe('off');
    expect(persisted.permissions['my-plugin'].reviewedVersion).toBeUndefined();
    expect(persisted.permissions['my-plugin'].tools).toBeUndefined();
  });

  test('browser pseudo-plugin is not affected by version reset', async () => {
    const pluginDir = createPluginDir(configDir, 'my-plugin');

    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        localPlugins: [pluginDir],
        permissions: {
          browser: { permission: 'auto', reviewedVersion: '0.0.0' },
          'my-plugin': { permission: 'auto', reviewedVersion: '1.0.0' },
        },
      }),
    );

    await performReload(state, [], emptyTransports(), false);

    // Browser is skipped by resetStaleReviewedVersions
    expect(state.pluginPermissions.browser?.permission).toBe('auto');
    expect(state.pluginPermissions.browser?.reviewedVersion).toBe('0.0.0');
  });
});

describe('performConfigReload — checkForUpdates is NOT called', () => {
  let configDir: string;
  let state: ServerState;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'opentabs-update-check-'));
    writeConfig(configDir);
    process.env.OPENTABS_CONFIG_DIR = configDir;
    state = createState();

    (globalThis as Record<string, unknown>).__opentabs_reload_chain__ = undefined;
    (globalThis as Record<string, unknown>).__opentabs_global_paths__ = [];

    vi.mocked(checkForUpdates).mockClear();
    vi.mocked(checkForUpdates).mockResolvedValue(undefined);
  });

  afterEach(() => {
    stopFileWatching(state);
    rmSync(configDir, { recursive: true, force: true });
    resetGlobalPathsCache();
  });

  afterAll(() => {
    if (originalConfigDir !== undefined) {
      process.env.OPENTABS_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.OPENTABS_CONFIG_DIR;
    }
  });

  test('performConfigReload does NOT call checkForUpdates', async () => {
    await performConfigReload(state, [], emptyTransports());

    expect(vi.mocked(checkForUpdates)).not.toHaveBeenCalled();
  });

  test('performReload does NOT call checkForUpdates', async () => {
    await performReload(state, [], emptyTransports(), false);

    expect(vi.mocked(checkForUpdates)).not.toHaveBeenCalled();
  });
});
