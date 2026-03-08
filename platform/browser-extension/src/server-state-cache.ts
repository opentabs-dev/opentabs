import type {
  ConfigStateBrowserTool,
  ConfigStateFailedPlugin,
  ConfigStatePlugin,
  ToolPermission,
} from '@opentabs-dev/shared';

/**
 * In-memory cache of server-owned state. This mirrors the shape of
 * ConfigStateResult from @opentabs-dev/shared so there is no translation
 * layer when serving data to the side panel.
 *
 * The cache is populated from sync.full and plugins.changed push notifications.
 * It is cleared on WebSocket disconnect and rebuilt from scratch on the next
 * sync.full. The in-memory cache is the primary read path (instant). Every
 * mutation writes through to chrome.storage.session (debounced 500ms) so
 * the cache survives MV3 service worker suspension.
 */
interface ServerStateCache {
  plugins: ConfigStatePlugin[];
  failedPlugins: ConfigStateFailedPlugin[];
  browserTools: ConfigStateBrowserTool[];
  browserPermission?: ToolPermission;
  serverVersion?: string;
  serverSourcePath?: string;
  skipPermissions?: boolean;
}

const SESSION_KEY = 'serverStateCache';
const CACHES_INITIALIZED_KEY = 'cachesInitialized';

const EMPTY_CACHE: ServerStateCache = {
  plugins: [],
  failedPlugins: [],
  browserTools: [],
  browserPermission: undefined,
  serverVersion: undefined,
  serverSourcePath: undefined,
  skipPermissions: undefined,
};

let cache: ServerStateCache = { ...EMPTY_CACHE };

// ---------------------------------------------------------------------------
// Pending optimistic updates — protect in-flight permission changes from being
// overwritten by incoming plugins.changed notifications. Outer map key is
// plugin name, inner map key is tool name, value is the optimistic permission
// state. Browser tools use a flat map keyed by tool name.
// ---------------------------------------------------------------------------

const pendingPluginToolUpdates = new Map<string, Map<string, ToolPermission>>();
const pendingPluginPermissionUpdates = new Map<string, ToolPermission>();
const pendingBrowserToolUpdates = new Map<string, ToolPermission>();

/** Re-apply pending optimistic updates on top of the current cache. */
const reapplyPendingOptimisticUpdates = (): void => {
  if (pendingPluginToolUpdates.size > 0 || pendingPluginPermissionUpdates.size > 0) {
    cache = {
      ...cache,
      plugins: cache.plugins.map(plugin => {
        const permOverride = pendingPluginPermissionUpdates.get(plugin.name);
        const toolOverrides = pendingPluginToolUpdates.get(plugin.name);
        if (permOverride === undefined && !toolOverrides) return plugin;
        let updated = plugin;
        if (permOverride !== undefined) {
          updated = { ...updated, permission: permOverride };
        }
        if (toolOverrides) {
          updated = {
            ...updated,
            tools: updated.tools.map(tool => {
              const override = toolOverrides.get(tool.name);
              return override !== undefined ? { ...tool, permission: override } : tool;
            }),
          };
        }
        return updated;
      }),
    };
  }
  const browserPermOverride = pendingPluginPermissionUpdates.get('browser');
  if (browserPermOverride !== undefined) {
    cache = { ...cache, browserPermission: browserPermOverride };
  }
  if (pendingBrowserToolUpdates.size > 0) {
    cache = {
      ...cache,
      browserTools: cache.browserTools.map(bt => {
        const override = pendingBrowserToolUpdates.get(bt.name);
        return override !== undefined ? { ...bt, permission: override } : bt;
      }),
    };
  }
};

/** Register a pending optimistic update for a plugin-level permission. */
const addPendingPluginPermissionUpdate = (plugin: string, permission: ToolPermission): void => {
  pendingPluginPermissionUpdates.set(plugin, permission);
};

/** Clear the pending optimistic update for a plugin-level permission. */
const removePendingPluginPermissionUpdate = (plugin: string): void => {
  pendingPluginPermissionUpdates.delete(plugin);
};

/** Register a pending optimistic update for a single plugin tool. */
const addPendingPluginToolUpdate = (plugin: string, tool: string, permission: ToolPermission): void => {
  let toolMap = pendingPluginToolUpdates.get(plugin);
  if (!toolMap) {
    toolMap = new Map();
    pendingPluginToolUpdates.set(plugin, toolMap);
  }
  toolMap.set(tool, permission);
};

/** Clear the pending optimistic update for a single plugin tool. */
const removePendingPluginToolUpdate = (plugin: string, tool: string): void => {
  const toolMap = pendingPluginToolUpdates.get(plugin);
  if (!toolMap) return;
  toolMap.delete(tool);
  if (toolMap.size === 0) pendingPluginToolUpdates.delete(plugin);
};

/** Register pending optimistic updates for all tools of a plugin. */
const addPendingPluginAllToolsUpdate = (plugin: string, toolNames: string[], permission: ToolPermission): void => {
  let toolMap = pendingPluginToolUpdates.get(plugin);
  if (!toolMap) {
    toolMap = new Map();
    pendingPluginToolUpdates.set(plugin, toolMap);
  }
  for (const name of toolNames) {
    toolMap.set(name, permission);
  }
};

/** Clear pending optimistic updates for all tools of a plugin. */
const removePendingPluginAllToolsUpdate = (plugin: string, toolNames: string[]): void => {
  const toolMap = pendingPluginToolUpdates.get(plugin);
  if (!toolMap) return;
  for (const name of toolNames) {
    toolMap.delete(name);
  }
  if (toolMap.size === 0) pendingPluginToolUpdates.delete(plugin);
};

