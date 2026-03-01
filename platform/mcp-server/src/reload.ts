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

import { browserTools } from './browser-tools/index.js';
import { loadConfig, loadSecret, getConfigDir } from './config.js';
import { isDev } from './dev-mode.js';
import { discoverPlugins } from './discovery.js';
import { ensureExtensionInstalled } from './extension-install.js';
import { sendSyncFull, sendPluginUpdate, sendExtensionReload, cleanupStaleExecFiles } from './extension-protocol.js';
import { startConfigWatching, startFileWatching, stopFileWatching } from './file-watcher.js';
import { sweepStaleSessions } from './http-routes.js';
import { pruneStaleBuffers } from './log-buffer.js';
import { log } from './logger.js';
import {
  registerMcpHandlers,
  rebuildCachedBrowserTools,
  notifyToolListChanged,
  notifyResourceListChanged,
  notifyPromptListChanged,
} from './mcp-setup.js';
import { buildRegistry } from './registry.js';
import { isCliSkipConfirmation } from './skip-confirmation.js';
import { prefixedToolName } from './state.js';
import { checkForUpdates } from './version-check.js';
import type { McpServerInstance } from './mcp-setup.js';
import type { CachedBrowserTool, ServerState } from './state.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

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
 * Prunes tabMapping, activeDispatches, toolConfig, and outdatedPlugins
 * for plugins/tools that no longer exist in the current registry.
 */
const pruneStaleState = (state: ServerState): void => {
  for (const pluginName of state.tabMapping.keys()) {
    if (!state.registry.plugins.has(pluginName)) {
      state.tabMapping.delete(pluginName);
    }
  }

  for (const pluginName of state.activeDispatches.keys()) {
    if (!state.registry.plugins.has(pluginName)) {
      state.activeDispatches.delete(pluginName);
    }
  }

  // Prune stale toolConfig entries for removed plugins/tools
  const validToolNames = new Set<string>();
  for (const plugin of state.registry.plugins.values()) {
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

  // Prune stale log buffers for removed plugins
  pruneStaleBuffers(new Set(state.registry.plugins.keys()));

  // Keep only outdatedPlugins entries for still-present plugins
  const npmPkgNames = new Set(
    Array.from(state.registry.plugins.values())
      .map(p => p.npmPackageName)
      .filter((n): n is string => n !== undefined),
  );
  state.outdatedPlugins = state.outdatedPlugins.filter(o => npmPkgNames.has(o.name));

  // Prune activeNetworkCaptures for tab IDs no longer present in tabMapping
  const allTabIds = new Set<number>();
  for (const mapping of state.tabMapping.values()) {
    for (const tab of mapping.tabs) {
      allTabIds.add(tab.tabId);
    }
  }
  for (const tabId of state.activeNetworkCaptures) {
    if (!allTabIds.has(tabId)) {
      state.activeNetworkCaptures.delete(tabId);
    }
  }

  // Prune session permission rules for tools that no longer exist in the registry.
  // Rules with tool=null (domain_all scope) are kept — they reference a domain, not a specific tool.
  // Browser tool names (e.g., browser_execute_script) are never in registry.toolLookup (which only
  // contains plugin tools), so they are checked separately against cachedBrowserTools.
  const validBrowserToolNames = new Set(state.cachedBrowserTools.map(c => c.name));
  const prevSessionPermissionsLength = state.sessionPermissions.length;
  state.sessionPermissions = state.sessionPermissions.filter(
    rule => rule.tool === null || state.registry.toolLookup.has(rule.tool) || validBrowserToolNames.has(rule.tool),
  );
  const prunedSessionPermissions = prevSessionPermissionsLength - state.sessionPermissions.length;
  if (prunedSessionPermissions > 0) {
    log.info(`Pruned ${prunedSessionPermissions} stale session permission rule(s)`);
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
      notifyResourceListChanged(srv);
      notifyPromptListChanged(srv);
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
      if (state.extensionWs) {
        void sendSyncFull(state).catch((err: unknown) => {
          log.error('Failed to sync extension after plugin discovery:', err);
        });
      }
    },
  };
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
    const { registry, errors } = await discoverPlugins(config.localPlugins, configDir);

    // Compute all new state values locally before touching state.
    // This ensures an atomic swap: if any step throws, state retains its previous values.
    const newRegistry = registry;
    const newToolConfig = { ...config.tools };
    const newBrowserToolPolicy = { ...config.browserToolPolicy };
    const newPluginPaths = [...config.localPlugins];
    const newDiscoveryErrors = errors;
    const newPermissions = config.permissions;
    const newSkipConfirmation = isCliSkipConfirmation() || config.skipConfirmation === true;

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
      `Config loaded: ${config.localPlugins.length} local plugin path(s), ${Object.keys(config.tools).length} tool setting(s)`,
    );

    // All preparation succeeded — swap all state fields atomically.
    state.registry = newRegistry;
    state.toolConfig = newToolConfig;
    state.browserToolPolicy = newBrowserToolPolicy;
    state.pluginPaths = newPluginPaths;
    state.discoveryErrors = newDiscoveryErrors;
    state.permissions = newPermissions;
    state.skipConfirmation = newSkipConfirmation;
    state.cachedBrowserTools = newCachedBrowserTools;

    // Prune stale entries against the updated registry.
    pruneStaleState(state);
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
    // if it advanced, config.json was written during the reload and state.toolConfig
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

  if (state.extensionWs) {
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
        if (state.extensionWs) {
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
        notifyResourceListChanged(srv);
        notifyPromptListChanged(srv);
      }
    }

    // Version check: async via `npm view`, best-effort on every reload
    try {
      await checkForUpdates(state);
    } catch {
      // Update check is best-effort — failures are not actionable
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

  try {
    // Clear and restart the sweep timer so it uses fresh references
    restartSweepTimer(state, transports, sessionServers);

    await reloadCore({ state, sessionServers, transports });

    // Notify all MCP clients that tool/resource/prompt lists changed after config reload.
    // (performReload handles its own notification after handler re-registration,
    // so reloadCore itself does not notify — each caller is responsible.)
    for (const srv of sessionServers) {
      notifyToolListChanged(srv);
      notifyResourceListChanged(srv);
      notifyPromptListChanged(srv);
    }

    log.info(`Config reload complete: ${state.registry.plugins.size} plugin(s) in ${Date.now() - startTs}ms`);

    return { plugins: state.registry.plugins.size, durationMs: Date.now() - startTs };
  } finally {
    // Resolve this link so the next chained reload can proceed
    resolveGuard();
  }
};

export type { ReloadResult };
export { performReload, performConfigReload };
