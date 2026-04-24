import type { ConfigStatePlugin, PluginTabInfo, TabState, ToolPermission } from '@opentabs-dev/shared';
import { clearAllConfirmationBadges, clearConfirmationBadge, getPendingConfirmations } from './confirmation-badge.js';
import { buildWsUrl, SERVER_PORT_KEY, WS_CONNECTED_KEY } from './constants.js';
import type { DisconnectReason, InternalMessage, PluginTabStateInfo } from './extension-messages.js';
import { getLastSeenUrl, setLastSeenUrl } from './last-seen-urls.js';
import { handleServerMessage } from './message-router.js';
import { forwardToSidePanel, sendToServer } from './messaging.js';
import { getAllPluginMeta, getPluginMeta } from './plugin-storage.js';
import { rejectAllPendingServerRequests, sendServerRequest } from './server-request.js';
import {
  addPendingAllBrowserToolsUpdate,
  addPendingBrowserToolUpdate,
  addPendingPluginAllToolsUpdate,
  addPendingPluginPermissionUpdate,
  addPendingPluginToolUpdate,
  clearServerStateCache,
  getCachesInitialized,
  getServerStateCache,
  loadServerStateCacheFromSession,
  removePendingAllBrowserToolsUpdate,
  removePendingBrowserToolUpdate,
  removePendingPluginAllToolsUpdate,
  removePendingPluginPermissionUpdate,
  removePendingPluginToolUpdate,
  updateServerStateCache,
} from './server-state-cache.js';
import { findAllMatchingTabs } from './tab-matching.js';
import {
  clearTabStateCache,
  getLastKnownStates,
  loadLastKnownStateFromSession,
  notifyAffectedPlugins,
  stopReadinessPoll,
} from './tab-state.js';
import { notifyDispatchProgress } from './tool-dispatch.js';

// ---------------------------------------------------------------------------
// WebSocket connection state
// ---------------------------------------------------------------------------

/**
 * In-memory cache of wsConnected. Authoritative state is in chrome.storage.session
 * so it survives MV3 service worker suspension. This cache avoids async reads
 * on every message handler invocation.
 */
let wsConnected = false;
/** Tracks the reason for the last WebSocket disconnection */
let lastDisconnectReason: DisconnectReason | undefined;

/** Promise tracking the in-flight or completed wsConnected restore from session storage */
let wsConnectedRestorePromise: Promise<void> | undefined;

/**
 * Restore wsConnected from chrome.storage.session on service worker wake.
 * Idempotent: only reads from storage once per service worker lifecycle.
 */
const restoreWsConnectedState = (): void => {
  if (wsConnectedRestorePromise !== undefined) return;
  wsConnectedRestorePromise = chrome.storage.session
    .get(WS_CONNECTED_KEY)
    .then(data => {
      if (typeof data[WS_CONNECTED_KEY] === 'boolean') {
        wsConnected = data[WS_CONNECTED_KEY];
      }
    })
    .catch(() => {
      // storage.session may not be available in all contexts
    });
};

/**
 * Await the wsConnected restore from session storage.
 * Returns immediately if restoreWsConnectedState has not been called yet.
 */
const waitForWsConnectedRestore = (): Promise<void> => wsConnectedRestorePromise ?? Promise.resolve();

/** Persist wsConnected to chrome.storage.session */
const persistWsConnected = (connected: boolean): void => {
  wsConnected = connected;
  chrome.storage.session.set({ [WS_CONNECTED_KEY]: connected }).catch(() => {
    // Best-effort persistence
  });
};

// ---------------------------------------------------------------------------
// Individual message handlers
// ---------------------------------------------------------------------------

/** Handler signature for background message dispatch */
type MessageHandler = (message: Record<string, unknown>, sendResponse: (response: unknown) => void) => void;

