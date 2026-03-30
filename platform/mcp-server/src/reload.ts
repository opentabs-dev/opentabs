/**
 * Hot reload orchestration module.
 *
 * Encapsulates the entire reload sequence: config loading, plugin discovery,
 * state swap, stale entry pruning, MCP handler re-registration, file watcher
 * restart, extension re-sync, client notification, and version check.
 *
 * Called on every module evaluation (both first load and hot reload). This
 * separation keeps index.ts as a thin frozen shell (HTTP server delegate,
 * HotState management, handler definitions) that rarely needs to change,
 * while all reload logic lives here and is freely editable.
 */

import { realpath } from 'node:fs/promises';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { browserTools } from './browser-tools/index.js';
import { getConfigDir, loadConfig, loadSecret, savePluginPermissions } from './config.js';
import { isDev } from './dev-mode.js';
import { discoverPlugins } from './discovery.js';
import { buildConfigStatePayload, sendToExtension } from './extension-handlers.js';
import { ensureExtensionInstalled } from './extension-install.js';
import {
  cleanupStaleExecFiles,
  sendExtensionReload,
  sendPluginUpdate,
  sendSyncFull,
  writeAllAdapterFiles,
} from './extension-protocol.js';
import { startConfigWatching, startFileWatching, stopFileWatching } from './file-watcher.js';
import { sweepStaleSessions } from './http-routes.js';
import { pruneStaleBuffers } from './log-buffer.js';
import { log } from './logger.js';
import type { McpServerInstance } from './mcp-setup.js';
import { notifyToolListChanged, rebuildCachedBrowserTools, registerMcpHandlers } from './mcp-setup.js';
import { buildRegistry } from './registry.js';
import { resolveLocalPath, scanLocalPluginDir } from './resolver.js';
import type { CachedBrowserTool, ServerState } from './state.js';
import { isExtensionConnected } from './state.js';
import { checkForUpdates } from './version-check.js';

/** Metadata from a completed reload, stored on HotState for the /health endpoint */
interface ReloadResult {
  lastReloadTimestamp: number;
  lastReloadDurationMs: number;
}

/**
 * globalThis key for the reload serialization chain.
 * Stored on globalThis so it survives across hot reload re-evaluations.
 *
 * Each reload appends to the chain synchronously (before any await), then
 * awaits the previous link. This guarantees serial execution: even if
 * multiple callers enter the function in the same microtask, each one sees
 * the predecessor that was set by the previous synchronous frame, so the
 * await graph forms a strict sequence with no concurrent window.
 */
const RELOAD_CHAIN_KEY = '__opentabs_reload_chain__' as const;

const getReloadChain = (): Promise<void> =>
  ((globalThis as Record<string, unknown>)[RELOAD_CHAIN_KEY] as Promise<void> | undefined) ?? Promise.resolve();

const setReloadChain = (promise: Promise<void>): void => {
  (globalThis as Record<string, unknown>)[RELOAD_CHAIN_KEY] = promise;
};

/**
 * Remove stale entries from state maps after a registry swap.
 * Prunes tabMapping, activeDispatches, pluginPermissions (both
 * plugin-level and per-tool entries), outdatedPlugins, log buffers,
 * and activeNetworkCaptures for plugins/tools that no longer exist
 * in the current registry.
 */