/** Register a pending optimistic update for a single browser tool. */
const addPendingBrowserToolUpdate = (tool: string, permission: ToolPermission): void => {
  pendingBrowserToolUpdates.set(tool, permission);
};

/** Clear the pending optimistic update for a single browser tool. */
const removePendingBrowserToolUpdate = (tool: string): void => {
  pendingBrowserToolUpdates.delete(tool);
};

/** Register pending optimistic updates for all browser tools. */
const addPendingAllBrowserToolsUpdate = (toolNames: string[], permission: ToolPermission): void => {
  for (const name of toolNames) {
    pendingBrowserToolUpdates.set(name, permission);
  }
};

/** Clear pending optimistic updates for all browser tools. */
const removePendingAllBrowserToolsUpdate = (toolNames: string[]): void => {
  for (const name of toolNames) {
    pendingBrowserToolUpdates.delete(name);
  }
};

/**
 * Tracks whether sync.full has populated the caches at least once in the
 * current WebSocket session. Distinguishes "service worker woke from
 * suspension" (cachesInitialized=true, caches empty) from "WebSocket just
 * connected but sync.full has not arrived yet" (cachesInitialized=false,
 * caches empty). Persisted to chrome.storage.session so it survives
 * MV3 service worker suspension.
 */
let cachesInitialized = false;

/** Debounce timer for session storage writes. */
let persistTimer: ReturnType<typeof setTimeout> | undefined;

/** Write the current in-memory cache to chrome.storage.session. */
const persistToSession = (): void => {
  chrome.storage.session.set({ [SESSION_KEY]: cache, [CACHES_INITIALIZED_KEY]: cachesInitialized }).catch(() => {
    // Best-effort persistence — session storage may not be available
  });
};

/** Schedule a debounced write to session storage (500ms). */
const schedulePersist = (): void => {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    persistToSession();
  }, 500);
};

/** Return a deep copy of the current server state cache. */
const getServerStateCache = (): ServerStateCache => structuredClone(cache);

/**
 * Merge a partial update into the server state cache. Only the provided
 * fields are overwritten — omitted fields retain their previous values.
 * The in-memory cache updates immediately; session storage write is debounced.
 */
const updateServerStateCache = (partial: Partial<ServerStateCache>): void => {
  cache = { ...cache, ...partial };
  reapplyPendingOptimisticUpdates();
  schedulePersist();
};

/**
 * Write the current in-memory cache to chrome.storage.session immediately,
 * cancelling any pending debounced write. Called after sync.full populates
 * the cache to ensure critical state survives MV3 service worker suspension
 * without waiting for the 500ms debounce window.
 */
const flushServerStateCacheToSession = (): void => {
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  persistToSession();
};

/**
 * Clear the server state cache. Called on WebSocket disconnect so the
 * next connection rebuilds state from sync.full without stale data.
 * Clears both in-memory cache and chrome.storage.session.
 */
const clearServerStateCache = (): void => {
  cache = { ...EMPTY_CACHE };
  cachesInitialized = false;
  pendingPluginToolUpdates.clear();
  pendingPluginPermissionUpdates.clear();
  pendingBrowserToolUpdates.clear();
  if (persistTimer !== undefined) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  chrome.storage.session.remove([SESSION_KEY, CACHES_INITIALIZED_KEY]).catch(() => {
    // Best-effort removal
  });
};

/**
 * Load the server state cache from chrome.storage.session and populate the
 * in-memory cache. Called on service worker wake to restore state that was
 * persisted before suspension.
 */
const loadServerStateCacheFromSession = async (): Promise<void> => {
  try {
    const data = await chrome.storage.session.get([SESSION_KEY, CACHES_INITIALIZED_KEY]);
    const stored = data[SESSION_KEY] as ServerStateCache | undefined;
    if (stored && typeof stored === 'object') {
      cache = {
        plugins: Array.isArray(stored.plugins) ? stored.plugins : [],
        failedPlugins: Array.isArray(stored.failedPlugins) ? stored.failedPlugins : [],
        browserTools: Array.isArray(stored.browserTools) ? stored.browserTools : [],
        browserPermission:
          stored.browserPermission === 'off' ||
          stored.browserPermission === 'ask' ||
          stored.browserPermission === 'auto'
            ? stored.browserPermission
            : undefined,
        serverVersion: typeof stored.serverVersion === 'string' ? stored.serverVersion : undefined,
        serverSourcePath: typeof stored.serverSourcePath === 'string' ? stored.serverSourcePath : undefined,
        skipPermissions: typeof stored.skipPermissions === 'boolean' ? stored.skipPermissions : undefined,
      };
    }
    if (typeof data[CACHES_INITIALIZED_KEY] === 'boolean') {
      cachesInitialized = data[CACHES_INITIALIZED_KEY];
    }
  } catch {
    // Session storage may not be available — keep empty cache
  }
};

/** Returns whether sync.full has populated the caches in the current session. */
const getCachesInitialized = (): boolean => cachesInitialized;

/** Mark caches as initialized after sync.full populates them. */
const setCachesInitialized = (value: boolean): void => {
  cachesInitialized = value;
};

export {
  addPendingAllBrowserToolsUpdate,
  addPendingBrowserToolUpdate,
  addPendingPluginAllToolsUpdate,
  addPendingPluginPermissionUpdate,
  addPendingPluginToolUpdate,
  clearServerStateCache,
  flushServerStateCacheToSession,
  getCachesInitialized,
  getServerStateCache,
  loadServerStateCacheFromSession,
  removePendingAllBrowserToolsUpdate,
  removePendingBrowserToolUpdate,
  removePendingPluginAllToolsUpdate,
  removePendingPluginPermissionUpdate,
  removePendingPluginToolUpdate,
  setCachesInitialized,
  updateServerStateCache,
};
export type { ServerStateCache };