/** Handle offscreen:getUrl — return the WebSocket URL and connectionId for the offscreen document */
const handleOffscreenGetUrl: MessageHandler = (_message, sendResponse) => {
  (async () => {
    const stored: Record<string, unknown> = await chrome.storage.local
      .get([SERVER_PORT_KEY, 'connectionId'])
      .catch(() => ({}) as Record<string, unknown>);
    const port =
      typeof stored[SERVER_PORT_KEY] === 'number' && stored[SERVER_PORT_KEY] > 0 ? stored[SERVER_PORT_KEY] : undefined;
    const url = port ? buildWsUrl(port) : undefined;
    const connectionId = typeof stored.connectionId === 'string' ? stored.connectionId : undefined;
    sendResponse({ url, connectionId });
  })().catch(() => {
    sendResponse({ url: undefined });
  });
};

/** Handle ws:state — WebSocket connection state changed */
const handleWsState: MessageHandler = (message, sendResponse) => {
  const nowConnected = message.connected as boolean;
  persistWsConnected(nowConnected);
  lastDisconnectReason = nowConnected ? undefined : (message.disconnectReason as DisconnectReason | undefined);
  forwardToSidePanel({
    type: 'sp:connectionState',
    data: {
      connected: nowConnected,
      disconnectReason: lastDisconnectReason,
    },
  });
  if (!nowConnected) {
    stopReadinessPoll();
    clearTabStateCache();
    clearServerStateCache();
    rejectAllPendingServerRequests();
    clearAllConfirmationBadges();
  }
  sendResponse({ ok: true });
};

/** Handle ws:message — relay a JSON-RPC message from the MCP server */
const handleWsMessage: MessageHandler = (message, sendResponse) => {
  try {
    handleServerMessage(message.data as Record<string, unknown>);
  } catch (err) {
    console.error('[opentabs:background] handleServerMessage threw:', err);
  }
  sendResponse({ ok: true });
};

/**
 * Handle bg:getFullState — return merged state from all local caches.
 * Combines plugin metadata (chrome.storage.local), server state cache
 * (tool permission states, browserTools, failedPlugins, serverVersion),
 * and tab state cache (per-plugin tab state) into a single response.
 */