const pruneStaleState = (state: ServerState): void => {
  // Prune stale tab mappings from each connection
  for (const conn of state.extensionConnections.values()) {
    for (const pluginName of conn.tabMapping.keys()) {
      if (!state.registry.plugins.has(pluginName)) {
        conn.tabMapping.delete(pluginName);
      }
    }
  }

  for (const pluginName of state.activeDispatches.keys()) {
    if (!state.registry.plugins.has(pluginName)) {
      state.activeDispatches.delete(pluginName);
    }
  }

  // Prune stale pluginPermissions entries for removed plugins,
  // and prune stale per-tool overrides within surviving plugins.
  const activePluginNames = new Set(state.registry.plugins.keys());
  let prunedPluginPermissionsCount = 0;
  for (const key of Object.keys(state.pluginPermissions)) {
    if (key !== 'browser' && !activePluginNames.has(key)) {
      Reflect.deleteProperty(state.pluginPermissions, key);
      prunedPluginPermissionsCount++;
    }
  }
  if (prunedPluginPermissionsCount > 0) {
    log.info(`Pruned ${prunedPluginPermissionsCount} stale plugin permission entry/entries`);
  }

  // Prune per-tool overrides for tools that no longer exist in the plugin
  for (const [pluginName, config] of Object.entries(state.pluginPermissions)) {
    if (!config.tools) continue;
    const plugin = pluginName === 'browser' ? null : state.registry.plugins.get(pluginName);
    if (pluginName === 'browser') {
      // Browser tool names are in cachedBrowserTools
      const browserToolNames = new Set(state.cachedBrowserTools.map(bt => bt.name));
      for (const toolName of Object.keys(config.tools)) {
        if (!browserToolNames.has(toolName)) {
          Reflect.deleteProperty(config.tools, toolName);
        }
      }
    } else if (plugin) {
      const pluginToolNames = new Set(plugin.tools.map(t => t.name));
      for (const toolName of Object.keys(config.tools)) {
        if (!pluginToolNames.has(toolName)) {
          Reflect.deleteProperty(config.tools, toolName);
        }
      }
    }
  }

  // Prune stale log buffers for removed plugins
  pruneStaleBuffers(new Set(state.registry.plugins.keys()));

  // Keep only outdatedPlugins entries for still-present plugins
  const npmPkgNames = new Set(
    Array.from(state.registry.plugins.values())
      .map(p => p.npmPackageName)
      .filter((n): n is string => n !== undefined),
  );
  state.outdatedPlugins = state.outdatedPlugins.filter(o => npmPkgNames.has(o.name));

  // Prune activeNetworkCaptures for tab IDs no longer present in tabMappings
  for (const conn of state.extensionConnections.values()) {
    const allTabIds = new Set<number>();
    for (const mapping of conn.tabMapping.values()) {
      for (const tab of mapping.tabs) {
        allTabIds.add(tab.tabId);
      }
    }
    for (const tabId of conn.activeNetworkCaptures) {
      if (!allTabIds.has(tabId)) {
        conn.activeNetworkCaptures.delete(tabId);
      }
    }
  }
};

/** Arguments for the shared reload core */
interface ReloadCoreArgs {
  state: ServerState;
  sessionServers: McpServerInstance[];
  transports: Map<string, WebStandardStreamableHTTPServerTransport>;
}

/**
 * Build file watcher callbacks that close over the current state and sessions.
 * Extracted from reloadCore so the core function stays focused on the
 * config → discover → swap → prune pipeline.
 */
