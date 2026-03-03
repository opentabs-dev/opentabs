import {
  clearAllConfirmationBadges,
  clearConfirmationBackgroundTimeout,
  clearConfirmationBadge,
} from './confirmation-badge.js';
import { buildWsUrl, SERVER_PORT_KEY, WS_CONNECTED_KEY } from './constants.js';
import { handleServerMessage } from './message-router.js';
import { forwardToSidePanel, sendToServer } from './messaging.js';
import { getAllPluginMeta } from './plugin-storage.js';
import { rejectAllPendingServerRequests, sendServerRequest } from './server-request.js';
import {
  clearServerStateCache,
  getCachesInitialized,
  getServerStateCache,
  loadServerStateCacheFromSession,
  updateServerStateCache,
} from './server-state-cache.js';
import {
  clearTabStateCache,
  getLastKnownStates,
  loadLastKnownStateFromSession,
  stopReadinessPoll,
} from './tab-state.js';
import { notifyDispatchProgress } from './tool-dispatch.js';
import type { DisconnectReason, InternalMessage, PluginTabStateInfo } from './extension-messages.js';
import type { ConfigStatePlugin, TabState } from '@opentabs-dev/shared';

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

/** Restore wsConnected from chrome.storage.session on service worker wake */
const restoreWsConnectedState = (): void => {
  chrome.storage.session
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
    // Read caches once for the wake detection check
    let tabStates = getLastKnownStates();
    let serverCache = getServerStateCache();

    // Wake detection: if the service worker was suspended, in-memory caches
    // are empty but wsConnected may still be true (restored from session storage).
    // Reload caches from session storage before merging.
    // The cachesInitialized check distinguishes "woke from suspension" (true)
    // from "connected but sync.full has not arrived yet" (false). Without it,
    // stale session data would be restored during the connect-to-sync.full gap.
    if (wsConnected && getCachesInitialized() && tabStates.size === 0 && serverCache.plugins.length === 0) {
      await Promise.all([loadLastKnownStateFromSession(), loadServerStateCacheFromSession()]);
      tabStates = getLastKnownStates();
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
    });
  })().catch(() => {
    sendResponse({
      connected: wsConnected,
      disconnectReason: wsConnected ? undefined : lastDisconnectReason,
      plugins: [],
      failedPlugins: [],
      browserTools: [],
      serverVersion: undefined,
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

  // Optimistically update the local server state cache
  const cache = getServerStateCache();
  const originalPlugins = cache.plugins;
  const updatedPlugins = cache.plugins.map(p => {
    if (p.name !== plugin) return p;
    return {
      ...p,
      tools: p.tools.map(t => (t.name === tool ? { ...t, enabled } : t)),
    };
  });
  updateServerStateCache({ plugins: updatedPlugins });

  sendServerRequest('config.setToolEnabled', { plugin, tool, enabled })
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      // Revert to the original plugins on failure
      updateServerStateCache({ plugins: originalPlugins });
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:setAllToolsEnabled — toggle all tools for a plugin via the MCP server */
const handleBgSetAllToolsEnabled: MessageHandler = (message, sendResponse) => {
  const plugin = message.plugin as string;
  const enabled = message.enabled as boolean;

  // Optimistically update the local server state cache
  const cache = getServerStateCache();
  const originalPlugins = cache.plugins;
  const updatedPlugins = cache.plugins.map(p => {
    if (p.name !== plugin) return p;
    return {
      ...p,
      tools: p.tools.map(t => ({ ...t, enabled })),
    };
  });
  updateServerStateCache({ plugins: updatedPlugins });

  sendServerRequest('config.setAllToolsEnabled', { plugin, enabled })
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      // Revert to the original plugins on failure
      updateServerStateCache({ plugins: originalPlugins });
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:setBrowserToolEnabled — toggle a browser tool's enabled state via the MCP server */
const handleBgSetBrowserToolEnabled: MessageHandler = (message, sendResponse) => {
  const tool = message.tool as string;
  const enabled = message.enabled as boolean;

  // Optimistically update the local server state cache
  const cache = getServerStateCache();
  const originalBrowserTools = cache.browserTools;
  const updatedBrowserTools = cache.browserTools.map(bt => (bt.name === tool ? { ...bt, enabled } : bt));
  updateServerStateCache({ browserTools: updatedBrowserTools });

  sendServerRequest('config.setBrowserToolEnabled', { tool, enabled })
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      // Revert to the original browser tools on failure
      updateServerStateCache({ browserTools: originalBrowserTools });
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    });
};

/** Handle bg:setAllBrowserToolsEnabled — toggle all browser tools via the MCP server */
const handleBgSetAllBrowserToolsEnabled: MessageHandler = (message, sendResponse) => {
  const enabled = message.enabled as boolean;

  // Optimistically update the local server state cache
  const cache = getServerStateCache();
  const originalBrowserTools = cache.browserTools;
  const updatedBrowserTools = cache.browserTools.map(bt => ({ ...bt, enabled }));
  updateServerStateCache({ browserTools: updatedBrowserTools });

  sendServerRequest('config.setAllBrowserToolsEnabled', { enabled })
    .then((result: unknown) => {
      sendResponse(result);
    })
    .catch((err: unknown) => {
      // Revert to the original browser tools on failure
      updateServerStateCache({ browserTools: originalBrowserTools });
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
};