const handleBgGetFullState: MessageHandler = (_message, sendResponse) => {
  (async () => {
    // Await wsConnected restoration before reading it. On service worker wake,
    // restoreWsConnectedState() may still be pending when the first bg:getFullState
    // arrives. Without this await, wsConnected would be false even though session
    // storage has true, causing the side panel to show a false disconnected state.
    await waitForWsConnectedRestore();

    // Read caches once for the wake detection check
    let tabStates = getLastKnownStates();
    let serverCache = getServerStateCache();

    // Wake detection: if the service worker was suspended, in-memory caches
    // are empty but wsConnected may still be true (restored from session storage).
    // Restore server state from session first — this also restores cachesInitialized,
    // which distinguishes "woke from suspension after sync.full" (true) from
    // "connected but sync.full has not arrived yet" (false). Tab state is only
    // restored when cachesInitialized is true, preventing stale session data
    // from being used during the connect-to-sync.full gap.
    //
    // The in-memory cachesInitialized flag is the primary guard: if sync.full
    // has already populated the caches in this service worker lifecycle, the
    // in-memory cache is authoritative and must NOT be overwritten from session
    // storage. Without this check, installations with 0 plugins always hit
    // this block (plugins.length === 0) and load stale session data on every
    // getFullState call, reverting in-flight permission changes.
    if (wsConnected && !getCachesInitialized() && tabStates.size === 0 && serverCache.plugins.length === 0) {
      await loadServerStateCacheFromSession();
      if (getCachesInitialized()) {
        await loadLastKnownStateFromSession();
        tabStates = getLastKnownStates();
      }
      serverCache = getServerStateCache();
    }

    const metaIndex = await getAllPluginMeta();

    // Build a lookup from server cache plugins by name for O(1) merge
    const serverPluginMap = new Map<string, ConfigStatePlugin>();
    for (const sp of serverCache.plugins) {
      serverPluginMap.set(sp.name, sp);
    }

    // Pre-compute last-seen URL availability per plugin (in-memory cache, effectively sync after first load)
    const metaEntries = Object.values(metaIndex);
    const lastSeenFlags = await Promise.all(metaEntries.map(async m => (await getLastSeenUrl(m.name)) !== undefined));
    const hasLastSeenUrlMap = new Map<string, boolean>();
    for (let i = 0; i < metaEntries.length; i++) {
      const entry = metaEntries[i];
      if (lastSeenFlags[i] && entry) hasLastSeenUrlMap.set(entry.name, true);
    }

    // Merge each plugin from metaCache with server state and tab state
    const plugins: ConfigStatePlugin[] = metaEntries.map(meta => {
      const serverPlugin = serverPluginMap.get(meta.name);

      // Tab state from lastKnownState cache (serialized JSON)
      let tabState: TabState = 'closed';
      let tabs: PluginTabInfo[] | undefined;
      const serialized = tabStates.get(meta.name);
      if (serialized) {
        try {
          const parsed = JSON.parse(serialized) as PluginTabStateInfo;
          tabState = parsed.state;
          if (parsed.tabs.length > 0) tabs = parsed.tabs;
        } catch {
          // Fall back to 'closed' on parse error
        }
      }

      // Tool permission states: prefer server cache, default to permission='auto'
      const tools = meta.tools.map(metaTool => {
        const serverTool = serverPlugin?.tools.find(st => st.name === metaTool.name);
        return {
          ...metaTool,
          permission: serverTool?.permission ?? metaTool.permission,
        };
      });

      // Spread meta to inherit all display-relevant fields (name, displayName,
      // version, urlPatterns, icon variants, etc.) so new fields added to
      // PluginMeta flow through automatically without manual enumeration.
      // Exclude internal-only fields that are not part of ConfigStatePlugin.
      //
      // Spread order: metaFields (base display data) → serverOnlyDefaults
      // (defaults for when serverPlugin is undefined) → serverPlugin (all
      // server-sourced fields including source, reviewed, npmPackageName,
      // sdkVersion, update — new server-only fields flow through automatically)
      // → explicit overrides for permission (with meta fallback), tools (merged
      // with permission state), tabState (live), tabs (live), hasLastSeenUrl
      // (extension-computed). Later spreads override earlier ones.
      const serverOnlyDefaults: Pick<ConfigStatePlugin, 'source' | 'reviewed' | 'hasPreScript'> = {
        source: 'local',
        reviewed: false,
        hasPreScript: false,
      };
      const { tools: _metaTools, adapterHash: _adapterHash, adapterFile: _adapterFile, ...metaFields } = meta;
      return {
        ...metaFields,
        ...serverOnlyDefaults,
        ...(serverPlugin ?? {}),
        permission: serverPlugin?.permission ?? meta.permission,
        tools,
        tabState,
        tabs,
        ...(hasLastSeenUrlMap.has(meta.name) && { hasLastSeenUrl: true }),
      };
    });

    sendResponse({
      connected: wsConnected,
      disconnectReason: wsConnected ? undefined : lastDisconnectReason,
      plugins,
      failedPlugins: serverCache.failedPlugins,
      browserTools: serverCache.browserTools,
      browserPermission: serverCache.browserPermission,
      serverVersion: serverCache.serverVersion,
      serverSourcePath: serverCache.serverSourcePath,
      skipPermissions: serverCache.skipPermissions,
      extensionHash: serverCache.extensionHash,
      serverUpdate: serverCache.serverUpdate,
      pendingConfirmations: getPendingConfirmations(),
    });
  })().catch(() => {
    sendResponse({
      connected: wsConnected,
      disconnectReason: wsConnected ? undefined : lastDisconnectReason,
      plugins: [],
      failedPlugins: [],
      browserTools: [],
      serverVersion: undefined,
      pendingConfirmations: [],
    });
  });
};