const createFileWatcherCallbacks = (
  state: ServerState,
  sessionServers: McpServerInstance[],
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
) => {
  const notifyAllClients = (): void => {
    for (const srv of sessionServers) {
      notifyToolListChanged(srv);
    }
  };

  return {
    onManifestChanged: (pluginName: string) => {
      notifyAllClients();
      const plugin = state.registry.plugins.get(pluginName);
      if (plugin) {
        void sendPluginUpdate(state, pluginName, plugin.iife, plugin.iifeSourceMap).catch((err: unknown) => {
          log.error(`Failed to write adapter file for ${pluginName}:`, err);
        });
      }
    },
    onIifeChanged: (pluginName: string, iife: string, sourceMap?: string) => {
      void sendPluginUpdate(state, pluginName, iife, sourceMap).catch((err: unknown) => {
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
      state.registry = buildRegistry(Array.from(state.registry.plugins.values()), [...state.registry.failures]);
      notifyAllClients();
      if (isExtensionConnected(state)) {
        void sendSyncFull(state).catch((err: unknown) => {
          log.error('Failed to sync extension after plugin discovery:', err);
        });
      }
    },
  };
};

/**
 * Reset permissions for plugins whose reviewedVersion no longer matches the installed version.
 * When a plugin is updated, its permission reverts to 'off' and reviewedVersion is cleared,
 * forcing a re-review before the plugin can be used. Persists the reset to config.json.
 */
const resetStaleReviewedVersions = (state: ServerState): void => {
  let resetCount = 0;

  for (const [pluginName, config] of Object.entries(state.pluginPermissions)) {
    if (pluginName === 'browser') continue;
    if (!config.reviewedVersion) continue;

    const plugin = state.registry.plugins.get(pluginName);
    if (!plugin) continue;

    if (config.reviewedVersion !== plugin.version) {
      log.info(
        `Plugin "${pluginName}" updated from v${config.reviewedVersion} to v${plugin.version} — resetting permission to 'off'`,
      );
      config.permission = 'off';
      config.reviewedVersion = undefined;
      delete config.tools;
      resetCount++;
    }
  }

  if (resetCount > 0) {
    void savePluginPermissions(state, state.pluginPermissions).catch((err: unknown) => {
      log.error('Failed to persist version-reset permissions:', err);
    });
  }
};

/**
 * Shared reload core: discovery, state swap, pruning, and extension sync.
 * Callers notify MCP clients of tool list changes after this returns.
 * In dev mode, file watchers and config watching are started after discovery.
 * In production mode, no watchers are created — restart to reload.
 */
const reloadCore = async ({ state, sessionServers, transports }: ReloadCoreArgs): Promise<void> => {
  // Always stop existing watchers (cleans up handles from previous hot reload iteration)
  stopFileWatching(state);
  sweepStaleSessions(state, transports, sessionServers);

  // Capture the config.json mtime that was current when the watcher last fired.
  // stopFileWatching() cancels any pending debounce timers, so a config.json write
  // that arrives during the async reload work below (while discoverPlugins runs) will
  // not trigger a follow-up reload via the file watcher. After startConfigWatching()
  // records the current mtime, we compare against this value to detect missed writes.
  const prevConfigMtime = state.fileWatching.configLastSeenMtime;

  let secretChanged = false;
  try {
    const config = await loadConfig();
    const configDir = getConfigDir();

    // Expand localPluginDirs into individual plugin paths
    const expandedDirPaths: string[] = [];
    for (const dirSpec of config.localPluginDirs ?? []) {
      const resolved = resolveLocalPath(dirSpec, configDir);
      const scanned = await scanLocalPluginDir(resolved);
      expandedDirPaths.push(...scanned);
    }

    // Deduplicate: localPlugins entries take precedence (appear first)
    const allLocalPaths = [...config.localPlugins, ...expandedDirPaths];
    const seen = new Set<string>();
    const dedupedPaths: string[] = [];
    for (const p of allLocalPaths) {
      const resolved = await realpath(resolveLocalPath(p, configDir)).catch(() => resolveLocalPath(p, configDir));
      if (!seen.has(resolved)) {
        seen.add(resolved);
        dedupedPaths.push(p);
      }
    }

    state.localPluginDirs = config.localPluginDirs ?? [];

    const { registry, errors } = await discoverPlugins(
      dedupedPaths,
      configDir,
      config.settings,
      config.additionalAllowedDirectories ?? [],
    );

    // Compute all new state values locally before touching state.
    // This ensures an atomic swap: if any step throws, state retains its previous values.
    const newRegistry = registry;
    const newPluginPermissions = { ...config.permissions };
    // Preserve the in-memory browser permission when the disk config has no
    // browser entry. The browser permission may have been set at runtime via
    // the extension or MCP and not yet flushed to disk.
    if (!newPluginPermissions.browser && state.pluginPermissions.browser) {
      newPluginPermissions.browser = state.pluginPermissions.browser;
    }
    const newPluginSettings = { ...config.settings };
    const newPluginPaths = [...config.localPlugins];
    const newDiscoveryErrors = errors;
    // Preserve the runtime skipPermissions value — it may have been toggled
    // via "Restore approvals" in the side panel. Only read the env var on
    // initial startup (when state.skipPermissions is still the default).
    const newSkipPermissions = state.skipPermissions;

    // Build the new cached browser tools on a staging object so a throw here
    // does not partially update state. rebuildCachedBrowserTools only reads
    // .browserTools and writes .cachedBrowserTools.
    const stagingForCache = { browserTools: state.browserTools, cachedBrowserTools: [] as CachedBrowserTool[] };
    rebuildCachedBrowserTools(stagingForCache as unknown as ServerState);
    const newCachedBrowserTools = stagingForCache.cachedBrowserTools;

    if (errors.length > 0) {
      log.warn(`${errors.length} plugin(s) failed to load:`);
      for (const e of errors) {
        log.warn(`  "${e.specifier}": ${e.error}`);
      }
    }

    log.info(
      `Config loaded: ${config.localPlugins.length} local plugin path(s), ${Object.keys(config.permissions).length} plugin permission(s)`,
    );

    // All preparation succeeded — swap all state fields atomically.
    state.registry = newRegistry;
    state.pluginPermissions = newPluginPermissions;
    state.pluginSettings = newPluginSettings;
    state.pluginPaths = newPluginPaths;
    state.discoveryErrors = newDiscoveryErrors;
    state.skipPermissions = newSkipPermissions;
    state.cachedBrowserTools = newCachedBrowserTools;

    // Prune stale entries against the updated registry.
    pruneStaleState(state);

    // Reset permissions for plugins whose reviewed version no longer matches the installed version.
    // When a plugin is updated, its permission reverts to 'off' until re-reviewed.
    resetStaleReviewedVersions(state);

    // Write adapter files eagerly so they exist on disk before the extension connects.
    try {
      await writeAllAdapterFiles(state);
    } catch (err) {
      log.warn('Failed to write adapter files:', err);
    }
  } catch (err) {
    log.error('Reload failed, keeping previous state:', err);
  }

  // Re-read the auth secret so secret rotation takes effect without a restart.
  // Independent of config/plugin discovery — a secret load failure keeps the
  // previous secret without rolling back the config/registry updates above.
  const previousSecret = state.wsSecret;
  try {
    state.wsSecret = await loadSecret();
    secretChanged = previousSecret !== null && state.wsSecret !== previousSecret;
  } catch (err) {
    log.error('Failed to load auth secret, keeping previous secret:', err);
  }

  // File watchers, config watching, and mtime polling are dev-only features.
  // Production mode discovers plugins once at startup; restart to reload.
  if (isDev()) {
    const callbacks = createFileWatcherCallbacks(state, sessionServers, transports);
    const failedPaths = state.registry.failures.map(f => f.path);
    startFileWatching(state, callbacks, failedPaths);
    startConfigWatching(state, callbacks);

    // Detect config.json writes that occurred during the async reload above.
    // stopFileWatching() cancelled any pending debounce timers, so those writes
    // never triggered a follow-up reload. startConfigWatching() records the current
    // file mtime, so the mtime poll also cannot detect them (it only sees future changes).
    // Compare the mtime startConfigWatching() just recorded with the pre-reload mtime:
    // if it advanced, config.json was written during the reload and state.pluginPermissions
    // reflects stale data — trigger a follow-up reload to apply the latest config.
    if (
      prevConfigMtime !== null &&
      state.fileWatching.configLastSeenMtime !== null &&
      state.fileWatching.configLastSeenMtime > prevConfigMtime
    ) {
      log.info('Config changed during reload — triggering follow-up reload to apply latest changes');
      callbacks.onConfigChanged();
    }
  }

  if (isExtensionConnected(state)) {
    await sendSyncFull(state);

    // If the auth secret changed (e.g., via `opentabs config rotate-secret`),
    // trigger an extension reload so it reconnects with the new credentials.
    // The 500ms delay lets sync.full flush before the extension restarts.
    if (secretChanged) {
      log.info('Auth secret changed — sending reload signal to extension');
      setTimeout(() => {
        try {
          sendExtensionReload(state);
        } catch (err) {
          log.warn('Failed to send extension reload signal:', err);
        }
      }, 500);
    }
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
 * On first load: discovers plugins, kicks off version check. In dev mode,
 * also starts file watchers for local plugins and config.json.
 * On hot reload: additionally re-registers MCP handlers on existing sessions,
 * refreshes browser tools, installs/updates the managed extension, and notifies
 * all MCP clients.
 *
 * If discovery fails, the server continues with whatever plugins were in state
 * before the reload attempt.
 *
 * A globalThis-based serialization chain prevents concurrent reloads: each
 * call appends to the chain synchronously, then awaits its predecessor.
 */
const performReload = async (
  state: ServerState,
  sessionServers: McpServerInstance[],
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
  isHotReload: boolean,
): Promise<ReloadResult> => {
  // Serialize reloads: capture the current chain and replace it with a new
  // link before any await. Because getReloadChain() and setReloadChain() run
  // synchronously, concurrent callers each see the previous link and chain
  // after it — no two reloads can run in parallel.
  let resolveGuard!: () => void;
  const guard = new Promise<void>(resolve => {
    resolveGuard = resolve;
  });
  const previousLink = getReloadChain();
  setReloadChain(guard);
  await previousLink;
  const startTs = Date.now();

  try {
    // Clear the previous periodic sweep timer — it closes over stale references
    // from the previous module evaluation. A fresh timer is started below.
    restartSweepTimer(state, transports, sessionServers);

    // Ensure the managed extension in ~/.opentabs/extension/ is up to date.
    // Isolated from the rest of reload so a transient filesystem error
    // (cpSync, mkdirSync, writeFile) does not block plugin discovery.
    try {
      const installResult = await ensureExtensionInstalled();
      if (installResult.versionChanged) {
        if (isExtensionConnected(state)) {
          // Extension is connected — send reload after a short delay to let
          // sync.full flush first (the extension handles extension.reload by
          // calling chrome.runtime.reload() after its own flush delay).
          log.info('Extension version changed — sending reload signal to connected extension');
          setTimeout(() => {
            try {
              sendExtensionReload(state);
            } catch (err) {
              log.warn('Failed to send extension reload signal:', err);
            }
          }, 500);
        } else {
          // Extension not connected — flag for reload on next connect
          log.info('Extension version changed — reload will be sent on next extension connect');
          state.pendingExtensionReload = true;
        }
      }
    } catch (err) {
      log.warn('Extension install failed (continuing with plugin discovery):', err);
    }

    // Remove leftover __exec-*.js files from previous sessions/crashes
    try {
      await cleanupStaleExecFiles();
    } catch (err) {
      log.warn('Exec file cleanup failed:', err);
    }

    // Update browser tools from the fresh module import (hot reload re-evaluates
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
        `Hot reload: re-registered ${reregistered}/${sessionServers.length} session(s), notifying of list changes`,
      );
      for (const srv of sessionServers) {
        notifyToolListChanged(srv);
      }
    }

    const durationMs = Date.now() - startTs;
    return {
      lastReloadTimestamp: Date.now(),
      lastReloadDurationMs: durationMs,
    };
  } finally {
    // Resolve this link so the next chained reload can proceed
    resolveGuard();
  }
};

/**
 * Reload config and rediscover plugins at runtime via the POST /reload endpoint.
 * Performs the same config/plugin rediscovery as performReload but without the
 * hot reload module re-evaluation aspects (browser tools refresh, session
 * handler re-registration).
 *
 * Returns the number of plugins discovered and the duration in milliseconds.
 */
const performConfigReload = async (
  state: ServerState,
  sessionServers: McpServerInstance[],
  transports: Map<string, WebStandardStreamableHTTPServerTransport>,
): Promise<{ plugins: number; durationMs: number }> => {
  // Serialize reloads using the same chain as performReload (see comment there)
  let resolveGuard!: () => void;
  const guard = new Promise<void>(resolve => {
    resolveGuard = resolve;
  });
  const previousLink = getReloadChain();
  setReloadChain(guard);
  await previousLink;
  const startTs = Date.now();

  const previousPluginCount = state.registry.plugins.size;

  try {
    // Clear and restart the sweep timer so it uses fresh references
    restartSweepTimer(state, transports, sessionServers);

    await reloadCore({ state, sessionServers, transports });

    // Notify all MCP clients that tool lists changed after config reload.
    // (performReload handles its own notification after handler re-registration,
    // so reloadCore itself does not notify — each caller is responsible.)
    for (const srv of sessionServers) {
      notifyToolListChanged(srv);
    }

    // If the plugin count changed, MCP clients likely need to refetch tools.
    // Streamable HTTP transports silently drop server-initiated notifications
    // when the client has no standalone SSE stream open (common with Claude Code).
    // Log a hint so the user knows to reconnect.
    if (previousPluginCount !== state.registry.plugins.size && sessionServers.length > 0) {
      log.info('Plugin list changed — MCP clients may need to reconnect (/mcp in Claude Code) to pick up new tools');
    }

    log.info(`Config reload complete: ${state.registry.plugins.size} plugin(s) in ${Date.now() - startTs}ms`);

    return { plugins: state.registry.plugins.size, durationMs: Date.now() - startTs };
  } finally {
    // Resolve this link so the next chained reload can proceed
    resolveGuard();
  }
};

/**
 * Run a version check (via `npm view`) and notify the extension if outdated
 * plugins are found. Called fire-and-forget after initial startup and on a
 * periodic timer — NOT during reload, to keep the reload path fast.
 */
const runVersionCheck = async (state: ServerState): Promise<void> => {
  try {
    await checkForUpdates(state);
  } catch {
    // best-effort
  }
  if (state.outdatedPlugins.length > 0 && isExtensionConnected(state)) {
    sendToExtension(state, {
      jsonrpc: '2.0',
      method: 'plugins.changed',
      params: { ...buildConfigStatePayload(state) },
    });
  }
};

export type { ReloadResult };
export { performConfigReload, performReload, runVersionCheck };
