import {
  KEEPALIVE_ALARM,
  KEEPALIVE_INTERVAL_MINUTES,
  PLUGINS_META_KEY,
  SERVER_PORT_KEY,
  WS_CONNECTED_KEY,
} from './constants.js';
import { injectPluginsIntoTab, reinjectStoredPlugins } from './iife-injection.js';
import { handleServerMessage, clearConfirmationBadge, clearAllConfirmationBadges } from './message-router.js';
import { forwardToSidePanel, sendToServer } from './messaging.js';
import { invalidatePluginCache } from './plugin-storage.js';
import { checkTabStateChanges, clearTabStateCache, sendTabSyncAll } from './tab-state.js';
import { notifyDispatchProgress } from './tool-dispatch.js';
import type { DisconnectReason, InternalMessage } from './extension-messages.js';

// --- Side panel toggle ---

// Take manual control of the side panel so we can open/close it on action click.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

// Track per-window open state using Chrome's authoritative onOpened/onClosed
// events (Chrome 141+) instead of guessing in the action click handler.
const openWindows = new Set<number>();

chrome.sidePanel.onOpened.addListener(({ windowId }) => {
  openWindows.add(windowId);
});

chrome.sidePanel.onClosed.addListener(({ windowId }) => {
  openWindows.delete(windowId);
});

chrome.action.onClicked.addListener(({ windowId }) => {
  if (openWindows.has(windowId)) {
    chrome.sidePanel.close({ windowId }).catch(() => {});
  } else {
    chrome.sidePanel.open({ windowId }).catch(() => {});
  }
});

/**
 * In-memory cache of wsConnected. Authoritative state is in chrome.storage.session
 * so it survives MV3 service worker suspension. This cache avoids async reads
 * on every message handler invocation.
 */
let wsConnected = false;
/** Tracks the reason for the last WebSocket disconnection */
let lastDisconnectReason: DisconnectReason | undefined;

/** Restore wsConnected from chrome.storage.session on service worker wake */
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

/** Persist wsConnected to chrome.storage.session */
const persistWsConnected = (connected: boolean): void => {
  wsConnected = connected;
  chrome.storage.session.set({ [WS_CONNECTED_KEY]: connected }).catch(() => {
    // Best-effort persistence
  });
};

let creatingOffscreen: Promise<void> | null = null;

const ensureOffscreenDocument = async (): Promise<void> => {
  if (creatingOffscreen) return creatingOffscreen;

  creatingOffscreen = (async () => {
    // Always attempt creation — chrome.runtime.getContexts() can return
    // stale references to a dying offscreen document immediately after
    // chrome.runtime.reload(), causing the check to pass even though
    // no live offscreen document exists. The createDocument call is
    // idempotent: if one already exists, it throws and we catch below.
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen/offscreen.html',
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: 'Maintain persistent WebSocket connection to MCP server',
      });
    } catch {
      // Already exists — expected when multiple callers race
      // (onInstalled, onStartup, top-level) or on normal startup
      // where the document survived service worker suspension.
    }
  })();

  await creatingOffscreen;
  creatingOffscreen = null;
};

const setupKeepaliveAlarm = async (): Promise<void> => {
  const existing = await chrome.alarms.get(KEEPALIVE_ALARM);
  if (!existing) {
    await chrome.alarms.create(KEEPALIVE_ALARM, {
      periodInMinutes: KEEPALIVE_INTERVAL_MINUTES,
    });
  }
};

