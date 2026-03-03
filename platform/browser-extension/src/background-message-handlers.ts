import type { ConfigStatePlugin, TabState } from '@opentabs-dev/shared';
import {
  clearAllConfirmationBadges,
  clearConfirmationBackgroundTimeout,
  clearConfirmationBadge,
  getPendingConfirmations,
} from './confirmation-badge.js';
import { buildWsUrl, SERVER_PORT_KEY, WS_CONNECTED_KEY } from './constants.js';
import type { DisconnectReason, InternalMessage, PluginTabStateInfo } from './extension-messages.js';
import { handleServerMessage } from './message-router.js';
import { forwardToSidePanel, sendToServer } from './messaging.js';
import { getAllPluginMeta } from './plugin-storage.js';
import { rejectAllPendingServerRequests, sendServerRequest } from './server-request.js';
import {
  addPendingAllBrowserToolsUpdate,
  addPendingBrowserToolUpdate,
  addPendingPluginAllToolsUpdate,
  addPendingPluginToolUpdate,
  clearServerStateCache,
  getCachesInitialized,
  getServerStateCache,
  loadServerStateCacheFromSession,
  removePendingAllBrowserToolsUpdate,
  removePendingBrowserToolUpdate,
  removePendingPluginAllToolsUpdate,
  removePendingPluginToolUpdate,
  updateServerStateCache,
} from './server-state-cache.js';
import {
  clearTabStateCache,
  getLastKnownStates,
  loadLastKnownStateFromSession,
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

/** Handle offscreen:getUrl — return the WebSocket URL derived from user-configured port */
const handleOffscreenGetUrl: MessageHandler = (_message, sendResponse) => {
  (async () => {
    const stored: Record<string, unknown> = await chrome.storage.local
      .get(SERVER_PORT_KEY)
      .catch(() => ({}) as Record<string, unknown>);
    const port =
      typeof stored[SERVER_PORT_KEY] === 'number' && stored[SERVER_PORT_KEY] > 0 ? stored[SERVER_PORT_KEY] : undefined;
    const url = port ? buildWsUrl(port) : undefined;
    sendResponse({ url });
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
 * (tool enabled states, browserTools, failedPlugins, serverVersion),
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
    if (wsConnected && tabStates.size === 0 && serverCache.plugins.length === 0) {
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

    // Merge each plugin from metaCache with server state and tab state
    const plugins: ConfigStatePlugin[] = Object.values(metaIndex).map(meta => {
      const serverPlugin = serverPluginMap.get(meta.name);

      // Tab state from lastKnownState cache (serialized JSON)
      let tabState: TabState = 'closed';
      const serialized = tabStates.get(meta.name);
      if (serialized) {
        try {
          const parsed = JSON.parse(serialized) as PluginTabStateInfo;
          tabState = parsed.state;
        } catch {
          // Fall back to 'closed' on parse error
        }
      }

      // Tool enabled states: prefer server cache, default to enabled=true
      const tools = meta.tools.map(metaTool => {
        const serverTool = serverPlugin?.tools.find(st => st.name === metaTool.name);
        return {
          ...metaTool,
          enabled: serverTool?.enabled ?? true,
        };
      });

      return {
        name: meta.name,
        displayName: meta.displayName,
        version: meta.version,
        trustTier: meta.trustTier,
        urlPatterns: meta.urlPatterns,
        iconSvg: meta.iconSvg,
        iconInactiveSvg: meta.iconInactiveSvg,
        tools,
        tabState,
        source: serverPlugin?.source ?? 'local',
        sdkVersion: serverPlugin?.sdkVersion,
        update: serverPlugin?.update,
      };
    });

    sendResponse({
      connected: wsConnected,
      disconnectReason: wsConnected ? undefined : lastDisconnectReason,
      plugins,
      failedPlugins: serverCache.failedPlugins,
      browserTools: serverCache.browserTools,
      serverVersion: serverCache.serverVersion,
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
  if (id !== undefined) {
    clearConfirmationBackgroundTimeout(id);
  }
  clearConfirmationBadge(id);
  sendResponse({ ok: true });
};

/** Handle sp:confirmationTimeout — confirmation timed out without user response */
const handleSpConfirmationTimeout: MessageHandler = (message, sendResponse) => {
  const id = typeof message.id === 'string' ? message.id : undefined;
  if (id !== undefined) {
    clearConfirmationBackgroundTimeout(id);
  }
  clearConfirmationBadge(id);
  sendResponse({ ok: true });
};

/** Handle bg:setToolEnabled — toggle a single tool's enabled state via the MCP server */
const handleBgSetToolEnabled: MessageHandler = (message, sendResponse) => {
  const plugin = message.plugin as string;
  const tool = message.tool as string;
  const enabled = message.enabled as boolean;

  // Capture the original enabled value for surgical rollback
  const cache = getServerStateCache();
  const pluginEntry = cache.plugins.find(p => p.name === plugin);
  const originalEnabled = pluginEntry?.tools.find(t => t.name === tool)?.enabled ?? !enabled;

  // Optimistically update the local server state cache
  const updatedPlugins = cache.plugins.map(p => {
    if (p.name !== plugin) return p;
    return {
      ...p,
      tools: p.tools.map(t => (t.name === tool ? { ...t, enabled } : t)),
    };
  });
  addPendingPluginToolUpdate(plugin, tool, enabled);
  updateServerStateCache({ plugins: updatedPlugins });

  sendServerRequest('config.setToolEnabled', { plugin, tool, enabled })
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
          tools: p.tools.map(t => (t.name === tool ? { ...t, enabled: originalEnabled } : t)),
        };
      });
      updateServerStateCache({ plugins: revertedPlugins });
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:setAllToolsEnabled — toggle all tools for a plugin via the MCP server */
const handleBgSetAllToolsEnabled: MessageHandler = (message, sendResponse) => {
  const plugin = message.plugin as string;
  const enabled = message.enabled as boolean;

  // Capture original enabled values for surgical rollback
  const cache = getServerStateCache();
  const pluginEntry = cache.plugins.find(p => p.name === plugin);
  const toolNames = pluginEntry ? pluginEntry.tools.map(t => t.name) : [];
  const originalToolStates = new Map<string, boolean>();
  if (pluginEntry) {
    for (const t of pluginEntry.tools) {
      originalToolStates.set(t.name, t.enabled);
    }
  }

  // Optimistically update the local server state cache
  const updatedPlugins = cache.plugins.map(p => {
    if (p.name !== plugin) return p;
    return {
      ...p,
      tools: p.tools.map(t => ({ ...t, enabled })),
    };
  });
  addPendingPluginAllToolsUpdate(plugin, toolNames, enabled);
  updateServerStateCache({ plugins: updatedPlugins });

  sendServerRequest('config.setAllToolsEnabled', { plugin, enabled })
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
            enabled: originalToolStates.get(t.name) ?? t.enabled,
          })),
        };
      });
      updateServerStateCache({ plugins: revertedPlugins });
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:setToolsEnabled — toggle a subset of tools for a plugin via the MCP server */
const handleBgSetToolsEnabled: MessageHandler = (message, sendResponse) => {
  const plugin = message.plugin as string;
  const toolNames = message.tools as string[];
  const enabled = message.enabled as boolean;

  // Capture original enabled values for surgical rollback
  const cache = getServerStateCache();
  const pluginEntry = cache.plugins.find(p => p.name === plugin);
  const originalToolStates = new Map<string, boolean>();
  if (pluginEntry) {
    const toolNameSet = new Set(toolNames);
    for (const t of pluginEntry.tools) {
      if (toolNameSet.has(t.name)) {
        originalToolStates.set(t.name, t.enabled);
      }
    }
  }

  // Optimistically update the local server state cache
  const toolNameSet = new Set(toolNames);
  const updatedPlugins = cache.plugins.map(p => {
    if (p.name !== plugin) return p;
    return {
      ...p,
      tools: p.tools.map(t => (toolNameSet.has(t.name) ? { ...t, enabled } : t)),
    };
  });
  addPendingPluginAllToolsUpdate(plugin, toolNames, enabled);
  updateServerStateCache({ plugins: updatedPlugins });

  sendServerRequest('config.setToolsEnabled', { plugin, tools: toolNames, enabled })
    .then((result: unknown) => {
      removePendingPluginAllToolsUpdate(plugin, toolNames);
      sendResponse(result);
    })
    .catch((err: unknown) => {
      removePendingPluginAllToolsUpdate(plugin, toolNames);
      // Surgically revert only the specified tools in the current cache,
      // preserving any concurrent plugins.changed updates that arrived during the request.
      const currentCache = getServerStateCache();
      const revertedPlugins = currentCache.plugins.map(p => {
        if (p.name !== plugin) return p;
        return {
          ...p,
          tools: p.tools.map(t => ({
            ...t,
            enabled: originalToolStates.get(t.name) ?? t.enabled,
          })),
        };
      });
      updateServerStateCache({ plugins: revertedPlugins });
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:setBrowserToolEnabled — toggle a browser tool's enabled state via the MCP server */
const handleBgSetBrowserToolEnabled: MessageHandler = (message, sendResponse) => {
  const tool = message.tool as string;
  const enabled = message.enabled as boolean;

  // Capture the original enabled value for surgical rollback
  const cache = getServerStateCache();
  const originalEnabled = cache.browserTools.find(bt => bt.name === tool)?.enabled ?? !enabled;

  // Optimistically update the local server state cache
  const updatedBrowserTools = cache.browserTools.map(bt => (bt.name === tool ? { ...bt, enabled } : bt));
  addPendingBrowserToolUpdate(tool, enabled);
  updateServerStateCache({ browserTools: updatedBrowserTools });

  sendServerRequest('config.setBrowserToolEnabled', { tool, enabled })
    .then((result: unknown) => {
      removePendingBrowserToolUpdate(tool);
      sendResponse(result);
    })
    .catch((err: unknown) => {
      removePendingBrowserToolUpdate(tool);
      // Surgically revert only the target browser tool in the current cache,
      // preserving any concurrent plugins.changed updates that arrived during the request.
      const currentCache = getServerStateCache();
      const revertedBrowserTools = currentCache.browserTools.map(bt =>
        bt.name === tool ? { ...bt, enabled: originalEnabled } : bt,
      );
      updateServerStateCache({ browserTools: revertedBrowserTools });
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:setAllBrowserToolsEnabled — toggle all browser tools via the MCP server */
const handleBgSetAllBrowserToolsEnabled: MessageHandler = (message, sendResponse) => {
  const enabled = message.enabled as boolean;

  // Capture original enabled values for surgical rollback
  const cache = getServerStateCache();
  const toolNames = cache.browserTools.map(bt => bt.name);
  const originalToolStates = new Map<string, boolean>();
  for (const bt of cache.browserTools) {
    originalToolStates.set(bt.name, bt.enabled);
  }

  // Optimistically update the local server state cache
  const updatedBrowserTools = cache.browserTools.map(bt => ({ ...bt, enabled }));
  addPendingAllBrowserToolsUpdate(toolNames, enabled);
  updateServerStateCache({ browserTools: updatedBrowserTools });

  sendServerRequest('config.setAllBrowserToolsEnabled', { enabled })
    .then((result: unknown) => {
      removePendingAllBrowserToolsUpdate(toolNames);
      sendResponse(result);
    })
    .catch((err: unknown) => {
      removePendingAllBrowserToolsUpdate(toolNames);
      // Surgically revert only the browser tools' enabled states in the current cache,
      // preserving any concurrent plugins.changed updates that arrived during the request.
      const currentCache = getServerStateCache();
      const revertedBrowserTools = currentCache.browserTools.map(bt => ({
        ...bt,
        enabled: originalToolStates.get(bt.name) ?? bt.enabled,
      }));
      updateServerStateCache({ browserTools: revertedBrowserTools });
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

/** Handle port-changed — relay port change to offscreen document for reconnect */
const handlePortChanged: MessageHandler = (message, sendResponse) => {
  chrome.runtime.sendMessage(message as unknown as InternalMessage).catch(() => {
    // Offscreen may not be ready yet
  });
  sendResponse({ ok: true });
};

// ---------------------------------------------------------------------------
// Dispatch map and listener registration
// ---------------------------------------------------------------------------

const backgroundHandlers = new Map<InternalMessage['type'], MessageHandler>([
  ['offscreen:getUrl', handleOffscreenGetUrl],
  ['ws:state', handleWsState],
  ['ws:message', handleWsMessage],
  ['bg:getFullState', handleBgGetFullState],
  ['bg:setToolEnabled', handleBgSetToolEnabled],
  ['bg:setAllToolsEnabled', handleBgSetAllToolsEnabled],
  ['bg:setToolsEnabled', handleBgSetToolsEnabled],
  ['bg:setBrowserToolEnabled', handleBgSetBrowserToolEnabled],
  ['bg:setAllBrowserToolsEnabled', handleBgSetAllBrowserToolsEnabled],
  ['bg:searchPlugins', handleBgSearchPlugins],
  ['bg:installPlugin', handleBgInstallPlugin],
  ['bg:removePlugin', handleBgRemovePlugin],
  ['bg:updatePlugin', handleBgUpdatePlugin],
  ['plugin:logs', handlePluginLogs],
  ['tool:progress', handleToolProgress],
  ['sp:confirmationResponse', handleSpConfirmationResponse],
  ['sp:confirmationTimeout', handleSpConfirmationTimeout],
  ['port-changed', handlePortChanged],
]);

// Message types that must originate from extension contexts (offscreen document,
// side panel, popup) — never from ISOLATED-world content scripts on web pages.
const EXTENSION_ONLY_TYPES: ReadonlySet<InternalMessage['type']> = new Set([
  'offscreen:getUrl',
  'ws:state',
  'ws:message',
  'bg:getFullState',
  'bg:setToolEnabled',
  'bg:setAllToolsEnabled',
  'bg:setToolsEnabled',
  'bg:setBrowserToolEnabled',
  'bg:setAllBrowserToolsEnabled',
  'bg:searchPlugins',
  'bg:installPlugin',
  'bg:removePlugin',
  'bg:updatePlugin',
  'offscreen:getLogs',
  'sp:confirmationResponse',
  'sp:confirmationTimeout',
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
  handleBgRemovePlugin,
  handleBgSearchPlugins,
  handleBgSetAllBrowserToolsEnabled,
  handleBgSetAllToolsEnabled,
  handleBgSetBrowserToolEnabled,
  handleBgSetToolEnabled,
  handleBgSetToolsEnabled,
  handleBgUpdatePlugin,
  handleOffscreenGetUrl,
  handlePluginLogs,
  handlePortChanged,
  handleSpConfirmationResponse,
  handleSpConfirmationTimeout,
  handleToolProgress,
  handleWsMessage,
  handleWsState,
  initBackgroundMessageHandlers,
  restoreWsConnectedState,
  waitForWsConnectedRestore,
};