/**
 * Handle plugin:logs — forward batched plugin log entries to the MCP server.
 * Validates the entries array at runtime because this message originates from
 * content scripts which can send arbitrary data.
 */
const handlePluginLogs: MessageHandler = (message, sendResponse) => {
  const entries = message.entries;
  if (wsConnected && Array.isArray(entries)) {
    const plugin = message.plugin;
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      sendToServer({
        jsonrpc: '2.0',
        method: 'plugin.log',
        params: {
          plugin,
          level: e.level,
          message: e.message,
          data: e.data,
          ts: e.ts,
        },
      });
    }
  }
  sendResponse({ ok: true });
};

/**
 * Handle tool:progress — forward tool progress notifications to the MCP server.
 * Validates dispatchId/progress/total at runtime because this message originates
 * from content scripts which can send arbitrary data.
 */
const handleToolProgress: MessageHandler = (message, sendResponse) => {
  const dispatchId = message.dispatchId;
  const progress = message.progress;
  const total = message.total;
  if (wsConnected && typeof dispatchId === 'string' && typeof progress === 'number' && typeof total === 'number') {
    sendToServer({
      jsonrpc: '2.0',
      method: 'tool.progress',
      params: {
        dispatchId,
        progress,
        total,
        message: typeof message.message === 'string' ? message.message : undefined,
      },
    });
  }
  if (typeof dispatchId === 'string') {
    notifyDispatchProgress(dispatchId);
  }
  sendResponse({ ok: true });
};

/**
 * Handle plugin:readinessChanged — adapter signaled readiness may have changed.
 * Re-probes the plugin's readiness across all matching tabs and sends a
 * tab.stateChanged notification if the state actually changed.
 */
const handlePluginReadinessChanged: MessageHandler = (message, _sendResponse) => {
  const plugin = message.plugin;
  if (typeof plugin !== 'string' || plugin === '') return;

  (async () => {
    const meta = await getPluginMeta(plugin);
    if (!meta) return;
    await notifyAffectedPlugins([meta]);
  })().catch((err: unknown) => {
    console.warn('[opentabs] handlePluginReadinessChanged failed:', err);
  });
};

/** Handle sp:confirmationResponse — forward confirmation response to the MCP server */
const handleSpConfirmationResponse: MessageHandler = (message, sendResponse) => {
  if (wsConnected) {
    sendToServer({
      jsonrpc: '2.0',
      method: 'confirmation.response',
      params: message.data,
    });
  }
  const data = message.data as Record<string, unknown> | undefined;
  const id = typeof data?.id === 'string' ? data.id : undefined;
  clearConfirmationBadge(id);
  sendResponse({ ok: true });
};

