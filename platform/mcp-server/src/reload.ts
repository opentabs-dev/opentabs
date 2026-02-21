/**
 * Hot reload orchestration module.
 *
 * Encapsulates the entire reload sequence: config loading, plugin discovery,
 * state swap, stale entry pruning, MCP handler re-registration, file watcher
 * restart, extension re-sync, client notification, and version check.
 *
 * Called on every module evaluation (both first load and hot reload). This
 * separation keeps index.ts as a thin frozen shell (Bun.serve() delegate,
 * HotState management, handler definitions) that rarely needs to change,
 * while all reload logic lives here and is freely editable.
 */

import { browserTools } from './browser-tools/index.js';
import { loadConfig, getConfigDir } from './config.js';
import { discoverPluginsLegacy } from './discovery-legacy.js';
import { ensureExtensionInstalled } from './extension-install.js';
import { sendSyncFull, sendPluginUpdate, cleanupStaleExecFiles } from './extension-protocol.js';
import { startConfigWatching, startFileWatching, stopFileWatching } from './file-watcher.js';
import { sweepStaleSessions } from './http-routes.js';
import { log } from './logger.js';
import { registerMcpHandlers, rebuildToolLookups, notifyToolListChanged } from './mcp-setup.js';
import { prefixedToolName } from './state.js';
import { checkForUpdates } from './version-check.js';
import { isAbsolute, resolve } from 'node:path';
import type { McpServerInstance } from './mcp-setup.js';
import type { ServerState } from './state.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

/** Metadata from a completed reload, stored on HotState for the /health endpoint */
interface ReloadResult {
  lastReloadTimestamp: number;
  lastReloadDurationMs: number;
}

/**
 * globalThis key for the concurrent reload guard promise.
 * Stored on globalThis so it survives across bun --hot re-evaluations.
 * If a reload is in progress when bun --hot triggers, the new module
 * evaluation waits for the previous reload to finish before starting.
 */
const RELOAD_GUARD_KEY = '__opentabs_reload_guard__' as const;

const getReloadGuard = (): Promise<void> | undefined =>
  (globalThis as Record<string, unknown>)[RELOAD_GUARD_KEY] as Promise<void> | undefined;

const setReloadGuard = (promise: Promise<void> | undefined): void => {
  (globalThis as Record<string, unknown>)[RELOAD_GUARD_KEY] = promise;
};

/** Arguments for the shared reload core */
interface ReloadCoreArgs {
  state: ServerState;
  sessionServers: McpServerInstance[];
  transports: Map<string, WebStandardStreamableHTTPServerTransport>;
}

/**
 * Shared reload core: discovery, state swap, pruning, file watcher restart,
 * and extension sync. Both performReload and performConfigReload delegate to
 * this function. Callers are responsible for notifying MCP clients of tool
 * list changes after this function returns.
 *
 * Wraps discovery in an inner try/catch so file watchers are always restarted
 * regardless of discovery success or failure.
 */