// --- Tab event listeners ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Inject adapters before checking tab state so computePluginTabState
    // finds the adapter and can call isReady(). Without this sequencing,
    // the state check races with injection and often reports 'unavailable'
    // even when the adapter would pass isReady().
    injectPluginsIntoTab(tabId, tab.url)
      .then(() => checkTabStateChanges(tabId, changeInfo))
      .catch((err: unknown) => console.warn('[opentabs] tab injection failed:', err));
  } else if (changeInfo.url) {
    checkTabStateChanges(tabId, changeInfo).catch((err: unknown) =>
      console.warn('[opentabs] tab state check failed:', err),
    );
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  checkTabStateChanges(tabId, undefined, true).catch((err: unknown) =>
    console.warn('[opentabs] tab state check failed:', err),
  );
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  // Chrome fires onReplaced when a prerendered page promotes to a visible tab.
  // Handle the removed tab as closed, then inject adapters into the replacement
  // and recompute state — same sequencing as the onUpdated status=complete path.
  checkTabStateChanges(removedTabId, undefined, true).catch((err: unknown) =>
    console.warn('[opentabs] tab state check failed for replaced tab:', err),
  );
  chrome.tabs
    .get(addedTabId)
    .then(async tab => {
      if (tab.url) {
        await injectPluginsIntoTab(addedTabId, tab.url);
      }
      await checkTabStateChanges(addedTabId, { status: 'complete' });
    })
    .catch((err: unknown) => console.warn('[opentabs] tab replacement handling failed:', err));
});

// --- Message routing (offscreen, side panel, content scripts) ---

// Message types that must originate from extension contexts (offscreen document,
// side panel, popup) — never from ISOLATED-world content scripts on web pages.
const EXTENSION_ONLY_TYPES: ReadonlySet<InternalMessage['type']> = new Set([
  'offscreen:getUrl',
  'ws:state',
  'ws:message',
  'bg:send',
  'bg:getConnectionState',
  'offscreen:getLogs',
]);

chrome.runtime.onMessage.addListener((message: InternalMessage, sender, sendResponse) => {
  // Guard: reject extension-only messages from non-extension senders.
  // Content scripts on web pages have sender.id matching the extension, but
  // only when they are registered by this extension. A compromised ISOLATED-world
  // script injected by the extension still shares sender.id. The critical protection
  // here is against messages from other extensions or contexts where sender.id
  // differs — e.g., a malicious extension or injected page script using
  // chrome.runtime.sendMessage with an explicit extensionId.
  if (EXTENSION_ONLY_TYPES.has(message.type) && sender.id !== chrome.runtime.id) {
    console.warn(`[opentabs] Rejected ${message.type} from unauthorized sender:`, sender.id ?? sender.url);
    return false;
  }

  switch (message.type) {
    case 'offscreen:getUrl': {
      // Return the WebSocket URL derived from the user-configured port
      // in chrome.storage.local (default 9515). The offscreen document
      // reads auth.json for the secret separately.
      (async () => {
        const stored: Record<string, unknown> = await chrome.storage.local
          .get(SERVER_PORT_KEY)
          .catch(() => ({}) as Record<string, unknown>);
        const port =
          typeof stored[SERVER_PORT_KEY] === 'number' && stored[SERVER_PORT_KEY] > 0
            ? stored[SERVER_PORT_KEY]
            : undefined;
        const url = port ? `ws://localhost:${port}/ws` : undefined;
        sendResponse({ url });
      })().catch(() => {
        sendResponse({ url: undefined });
      });
      return true;
    }

    case 'ws:state': {
      const wasConnected = wsConnected;
      const nowConnected = message.connected;
      persistWsConnected(nowConnected);
      lastDisconnectReason = nowConnected ? undefined : message.disconnectReason;
      forwardToSidePanel({
        type: 'sp:connectionState',
        data: {
          connected: nowConnected,
          disconnectReason: lastDisconnectReason,
        },
      });
      if (nowConnected && !wasConnected) {
        sendTabSyncAll().catch((err: unknown) => console.warn('[opentabs] tab sync failed:', err));
      }
      if (!nowConnected && wasConnected) {
        clearTabStateCache();
        clearAllConfirmationBadges();
      }
      sendResponse({ ok: true });
      return true;
    }

    case 'ws:message': {
      handleServerMessage(message.data);
      sendResponse({ ok: true });
      return true;
    }

    case 'bg:send': {
      sendToServer(message.data);
      sendResponse({ ok: true });
      return true;
    }

    case 'bg:getConnectionState': {
      sendResponse({
        connected: wsConnected,
        disconnectReason: wsConnected ? undefined : lastDisconnectReason,
      });
      return true;
    }

    case 'plugin:logs': {
      // Forward batched plugin log entries to the MCP server via WebSocket.
      // Each entry becomes a separate JSON-RPC notification so the server
      // can process them individually (buffer, forward to MCP clients, etc.).
      if (wsConnected) {
        for (const entry of message.entries) {
          sendToServer({
            jsonrpc: '2.0',
            method: 'plugin.log',
            params: {
              plugin: message.plugin,
              level: entry.level,
              message: entry.message,
              data: entry.data,
              ts: entry.ts,
            },
          });
        }
      }
      sendResponse({ ok: true });
      return true;
    }

    case 'tool:progress': {
      // Forward tool progress notifications from the content script relay to
      // the MCP server. The server maps these to MCP ProgressNotifications.
      if (wsConnected) {
        sendToServer({
          jsonrpc: '2.0',
          method: 'tool.progress',
          params: {
            dispatchId: message.dispatchId,
            progress: message.progress,
            total: message.total,
            message: message.message,
          },
        });
      }
      // Reset the extension-side script timeout for this dispatch
      notifyDispatchProgress(message.dispatchId);
      sendResponse({ ok: true });
      return true;
    }

    case 'sp:confirmationResponse': {
      // Forward confirmation response from the side panel to the MCP server.
      // The server resolves the pending confirmation promise with the decision.
      if (wsConnected) {
        sendToServer({
          jsonrpc: '2.0',
          method: 'confirmation.response',
          params: message.data,
        });
      }
      clearConfirmationBadge();
      sendResponse({ ok: true });
      return true;
    }

    case 'port-changed': {
      // Relay port change from side panel to offscreen document for reconnect
      chrome.runtime.sendMessage(message).catch(() => {
        // Offscreen may not be ready yet
      });
      sendResponse({ ok: true });
      return true;
    }

    // Messages handled by other listeners (offscreen, side panel) — not
    // processed here, but included for exhaustiveness so TypeScript flags
    // any new InternalMessage variant that isn't routed somewhere.
    case 'ws:send':
    case 'ws:getState':
    case 'ws:setUrl':
    case 'bg:forceReconnect':
    case 'offscreen:getLogs':
    case 'sp:getState':
    case 'sp:connectionState':
    case 'sp:serverMessage':
    case 'sp:confirmationRequest':
      return false;
  }
});

