import { initBackgroundMessageHandlers, restoreWsConnectedState } from './background-message-handlers.js';
import { initNotificationClickHandler } from './browser-commands/notification-commands.js';
import { initConfirmationBadge } from './confirmation-badge.js';
import {
  buildWsUrl,
  KEEPALIVE_ALARM,
  KEEPALIVE_INTERVAL_MINUTES,
  PLUGINS_META_KEY,
  SERVER_PORT_KEY,
} from './constants.js';
import type { InternalMessage } from './extension-messages.js';
import { injectPluginsIntoTab, reinjectStoredPlugins } from './iife-injection.js';
import { loadLastSeenUrlsFromStorage } from './last-seen-urls.js';
import { getAllPluginMeta, invalidatePluginCache } from './plugin-storage.js';
import { syncPreScripts } from './pre-script-registration.js';
import { initSidePanelToggle } from './side-panel-toggle.js';
import { checkTabChanged, checkTabRemoved } from './tab-state.js';

// --- Side panel toggle ---

initSidePanelToggle();

// --- WebSocket connection state ---

restoreWsConnectedState();
loadLastSeenUrlsFromStorage().catch(() => {
  // Best-effort — storage may not be available on wake
});

// --- Offscreen document management ---

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
  if (changeInfo.status === 'loading' && tab.url) {
    // Inject adapters early so they run before page JavaScript. This lets
    // plugins cache volatile state (e.g., localStorage tokens) that the
    // host app may delete during initialization.
    injectPluginsIntoTab(tabId, tab.url).catch((err: unknown) =>
      console.warn('[opentabs] early tab injection failed:', err),
    );
  } else if (changeInfo.status === 'complete' && tab.url) {
    // Re-inject (idempotent) and check tab state after the page has fully
    // loaded. The isReady() probe runs here because plugins depend on page
    // globals and DOM elements that only exist after page JavaScript executes.
    injectPluginsIntoTab(tabId, tab.url)
      .then(() => checkTabChanged(tabId, changeInfo))
      .catch((err: unknown) => console.warn('[opentabs] tab injection failed:', err));
  } else if (changeInfo.url) {
    checkTabChanged(tabId, changeInfo).catch((err: unknown) => console.warn('[opentabs] tab state check failed:', err));
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  checkTabRemoved(tabId).catch((err: unknown) => console.warn('[opentabs] tab state check failed:', err));
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  // Chrome fires onReplaced when a prerendered page promotes to a visible tab.
  // Handle the removed tab as closed, then inject adapters into the replacement
  // and recompute state — same sequencing as the onUpdated status=complete path.
  checkTabRemoved(removedTabId).catch((err: unknown) =>
    console.warn('[opentabs] tab state check failed for replaced tab:', err),
  );
  chrome.tabs
    .get(addedTabId)
    .then(async tab => {
      if (tab.url) {
        await injectPluginsIntoTab(addedTabId, tab.url);
      }
      await checkTabChanged(addedTabId, { status: 'complete' });
    })
    .catch((err: unknown) => console.warn('[opentabs] tab replacement handling failed:', err));
});

// --- Message routing (offscreen, side panel, content scripts) ---

initBackgroundMessageHandlers();

// --- Connection identity ---

/**
 * Ensure a stable connectionId exists in chrome.storage.local.
 * Generated once per extension installation; persists across reloads and restarts.
 * chrome.storage.local is isolated per browser profile, so regular and incognito
 * profiles get distinct connectionIds without any incognito detection logic.
 */
const ensureConnectionId = async (): Promise<void> => {
  const data = await chrome.storage.local.get('connectionId');
  if (typeof data.connectionId !== 'string') {
    await chrome.storage.local.set({ connectionId: crypto.randomUUID() });
  }
};

// --- Extension lifecycle ---

chrome.alarms.onAlarm.addListener(() => {
  // Keepalive tick: re-ensure the offscreen document exists so the WebSocket
  // connection recovers automatically if Chrome terminates it under memory pressure.
  ensureOffscreenDocument().catch((err: unknown) => console.warn('[opentabs] offscreen creation failed:', err));
});

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await ensureConnectionId();
    await ensureOffscreenDocument();
    await setupKeepaliveAlarm();
    await reinjectStoredPlugins();
    // persistAcrossSessions does not survive extension updates — resync
    // the registered content-script set from the durable plugin metadata.
    const metas = Object.values(await getAllPluginMeta());
    await syncPreScripts(metas);
  })().catch((err: unknown) => console.warn('[opentabs] onInstalled failed:', err));
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await ensureConnectionId();
    await ensureOffscreenDocument();
    await setupKeepaliveAlarm();
    await reinjectStoredPlugins();
    // persistAcrossSessions does not survive extension updates — resync
    // the registered content-script set from the durable plugin metadata.
    const metas = Object.values(await getAllPluginMeta());
    await syncPreScripts(metas);
  })().catch((err: unknown) => console.warn('[opentabs] onStartup failed:', err));
});

ensureConnectionId()
  .then(() => ensureOffscreenDocument())
  .catch((err: unknown) => console.warn('[opentabs] offscreen creation failed:', err));
setupKeepaliveAlarm().catch((err: unknown) => console.warn('[opentabs] keepalive alarm failed:', err));
reinjectStoredPlugins()
  .then(async () => {
    const metas = Object.values(await getAllPluginMeta());
    await syncPreScripts(metas);
  })
  .catch((err: unknown) => console.warn('[opentabs] plugin reinjection failed:', err));
initConfirmationBadge();
initNotificationClickHandler();

// Relay MCP server URL changes to the offscreen document, and invalidate
// the plugin metadata cache when storage is modified from another context
// (e.g., DevTools, another extension page).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  const portChange = changes[SERVER_PORT_KEY];
  if (
    typeof portChange?.newValue === 'number' &&
    Number.isInteger(portChange.newValue) &&
    portChange.newValue >= 1 &&
    portChange.newValue <= 65535
  ) {
    const newUrl = buildWsUrl(portChange.newValue);
    chrome.runtime.sendMessage({ type: 'ws:setUrl', url: newUrl } satisfies InternalMessage).catch(() => {
      // Offscreen may not be ready yet
    });
  }

  if (changes[PLUGINS_META_KEY]) {
    invalidatePluginCache();
  }
});