const reloadCore = async ({ state, sessionServers, transports }: ReloadCoreArgs): Promise<void> => {
  // Stop previous file watchers so they can be restarted with fresh callbacks
  stopFileWatching(state);

  // Sweep stale MCP session entries whose transport has been removed.
  // This prevents unbounded growth of sessionServers when clients
  // disconnect ungracefully (network partition, OOM kill).
  sweepStaleSessions(state, transports, sessionServers);

  // Shared helper: notify all connected MCP client sessions that the tool
  // list changed. Used by file watcher callbacks that persist until the
  // next reload.
  const notifyAllClients = (): void => {
    for (const srv of sessionServers) {
      notifyToolListChanged(srv);
    }
  };

  // File watcher callbacks — defined once and reused for both the success
  // path and the error recovery path (where we restart watchers on the
  // previous state so they aren't left dead).
  const fileWatcherCallbacks = {
    onManifestChanged: (pluginName: string) => {
      rebuildToolLookups(state);
      notifyAllClients();
      const plugin = state.plugins.get(pluginName);
      if (plugin) {
        void sendPluginUpdate(state, pluginName, plugin.iife).catch((err: unknown) => {
          log.error(`Failed to write adapter file for ${pluginName}:`, err);
        });
      }
    },
    onIifeChanged: (pluginName: string, iife: string) => {
      void sendPluginUpdate(state, pluginName, iife).catch((err: unknown) => {
        log.error(`Failed to write adapter file for ${pluginName}:`, err);
      });
    },
    onConfigChanged: () => {
      void performConfigReload(state, sessionServers, transports).catch((err: unknown) => {
        log.error('Config watcher reload failed:', err);
      });
    },
    onPluginDiscovered: (pluginName: string) => {
      log.info(`Plugin "${pluginName}" discovered by file watcher — rebuilding tools and syncing extension`);
      rebuildToolLookups(state);
      notifyAllClients();
      if (state.extensionWs) {
        void sendSyncFull(state).catch((err: unknown) => {
          log.error('Failed to sync extension after plugin discovery:', err);
        });
      }
    },
  };

  // Track resolved plugin paths across the try/catch so the file watcher
  // can watch pending paths even if discovery partially fails.
  let resolvedPaths: string[] = [];

  try {
    // Load config and discover plugins into a new Map. The Map is swapped
    // onto state atomically so concurrent tools/list requests see either
    // the old complete set or the new complete set, never an empty intermediate.
    const config = await loadConfig();
    // Config stores raw paths (may be relative). Resolve them against the config
    // directory before passing to discoverPlugins, which expects absolute paths.
    const configDir = getConfigDir();
    resolvedPaths = config.plugins.map(p => (isAbsolute(p) ? p : resolve(configDir, p)));
    const { plugins: newPlugins, failures } = await discoverPluginsLegacy(resolvedPaths, config.npmPlugins ?? []);

    // Atomic swap
    state.plugins = newPlugins;
    state.failedPlugins = failures;
    state.toolConfig = { ...config.tools };
    state.pluginPaths = [...config.plugins];
    state.npmPlugins = [...(config.npmPlugins ?? [])];
    state.wsSecret = config.secret ?? null;

    log.info(
      `Config loaded: ${config.plugins.length} plugin path(s), ${Object.keys(config.tools).length} tool setting(s)`,
    );

    // Rebuild O(1) tool lookup map and cached browser tool JSON schemas
    rebuildToolLookups(state);

    // Prune stale tabMapping entries for plugins that were removed from config
    for (const pluginName of state.tabMapping.keys()) {
      if (!state.plugins.has(pluginName)) {
        state.tabMapping.delete(pluginName);
      }
    }

    // Prune stale activeDispatches entries for removed plugins
    for (const pluginName of state.activeDispatches.keys()) {
      if (!state.plugins.has(pluginName)) {
        state.activeDispatches.delete(pluginName);
      }
    }

    // Prune stale toolConfig entries for plugins/tools that no longer exist.
    // Over time, uninstalled plugins and renamed tools leave orphan entries
    // in config that accumulate as garbage. Build a set of all valid prefixed
    // tool names, then remove any config key not in that set.
    const validToolNames = new Set<string>();
    for (const plugin of state.plugins.values()) {
      for (const tool of plugin.tools) {
        validToolNames.add(prefixedToolName(plugin.name, tool.name));
      }
    }
    let prunedToolConfigCount = 0;
    for (const key of Object.keys(state.toolConfig)) {
      if (!validToolNames.has(key)) {
        Reflect.deleteProperty(state.toolConfig, key);
        prunedToolConfigCount++;
      }
    }
    if (prunedToolConfigCount > 0) {
      log.info(`Pruned ${prunedToolConfigCount} stale tool config entry/entries`);
    }

    // outdatedPlugins stores npm package names, not plugin names. Keep only
    // entries whose npm package name matches a still-present plugin.
    state.outdatedPlugins = state.outdatedPlugins.filter(o =>
      Array.from(state.plugins.values()).some(p => p.npmPackageName === o.name),
    );
  } catch (err) {
    // Discovery or config loading failed. State retains whatever plugins
    // it had before this reload attempt (old set on hot reload, empty on
    // first load). Log the error and continue — file watchers will still
    // be restarted below so they aren't left dead.
    log.error('Reload failed, keeping previous state:', err);
  }

  // File watching — always restart regardless of success/failure so
  // watchers are never left in a stopped state after a partial reload.
  // Pass resolved plugin paths so the watcher can also monitor paths
  // that failed initial discovery and pick them up when built.
  startFileWatching(state, fileWatcherCallbacks, resolvedPaths);
  startConfigWatching(state, fileWatcherCallbacks);

  // Re-sync extension if connected
  if (state.extensionWs) {
    await sendSyncFull(state);
  }
};

/**
 * Clear and restart the periodic sweep timer for stale MCP sessions.
 * Both reload paths call this to ensure the timer is always fresh.
 */
const restartSweepTimer = (
  state: ServerState,
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
  sessionServers: McpServerInstance[],
): void => {
  if (state.sweepTimerId !== null) {
    clearInterval(state.sweepTimerId);
    state.sweepTimerId = null;
  }
  state.sweepTimerId = setInterval(() => {
    sweepStaleSessions(state, transports, sessionServers);
  }, 60_000);
};