// --- Extension lifecycle ---

chrome.alarms.onAlarm.addListener(() => {
  // Keepalive tick: re-ensure the offscreen document exists so the WebSocket
  // connection recovers automatically if Chrome terminates it under memory pressure.
  ensureOffscreenDocument().catch((err: unknown) => console.warn('[opentabs] offscreen creation failed:', err));
});

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await ensureOffscreenDocument();
    await setupKeepaliveAlarm();
    await reinjectStoredPlugins();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await ensureOffscreenDocument();
    await setupKeepaliveAlarm();
    await reinjectStoredPlugins();
  })();
});

ensureOffscreenDocument().catch((err: unknown) => console.warn('[opentabs] offscreen creation failed:', err));
setupKeepaliveAlarm().catch((err: unknown) => console.warn('[opentabs] keepalive alarm failed:', err));
reinjectStoredPlugins().catch((err: unknown) => console.warn('[opentabs] plugin reinjection failed:', err));

// Relay MCP server URL changes to the offscreen document, and invalidate
// the plugin metadata cache when storage is modified from another context
// (e.g., DevTools, another extension page).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  const portChange = changes[SERVER_PORT_KEY];
  if (typeof portChange?.newValue === 'number' && portChange.newValue > 0) {
    const newUrl = `ws://localhost:${portChange.newValue}/ws`;
    chrome.runtime.sendMessage({ type: 'ws:setUrl', url: newUrl } satisfies InternalMessage).catch(() => {
      // Offscreen may not be ready yet
    });
  }

  if (changes[PLUGINS_META_KEY]) {
    invalidatePluginCache();
  }
});