/** Handle bg:setToolPermission — set a single tool's permission via the MCP server */
const handleBgSetToolPermission: MessageHandler = (message, sendResponse) => {
  const plugin = message.plugin as string;
  const tool = message.tool as string;
  const permission = message.permission as ToolPermission;

  if (plugin === 'browser') {
    const cache = getServerStateCache();
    const originalPermission = cache.browserTools.find(t => t.name === tool)?.permission ?? 'auto';

    const updatedBrowserTools = cache.browserTools.map(t => (t.name === tool ? { ...t, permission } : t));
    addPendingBrowserToolUpdate(tool, permission);
    updateServerStateCache({ browserTools: updatedBrowserTools });

    sendServerRequest('config.setToolPermission', { plugin, tool, permission })
      .then((result: unknown) => {
        removePendingBrowserToolUpdate(tool);
        sendResponse(result);
      })
      .catch((err: unknown) => {
        removePendingBrowserToolUpdate(tool);
        const currentCache = getServerStateCache();
        const revertedBrowserTools = currentCache.browserTools.map(t =>
          t.name === tool ? { ...t, permission: originalPermission } : t,
        );
        updateServerStateCache({ browserTools: revertedBrowserTools });
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      });
    return;
  }

  // Capture the original permission value for surgical rollback
  const cache = getServerStateCache();
  const pluginEntry = cache.plugins.find(p => p.name === plugin);
  const originalPermission = pluginEntry?.tools.find(t => t.name === tool)?.permission ?? 'auto';

  // Optimistically update the local server state cache
  const updatedPlugins = cache.plugins.map(p => {
    if (p.name !== plugin) return p;
    return {
      ...p,
      tools: p.tools.map(t => (t.name === tool ? { ...t, permission } : t)),
    };
  });
  addPendingPluginToolUpdate(plugin, tool, permission);
  updateServerStateCache({ plugins: updatedPlugins });

  sendServerRequest('config.setToolPermission', { plugin, tool, permission })
    .then((result: unknown) => {
      removePendingPluginToolUpdate(plugin, tool);
      sendResponse(result);
    })
    .catch((err: unknown) => {
      removePendingPluginToolUpdate(plugin, tool);
      // Surgically revert only the target tool in the current cache, preserving
      // any concurrent plugins.changed updates that arrived during the request.
      const currentCache = getServerStateCache();
      const revertedPlugins = currentCache.plugins.map(p => {
        if (p.name !== plugin) return p;
        return {
          ...p,
          tools: p.tools.map(t => (t.name === tool ? { ...t, permission: originalPermission } : t)),
        };
      });
      updateServerStateCache({ plugins: revertedPlugins });
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:setAllToolsPermission — set all tools' permission for a plugin via the MCP server */
const handleBgSetAllToolsPermission: MessageHandler = (message, sendResponse) => {
  const plugin = message.plugin as string;
  const permission = message.permission as ToolPermission;

  if (plugin === 'browser') {
    const cache = getServerStateCache();
    const toolNames = cache.browserTools.map(t => t.name);
    const originalToolStates = new Map<string, ToolPermission>();
    for (const t of cache.browserTools) {
      originalToolStates.set(t.name, t.permission);
    }

    const updatedBrowserTools = cache.browserTools.map(t => ({ ...t, permission }));
    addPendingAllBrowserToolsUpdate(toolNames, permission);
    updateServerStateCache({ browserTools: updatedBrowserTools });

    sendServerRequest('config.setAllToolsPermission', { plugin, permission })
      .then((result: unknown) => {
        removePendingAllBrowserToolsUpdate(toolNames);
        sendResponse(result);
      })
      .catch((err: unknown) => {
        removePendingAllBrowserToolsUpdate(toolNames);
        const currentCache = getServerStateCache();
        const revertedBrowserTools = currentCache.browserTools.map(t => ({
          ...t,
          permission: originalToolStates.get(t.name) ?? t.permission,
        }));
        updateServerStateCache({ browserTools: revertedBrowserTools });
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      });
    return;
  }

  // Capture original permission values for surgical rollback
  const cache = getServerStateCache();
  const pluginEntry = cache.plugins.find(p => p.name === plugin);
  const toolNames = pluginEntry ? pluginEntry.tools.map(t => t.name) : [];
  const originalToolStates = new Map<string, ToolPermission>();
  if (pluginEntry) {
    for (const t of pluginEntry.tools) {
      originalToolStates.set(t.name, t.permission);
    }
  }

  // Optimistically update the local server state cache
  const updatedPlugins = cache.plugins.map(p => {
    if (p.name !== plugin) return p;
    return {
      ...p,
      tools: p.tools.map(t => ({ ...t, permission })),
    };
  });
  addPendingPluginAllToolsUpdate(plugin, toolNames, permission);
  updateServerStateCache({ plugins: updatedPlugins });

  sendServerRequest('config.setAllToolsPermission', { plugin, permission })
    .then((result: unknown) => {
      removePendingPluginAllToolsUpdate(plugin, toolNames);
      sendResponse(result);
    })
    .catch((err: unknown) => {
      removePendingPluginAllToolsUpdate(plugin, toolNames);
      // Surgically revert only the target plugin's tools in the current cache,
      // preserving any concurrent plugins.changed updates that arrived during the request.
      const currentCache = getServerStateCache();
      const revertedPlugins = currentCache.plugins.map(p => {
        if (p.name !== plugin) return p;
        return {
          ...p,
          tools: p.tools.map(t => ({
            ...t,
            permission: originalToolStates.get(t.name) ?? t.permission,
          })),
        };
      });
      updateServerStateCache({ plugins: revertedPlugins });
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:setPluginPermission — set a plugin's default permission via the MCP server */
const handleBgSetPluginPermission: MessageHandler = (message, sendResponse) => {
  const plugin = message.plugin as string;
  const permission = message.permission as ToolPermission;
  const reviewedVersion = typeof message.reviewedVersion === 'string' ? message.reviewedVersion : undefined;

  // Capture the original plugin-level permission for surgical rollback
  const cache = getServerStateCache();
  const pluginEntry = cache.plugins.find(p => p.name === plugin);
  const originalPermission = pluginEntry?.permission ?? 'off';

  // Optimistically update the local server state cache
  const updatedPlugins = cache.plugins.map(p =>
    p.name === plugin ? { ...p, permission, ...(reviewedVersion ? { reviewed: true } : {}) } : p,
  );
  addPendingPluginPermissionUpdate(plugin, permission);
  updateServerStateCache({ plugins: updatedPlugins });

  sendServerRequest('config.setPluginPermission', {
    plugin,
    permission,
    ...(reviewedVersion ? { reviewedVersion } : {}),
  })
    .then((result: unknown) => {
      removePendingPluginPermissionUpdate(plugin);
      sendResponse(result);
    })
    .catch((err: unknown) => {
      removePendingPluginPermissionUpdate(plugin);
      // Surgically revert only the target plugin's permission in the current cache,
      // preserving any concurrent plugins.changed updates that arrived during the request.
      const currentCache = getServerStateCache();
      const revertedPlugins = currentCache.plugins.map(p =>
        p.name === plugin ? { ...p, permission: originalPermission } : p,
      );
      updateServerStateCache({ plugins: revertedPlugins });
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:setSkipPermissions — set skipPermissions runtime toggle via the MCP server */
const handleBgSetSkipPermissions: MessageHandler = (message, sendResponse) => {
  const skipPermissions = message.skipPermissions as boolean;

  // Capture original for rollback
  const cache = getServerStateCache();
  const originalSkipPermissions = cache.skipPermissions ?? false;

  // Optimistically update local cache
  updateServerStateCache({ skipPermissions });

  sendServerRequest('config.setSkipPermissions', { skipPermissions })
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      // Rollback
      updateServerStateCache({ skipPermissions: originalSkipPermissions });
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:searchPlugins — search npm registry for plugins */
const handleBgSearchPlugins: MessageHandler = (message, sendResponse) => {
  const query = message.query as string;
  sendServerRequest('plugin.search', { query })
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:installPlugin — install a plugin by package name */
const handleBgInstallPlugin: MessageHandler = (message, sendResponse) => {
  const name = message.name as string;
  sendServerRequest('plugin.install', { name })
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:removePlugin — remove an installed plugin */
const handleBgRemovePlugin: MessageHandler = (message, sendResponse) => {
  const name = message.name as string;
  sendServerRequest('plugin.remove', { name })
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:removeFailedPlugin — remove a failed plugin by its config specifier */
const handleBgRemoveFailedPlugin: MessageHandler = (message, sendResponse) => {
  const specifier = message.specifier as string;
  sendServerRequest('plugin.removeBySpecifier', { specifier })
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:updatePlugin — update a plugin to the latest registry version */
const handleBgUpdatePlugin: MessageHandler = (message, sendResponse) => {
  const name = message.name as string;
  sendServerRequest('plugin.updateFromRegistry', { name })
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:selfUpdateServer — trigger server self-update (phoenix restart) via the MCP server */
const handleBgSelfUpdateServer: MessageHandler = (_message, sendResponse) => {
  sendServerRequest('server.selfUpdate', {})
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:setPluginSettings — save plugin settings via the MCP server */
const handleBgSetPluginSettings: MessageHandler = (message, sendResponse) => {
  const plugin = message.plugin as string;
  const settings = message.settings as Record<string, unknown>;
  sendServerRequest('config.setPluginSettings', { plugin, settings })
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:openFolder — relay folder open request to MCP server */
const handleBgOpenFolder: MessageHandler = (message, sendResponse) => {
  const path = message.path as string;
  sendServerRequest('folder.open', { path })
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle port-changed — relay port change to offscreen document for reconnect */
const handlePortChanged: MessageHandler = (message, sendResponse) => {
  chrome.runtime.sendMessage(message as unknown as InternalMessage).catch(() => {
    // Offscreen may not be ready yet
  });
  sendResponse({ ok: true });
};

/** Last-focused tab ID per plugin for round-robin cycling */
const lastFocusedTabId = new Map<string, number>();

type TabEntry = { tab: chrome.tabs.Tab; id: number };

/** Pick the next tab to focus in a stable round-robin. */
const pickNextTab = (sorted: TabEntry[], pluginName: string): TabEntry | undefined => {
  if (sorted.length === 0) return undefined;
  const lastId = lastFocusedTabId.get(pluginName);
  if (lastId === undefined) {
    // First click: pick the first non-active tab so the user sees immediate action
    return sorted.find(t => !t.tab.active) ?? sorted[0];
  }
  const lastIdx = sorted.findIndex(t => t.id === lastId);
  const nextIdx = (lastIdx + 1) % sorted.length;
  return sorted[nextIdx];
};

/** Handle bg:openPluginTab — focus an existing matching tab or open the plugin's homepage */
const handleBgOpenPluginTab: MessageHandler = (message, sendResponse) => {
  const pluginName = message.pluginName as string | undefined;
  if (!pluginName) {
    sendResponse({ opened: false });
    return;
  }

  (async () => {
    const meta = await getPluginMeta(pluginName);
    if (!meta) return { opened: false };

    const tabs = await findAllMatchingTabs(meta);

    if (tabs.length > 0) {
      // Build a stable-order list with guaranteed IDs (filter narrows the type)
      const withIds: Array<{ tab: chrome.tabs.Tab; id: number }> = [];
      for (const tab of tabs) {
        if (tab.id !== undefined) withIds.push({ tab, id: tab.id });
      }
      withIds.sort((a, b) => a.id - b.id);

      const pick = pickNextTab(withIds, pluginName);
      if (pick) {
        lastFocusedTabId.set(pluginName, pick.id);
        await chrome.tabs.update(pick.id, { active: true });
        if (pick.tab.windowId !== undefined) {
          await chrome.windows.update(pick.tab.windowId, { focused: true });
        }
        if (pick.tab.url) void setLastSeenUrl(pluginName, pick.tab.url);
        return { opened: true, tabId: pick.id };
      }
    }

    if (meta.homepage) {
      const newTab = await chrome.tabs.create({ url: meta.homepage });
      return { opened: true, tabId: newTab.id };
    }

    const lastUrl = await getLastSeenUrl(pluginName);
    if (lastUrl) {
      const newTab = await chrome.tabs.create({ url: lastUrl });
      return { opened: true, tabId: newTab.id };
    }

    return { opened: false };
  })()
    .then(result => sendResponse(result))
    .catch(() => sendResponse({ opened: false }));
};

// ---------------------------------------------------------------------------
// Dispatch map and listener registration
// ---------------------------------------------------------------------------

const backgroundHandlers = new Map<InternalMessage['type'], MessageHandler>([
  ['offscreen:getUrl', handleOffscreenGetUrl],
  ['ws:state', handleWsState],
  ['ws:message', handleWsMessage],
  ['bg:getFullState', handleBgGetFullState],
  ['bg:setToolPermission', handleBgSetToolPermission],
  ['bg:setAllToolsPermission', handleBgSetAllToolsPermission],
  ['bg:setPluginPermission', handleBgSetPluginPermission],
  ['bg:setSkipPermissions', handleBgSetSkipPermissions],
  ['bg:searchPlugins', handleBgSearchPlugins],
  ['bg:installPlugin', handleBgInstallPlugin],
  ['bg:removePlugin', handleBgRemovePlugin],
  ['bg:removeFailedPlugin', handleBgRemoveFailedPlugin],
  ['bg:updatePlugin', handleBgUpdatePlugin],
  ['bg:selfUpdateServer', handleBgSelfUpdateServer],
  ['bg:openPluginTab', handleBgOpenPluginTab],
  ['bg:setPluginSettings', handleBgSetPluginSettings],
  ['bg:openFolder', handleBgOpenFolder],
  ['plugin:logs', handlePluginLogs],
  ['plugin:readinessChanged', handlePluginReadinessChanged],
  ['tool:progress', handleToolProgress],
  ['sp:confirmationResponse', handleSpConfirmationResponse],
  ['port-changed', handlePortChanged],
]);

// Message types that must originate from extension contexts (offscreen document,
// side panel, popup) — never from ISOLATED-world content scripts on web pages.
const EXTENSION_ONLY_TYPES: ReadonlySet<InternalMessage['type']> = new Set([
  'offscreen:getUrl',
  'ws:state',
  'ws:message',
  'bg:getFullState',
  'bg:setToolPermission',
  'bg:setAllToolsPermission',
  'bg:setPluginPermission',
  'bg:setSkipPermissions',
  'bg:searchPlugins',
  'bg:installPlugin',
  'bg:removePlugin',
  'bg:removeFailedPlugin',
  'bg:updatePlugin',
  'bg:selfUpdateServer',
  'bg:openPluginTab',
  'bg:setPluginSettings',
  'bg:openFolder',
  'offscreen:getLogs',
  'sp:confirmationResponse',
  'port-changed',
]);

/**
 * Register the chrome.runtime.onMessage listener that dispatches internal
 * messages to the appropriate handler via the background dispatch map.
 */
const initBackgroundMessageHandlers = (): void => {
  chrome.runtime.onMessage.addListener(
    (message: InternalMessage, sender, sendResponse: (response: unknown) => void) => {
      // Guard: reject extension-only messages from non-extension senders.
      if (EXTENSION_ONLY_TYPES.has(message.type) && sender.id !== chrome.runtime.id) {
        console.warn(`[opentabs] Rejected ${message.type} from unauthorized sender:`, sender.id ?? sender.url);
        return false;
      }

      const handler = backgroundHandlers.get(message.type);
      if (handler) {
        handler(message as unknown as Record<string, unknown>, sendResponse);
        return true;
      }

      // Messages handled by other listeners (offscreen, side panel) — return false
      // so Chrome doesn't keep the message channel open.
      return false;
    },
  );
};

/** Exported handler names for testing (mirrors methodHandlerNames in message-router.ts) */
const backgroundHandlerNames: readonly string[] = [...backgroundHandlers.keys()];

export {
  backgroundHandlerNames,
  handleBgGetFullState,
  handleBgInstallPlugin,
  handleBgOpenFolder,
  handleBgOpenPluginTab,
  handleBgRemoveFailedPlugin,
  handleBgRemovePlugin,
  handleBgSearchPlugins,
  handleBgSelfUpdateServer,
  handleBgSetAllToolsPermission,
  handleBgSetPluginPermission,
  handleBgSetPluginSettings,
  handleBgSetSkipPermissions,
  handleBgSetToolPermission,
  handleBgUpdatePlugin,
  handleOffscreenGetUrl,
  handlePluginLogs,
  handlePluginReadinessChanged,
  handlePortChanged,
  handleSpConfirmationResponse,
  handleToolProgress,
  handleWsMessage,
  handleWsState,
  initBackgroundMessageHandlers,
  restoreWsConnectedState,
  waitForWsConnectedRestore,
};