/**
 * Run the full reload sequence.
 *
 * On first load: discovers plugins, starts file watchers, kicks off version check.
 * On hot reload: additionally re-registers MCP handlers on existing sessions,
 * refreshes browser tools, installs/updates the managed extension, and notifies
 * all MCP clients.
 *
 * If discovery fails, the server continues with whatever plugins were in state
 * before the reload attempt. File watchers are always restarted at the end so
 * they are never left dead after a partial failure.
 *
 * A globalThis-based guard prevents concurrent reloads: if a previous reload
 * is still running (e.g., bun --hot fires twice in quick succession), this
 * call waits for it to finish before proceeding.
 */
const performReload = async (
  state: ServerState,
  sessionServers: McpServerInstance[],
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
  isHotReload: boolean,
): Promise<ReloadResult> => {
  // Wait for any in-flight reload to complete before starting a new one
  const existingGuard = getReloadGuard();
  if (existingGuard) {
    log.info('Waiting for in-flight reload to complete before starting new reload...');
    await existingGuard;
  }

  // Create a deferred promise that other callers can await
  let resolveGuard!: () => void;
  const guard = new Promise<void>(resolve => {
    resolveGuard = resolve;
  });
  setReloadGuard(guard);
  const startTs = Date.now();

  try {
    // Clear the previous periodic sweep timer — it closes over stale references
    // from the previous module evaluation. A fresh timer is started below.
    restartSweepTimer(state, transports, sessionServers);

    // Ensure the managed extension in ~/.opentabs/extension/ is up to date.
    // Isolated from the rest of reload so a transient filesystem error
    // (cpSync, mkdirSync, Bun.write) does not block plugin discovery.
    try {
      await ensureExtensionInstalled();
    } catch (err) {
      log.warn('Extension install failed (continuing with plugin discovery):', err);
    }

    // Remove leftover __exec-*.js files from previous sessions/crashes
    try {
      await cleanupStaleExecFiles();
    } catch (err) {
      log.warn('Exec file cleanup failed:', err);
    }

    // Update browser tools from the fresh module import (bun --hot re-evaluates
    // the import chain so browserTools contains the latest definitions)
    state.browserTools = browserTools;

    await reloadCore({ state, sessionServers, transports });

    // Re-register MCP handlers on ALL existing sessions so they invoke the
    // latest handler logic (dispatchToExtension, browser tools, etc.).
    // Each session is wrapped individually so one failing session doesn't
    // block the rest. On first load, sessionServers is empty so this is skipped.
    if (isHotReload) {
      let reregistered = 0;
      for (const srv of sessionServers) {
        try {
          registerMcpHandlers(srv, state);
          reregistered++;
        } catch (err) {
          log.warn('Failed to re-register handlers on a session:', err);
        }
      }
      log.info(
        `Hot reload: re-registered ${reregistered}/${sessionServers.length} session(s), notifying of tool list change`,
      );
      for (const srv of sessionServers) {
        notifyToolListChanged(srv);
      }
    }

    // Version check: non-blocking, best-effort on every reload
    void checkForUpdates(state).catch(() => {
      // Update check is best-effort — failures are not actionable
    });

    const durationMs = Date.now() - startTs;
    return {
      lastReloadTimestamp: Date.now(),
      lastReloadDurationMs: durationMs,
    };
  } finally {
    // Clear the guard so subsequent reloads can proceed immediately
    resolveGuard();
    setReloadGuard(undefined);
  }
};

/**
 * Reload config and rediscover plugins at runtime without bun --hot.
 * Called from the POST /reload HTTP endpoint. Performs the same config/plugin
 * rediscovery as performReload but without the bun --hot-specific module
 * re-evaluation aspects (browser tools refresh, session handler re-registration).
 *
 * Returns the number of plugins discovered and the duration in milliseconds.
 */
const performConfigReload = async (
  state: ServerState,
  sessionServers: McpServerInstance[],
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
): Promise<{ plugins: number; durationMs: number }> => {
  const existingGuard = getReloadGuard();
  if (existingGuard) {
    await existingGuard;
  }

  let resolveGuard!: () => void;
  const guard = new Promise<void>(resolve => {
    resolveGuard = resolve;
  });
  setReloadGuard(guard);
  const startTs = Date.now();

  try {
    // Clear and restart the sweep timer so it uses fresh references
    restartSweepTimer(state, transports, sessionServers);

    await reloadCore({ state, sessionServers, transports });

    // Notify all MCP clients that the tool list changed after config reload.
    // (performReload handles its own notification after handler re-registration,
    // so reloadCore itself does not notify — each caller is responsible.)
    for (const srv of sessionServers) {
      notifyToolListChanged(srv);
    }

    log.info(`Config reload complete: ${state.plugins.size} plugin(s) in ${Date.now() - startTs}ms`);

    return { plugins: state.plugins.size, durationMs: Date.now() - startTs };
  } finally {
    resolveGuard();
    setReloadGuard(undefined);
  }
};

export type { ReloadResult };
export { performReload, performConfigReload };
