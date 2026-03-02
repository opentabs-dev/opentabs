import {
  handleBrowserClearConsoleLogs,
  handleBrowserClickElement,
  handleBrowserCloseTab,
  handleBrowserDeleteCookies,
  handleBrowserDisableNetworkCapture,
  handleBrowserEnableNetworkCapture,
  handleBrowserExecuteScript,
  handleBrowserFocusTab,
  handleBrowserGetConsoleLogs,
  handleBrowserGetCookies,
  handleBrowserGetNetworkRequests,
  handleBrowserGetPageHtml,
  handleBrowserGetWebSocketFrames,
  handleBrowserGetStorage,
  handleBrowserGetTabContent,
  handleBrowserGetTabInfo,
  handleBrowserGetResourceContent,
  handleBrowserHandleDialog,
  handleBrowserListResources,
  handleBrowserListTabs,
  handleBrowserHoverElement,
  handleBrowserPressKey,
  handleBrowserScroll,
  handleBrowserNavigateTab,
  handleBrowserOpenTab,
  handleBrowserQueryElements,
  handleBrowserScreenshotTab,
  handleBrowserSelectOption,
  handleBrowserSetCookie,
  handleBrowserTypeText,
  handleBrowserWaitForElement,
  handleExtensionCheckAdapter,
  handleExtensionForceReconnect,
  handleExtensionGetLogs,
  handleExtensionGetSidePanel,
  handleExtensionGetState,
} from './browser-commands/index.js';
import { notifyConfirmationRequest } from './confirmation-badge.js';
import { isValidPluginName, RELOAD_FLUSH_DELAY_MS, WS_CONNECTED_KEY } from './constants.js';
import { cleanupAdaptersInMatchingTabs, injectPluginIntoMatchingTabs } from './iife-injection.js';
import { JSONRPC_INTERNAL_ERROR, JSONRPC_INVALID_PARAMS, JSONRPC_METHOD_NOT_FOUND } from './json-rpc-errors.js';
import { forwardToSidePanel, sendTabStateNotification, sendToServer } from './messaging.js';
import { getAllPluginMeta, removePlugin, removePluginsBatch, storePluginsBatch } from './plugin-storage.js';
import { checkRateLimit } from './rate-limiter.js';
import { handleResourceRead, handlePromptGet } from './resource-prompt-dispatch.js';
import { clearPluginTabState, computePluginTabState, sendTabSyncAll, updateLastKnownState } from './tab-state.js';
import { handleToolDispatch } from './tool-dispatch.js';
import type { PluginMeta } from './extension-messages.js';
import type { TrustTier, WireToolDef } from '@opentabs-dev/shared';

type MessageHandler = (params: Record<string, unknown>, id?: string | number) => void;

/** Wraps an async request handler with the id !== undefined guard and .catch logging */
const wrapAsync =
  (method: string, fn: (params: Record<string, unknown>, id: string | number) => Promise<void>): MessageHandler =>
  (params, id) => {
    if (id !== undefined) {
      fn(params, id).catch((err: unknown) => console.warn(`[opentabs] ${method} handler failed:`, err));
    }
  };

/** Wraps a sync request handler with the id !== undefined guard and try-catch error logging */
const wrapSync =
  (method: string, fn: (params: Record<string, unknown>, id: string | number) => void): MessageHandler =>
  (params, id) => {
    if (id !== undefined) {
      try {
        fn(params, id);
      } catch (err: unknown) {
        console.warn(`[opentabs] ${method} handler failed:`, err);
      }
    }
  };

/** Wraps an async notification handler (no id guard — always executes) with .catch logging */
const wrapNotification =
  (method: string, fn: (params: Record<string, unknown>) => Promise<void>): MessageHandler =>
  params => {
    fn(params).catch((err: unknown) => console.warn(`[opentabs] ${method} handler failed:`, err));
  };

/**
 * Methods whose notifications the side panel processes. Messages with other
 * methods are not forwarded — this avoids sending payloads like sync.full
 * (contains all plugin metadata) and tool.dispatch (contains tool input) to
 * the side panel, which only needs tab state changes and invocation animations.
 */
const SIDE_PANEL_METHODS = new Set([
  'tab.stateChanged',
  'tool.invocationStart',
  'tool.invocationEnd',
  'plugins.changed',
  'confirmation.request',
]);

// ---------------------------------------------------------------------------
// Payload validation — defense-in-depth for data that arrives over WebSocket
// and flows into chrome.storage and chrome.scripting.executeScript (MAIN world).
// ---------------------------------------------------------------------------

/** Validated plugin payload after passing through validatePluginPayload */
interface ValidatedPluginPayload {
  name: string;
  version: string;
  displayName: string;
  urlPatterns: string[];
  trustTier: TrustTier;
  sourcePath?: string;
  adapterHash?: string;
  adapterFile?: string;
  iconSvg?: string;
  iconInactiveSvg?: string;
  tools: WireToolDef[];
}

/** Convert a validated plugin payload to the PluginMeta shape stored in chrome.storage */
const toPluginMeta = (p: ValidatedPluginPayload): PluginMeta => ({
  name: p.name,
  version: p.version,
  displayName: p.displayName,
  urlPatterns: p.urlPatterns,
  trustTier: p.trustTier,
  sourcePath: p.sourcePath,
  adapterHash: p.adapterHash,
  adapterFile: p.adapterFile,
  iconSvg: p.iconSvg,
  iconInactiveSvg: p.iconInactiveSvg,
  tools: p.tools,
});

/**
 * Validate a raw plugin payload from sync.full or plugin.update.
 * Returns a validated payload or null if the payload is malformed.
 * Logs a warning for each rejected payload so issues are visible in DevTools.
 */
const validatePluginPayload = (raw: unknown): ValidatedPluginPayload | null => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    console.warn('[opentabs] Rejecting plugin payload: not an object');
    return null;
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    console.warn('[opentabs] Rejecting plugin payload: missing or invalid "name"');
    return null;
  }

  // Defense-in-depth: reject names with path traversal characters or names
  // that don't match the expected plugin name format (lowercase alphanumeric
  // with hyphens). This prevents a compromised MCP server from injecting
  // arbitrary file paths via crafted plugin names.
  if (/[/\\]|\.\./.test(obj.name) || !isValidPluginName(obj.name)) {
    console.warn(`[opentabs] Rejecting plugin payload: unsafe name "${obj.name}"`);
    return null;
  }

  const urlPatterns = Array.isArray(obj.urlPatterns)
    ? (obj.urlPatterns as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  const tools = Array.isArray(obj.tools)
    ? (obj.tools as unknown[])
        .filter(
          (t): t is Record<string, unknown> =>
            typeof t === 'object' &&
            t !== null &&
            typeof (t as Record<string, unknown>).name === 'string' &&
            typeof (t as Record<string, unknown>).description === 'string' &&
            typeof (t as Record<string, unknown>).enabled === 'boolean',
        )
        .map(
          (t): WireToolDef => ({
            name: t.name as string,
            displayName: typeof t.displayName === 'string' ? t.displayName : (t.name as string),
            description: t.description as string,
            icon: typeof t.icon === 'string' ? t.icon : 'wrench',
            enabled: t.enabled as boolean,
          }),
        )
    : [];

  return {
    name: obj.name,
    version: typeof obj.version === 'string' ? obj.version : '0.0.0',
    displayName: typeof obj.displayName === 'string' ? obj.displayName : obj.name,
    urlPatterns,
    trustTier:
      obj.trustTier === 'official' || obj.trustTier === 'community' || obj.trustTier === 'local'
        ? obj.trustTier
        : 'local',
    sourcePath: typeof obj.sourcePath === 'string' ? obj.sourcePath : undefined,
    adapterHash: typeof obj.adapterHash === 'string' ? obj.adapterHash : undefined,
    adapterFile: typeof obj.adapterFile === 'string' ? obj.adapterFile : undefined,
    iconSvg: typeof obj.iconSvg === 'string' ? obj.iconSvg : undefined,
    iconInactiveSvg: typeof obj.iconInactiveSvg === 'string' ? obj.iconInactiveSvg : undefined,
    tools,
  };
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Handle extension.reload: respond if id is present, then clear ws state and reload */
const handleExtensionReload: MessageHandler = (_params, id) => {
  if (id !== undefined) {
    sendToServer({ jsonrpc: '2.0', result: { reloading: true }, id });
  }
  // Clear wsConnected from session storage before reload so the restarted
  // background script does not read a stale "true" value. Without this,
  // the ws:state connected=true message from the new offscreen document
  // would be treated as a no-op (wasConnected already true), skipping
  // sendTabSyncAll and leaving the MCP server without tab state.
  //
  // The reload is scheduled after the storage write completes (with a
  // small delay for the response to flush over WebSocket).
  void chrome.storage.session
    .set({ [WS_CONNECTED_KEY]: false })
    .catch(() => {})
    .then(() => {
      setTimeout(() => {
        chrome.runtime.reload();
      }, RELOAD_FLUSH_DELAY_MS);
    });
};

const handleSyncFull = async (params: Record<string, unknown>): Promise<void> => {
  const rawPlugins = params.plugins;
  if (!Array.isArray(rawPlugins)) return;

  // Validate each payload — reject malformed entries instead of blindly casting
  const validated: ValidatedPluginPayload[] = [];
  for (const raw of rawPlugins) {
    const result = validatePluginPayload(raw);
    if (result) validated.push(result);
  }

  // Deduplicate by plugin name (last occurrence wins, defense-in-depth)
  const deduped = new Map<string, ValidatedPluginPayload>();
  for (const p of validated) {
    if (deduped.has(p.name)) {
      console.warn(`[opentabs] Duplicate plugin in sync.full: ${p.name} — using last occurrence`);
    }
    deduped.set(p.name, p);
  }
  const uniquePlugins = Array.from(deduped.values());

  // Collect the names of plugins in this sync set
  const syncedNames = new Set(uniquePlugins.map(p => p.name));

  // Remove plugins that are in storage but absent from the sync set (batched)
  const existingMeta = await getAllPluginMeta();
  const removedNames = Object.keys(existingMeta).filter(name => !syncedNames.has(name));
  if (removedNames.length > 0) {
    // Clean up injected adapters from matching tabs before removing storage
    // entries (need URL patterns from existingMeta to find the right tabs).
    // Best-effort: errors are caught per-plugin so one failure does not block
    // cleanup of other plugins or the rest of the sync.full flow.
    await Promise.allSettled(
      removedNames.map(name => {
        const meta = existingMeta[name];
        if (meta) return cleanupAdaptersInMatchingTabs(name, meta.urlPatterns);
        return Promise.resolve();
      }),
    );
    await removePluginsBatch(removedNames);
    for (const name of removedNames) clearPluginTabState(name);
  }

  // Build the full meta index in memory, then write to chrome.storage.local
  // in a single batched call.
  const metas: PluginMeta[] = uniquePlugins.map(toPluginMeta);

  await storePluginsBatch(metas);

  // Inject all plugins into matching tabs in parallel — each plugin's
  // injection is independent and involves cross-process IPC, so parallelizing
  // avoids O(N × round-trip) latency on sync.full with many plugins.
  // Using allSettled so one failed injection does not block tab state sync.
  //
  // Pass skipIfHashMatches so that tabs with an already-injected adapter
  // whose hash matches the sync payload are skipped. This eliminates
  // Chrome executeScript pipeline saturation during WebSocket reconnects
  // where the adapter code hasn't changed.
  const injectionResults = await Promise.allSettled(
    metas.map(meta =>
      injectPluginIntoMatchingTabs(
        meta.name,
        meta.urlPatterns,
        true,
        meta.adapterHash,
        meta.adapterFile,
        meta.adapterHash,
      ),
    ),
  );
  for (const result of injectionResults) {
    if (result.status === 'rejected') {
      console.warn('[opentabs] Plugin injection failed during sync.full:', result.reason);
    }
  }

  // Send tab.syncAll AFTER all plugins are stored and injected to avoid the
  // race condition where tab.syncAll runs before plugins are in storage.
  await sendTabSyncAll();

  // Notify the side panel so it refreshes its plugin list without user interaction
  forwardToSidePanel({
    type: 'sp:serverMessage',
    data: { jsonrpc: '2.0', method: 'plugins.changed' },
  });
};

const handlePluginUpdate = async (params: Record<string, unknown>): Promise<void> => {
  const validated = validatePluginPayload(params);
  if (!validated) return;

  const meta = toPluginMeta(validated);

  await storePluginsBatch([meta]);
  // Force re-injection so the new IIFE overwrites the stale adapter code
  // already present in matching tabs. Without this, injectPluginIntoMatchingTabs
  // skips tabs where the adapter is already injected, leaving old code running.
  await injectPluginIntoMatchingTabs(meta.name, meta.urlPatterns, true, meta.adapterHash, meta.adapterFile);

  // Report updated tab state to the server after re-injection so the MCP
  // server's tabMapping reflects the new adapter's readiness immediately.
  // updateLastKnownState goes through the plugin lock to avoid interleaving
  // with concurrent checkTabChanged / checkTabRemoved for the same plugin.
  const newState = await computePluginTabState(meta);
  await updateLastKnownState(meta.name, newState);
  sendTabStateNotification(meta.name, newState);

  // Notify the side panel so it refreshes its plugin list without user interaction
  forwardToSidePanel({
    type: 'sp:serverMessage',
    data: { jsonrpc: '2.0', method: 'plugins.changed' },
  });
};

const handlePluginUninstall = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  const pluginName = params.name;
  if (typeof pluginName !== 'string' || pluginName.length === 0) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: JSONRPC_INVALID_PARAMS, message: 'Missing plugin name' },
      id,
    });
    return;
  }

  if (!isValidPluginName(pluginName)) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: JSONRPC_INVALID_PARAMS, message: `Invalid plugin name format: "${pluginName}"` },
      id,
    });
    return;
  }

  // Clean up injected adapters from matching tabs before removing storage
  // (need URL patterns from meta to find the right tabs).
  // Best-effort: a cleanup failure must not prevent plugin removal from
  // storage and tab state, matching handleSyncFull's allSettled approach.
  const meta = await getAllPluginMeta();
  const pluginMeta = meta[pluginName];
  if (pluginMeta) {
    try {
      await cleanupAdaptersInMatchingTabs(pluginName, pluginMeta.urlPatterns);
    } catch (err: unknown) {
      console.warn(`[opentabs] Failed to clean up adapters for ${pluginName}:`, err);
    }
  }

  await removePlugin(pluginName);
  clearPluginTabState(pluginName);
  sendToServer({
    jsonrpc: '2.0',
    result: { success: true },
    id,
  });
};

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

/** Dispatch table mapping JSON-RPC methods to handlers */
const methodHandlers = new Map<string, MessageHandler>([
  ['extension.reload', handleExtensionReload],
  ['sync.full', wrapNotification('sync.full', handleSyncFull)],
  ['plugin.update', wrapNotification('plugin.update', handlePluginUpdate)],
  ['plugin.uninstall', wrapAsync('plugin.uninstall', handlePluginUninstall)],
  ['tool.dispatch', wrapAsync('tool.dispatch', handleToolDispatch)],
  ['resource.read', wrapAsync('resource.read', handleResourceRead)],
  ['prompt.get', wrapAsync('prompt.get', handlePromptGet)],
  ['browser.listTabs', wrapAsync('browser.listTabs', (_params, id) => handleBrowserListTabs(id))],
  ['browser.openTab', wrapAsync('browser.openTab', handleBrowserOpenTab)],
  ['browser.closeTab', wrapAsync('browser.closeTab', handleBrowserCloseTab)],
  ['browser.navigateTab', wrapAsync('browser.navigateTab', handleBrowserNavigateTab)],
  ['browser.focusTab', wrapAsync('browser.focusTab', handleBrowserFocusTab)],
  ['browser.getTabInfo', wrapAsync('browser.getTabInfo', handleBrowserGetTabInfo)],
  ['browser.screenshotTab', wrapAsync('browser.screenshotTab', handleBrowserScreenshotTab)],
  ['browser.getTabContent', wrapAsync('browser.getTabContent', handleBrowserGetTabContent)],
  ['browser.getPageHtml', wrapAsync('browser.getPageHtml', handleBrowserGetPageHtml)],
  ['browser.getStorage', wrapAsync('browser.getStorage', handleBrowserGetStorage)],
  ['browser.clickElement', wrapAsync('browser.clickElement', handleBrowserClickElement)],
  ['browser.typeText', wrapAsync('browser.typeText', handleBrowserTypeText)],
  ['browser.selectOption', wrapAsync('browser.selectOption', handleBrowserSelectOption)],
  ['browser.waitForElement', wrapAsync('browser.waitForElement', handleBrowserWaitForElement)],
  ['browser.queryElements', wrapAsync('browser.queryElements', handleBrowserQueryElements)],
  ['browser.getCookies', wrapAsync('browser.getCookies', handleBrowserGetCookies)],
  ['browser.setCookie', wrapAsync('browser.setCookie', handleBrowserSetCookie)],
  ['browser.deleteCookies', wrapAsync('browser.deleteCookies', handleBrowserDeleteCookies)],
  ['browser.enableNetworkCapture', wrapAsync('browser.enableNetworkCapture', handleBrowserEnableNetworkCapture)],
  ['browser.getNetworkRequests', wrapSync('browser.getNetworkRequests', handleBrowserGetNetworkRequests)],
  ['browser.getWebSocketFrames', wrapSync('browser.getWebSocketFrames', handleBrowserGetWebSocketFrames)],
  ['browser.disableNetworkCapture', wrapSync('browser.disableNetworkCapture', handleBrowserDisableNetworkCapture)],
  ['browser.getConsoleLogs', wrapSync('browser.getConsoleLogs', handleBrowserGetConsoleLogs)],
  ['browser.clearConsoleLogs', wrapSync('browser.clearConsoleLogs', handleBrowserClearConsoleLogs)],
  ['browser.executeScript', wrapAsync('browser.executeScript', handleBrowserExecuteScript)],
  ['browser.listResources', wrapAsync('browser.listResources', handleBrowserListResources)],
  ['browser.getResourceContent', wrapAsync('browser.getResourceContent', handleBrowserGetResourceContent)],
  ['browser.pressKey', wrapAsync('browser.pressKey', handleBrowserPressKey)],
  ['browser.scroll', wrapAsync('browser.scroll', handleBrowserScroll)],
  ['browser.hoverElement', wrapAsync('browser.hoverElement', handleBrowserHoverElement)],
  ['browser.handleDialog', wrapAsync('browser.handleDialog', handleBrowserHandleDialog)],
  ['extension.getState', wrapAsync('extension.getState', (_params, id) => handleExtensionGetState(id))],
  ['extension.getLogs', wrapAsync('extension.getLogs', handleExtensionGetLogs)],
  ['extension.getSidePanel', wrapAsync('extension.getSidePanel', (_params, id) => handleExtensionGetSidePanel(id))],
  ['extension.checkAdapter', wrapAsync('extension.checkAdapter', handleExtensionCheckAdapter)],
  [
    'extension.forceReconnect',
    wrapAsync('extension.forceReconnect', (_params, id) => handleExtensionForceReconnect(id)),
  ],
]);

/** Handle a JSON-RPC message received from the MCP server */
const handleServerMessage = (message: Record<string, unknown>): void => {
  const method = message.method as string | undefined;
  const id = message.id as string | number | undefined;
  const params = (message.params ?? {}) as Record<string, unknown>;

  // Forward to the side panel only if useful: responses (matched by id in the
  // bridge's pending-request map) and the small set of notification methods the
  // side panel actually handles. This avoids sending large payloads
  // (sync.full metadata, tool.dispatch input) that the side panel would ignore.
  const isResponse = id !== undefined && !method;
  if (isResponse || (method && SIDE_PANEL_METHODS.has(method))) {
    forwardToSidePanel({ type: 'sp:serverMessage', data: message });
  }

  // Badge and notification for confirmation requests — alerts the user when a
  // browser tool needs approval, especially when the side panel is closed.
  if (method === 'confirmation.request') {
    notifyConfirmationRequest(params);
  }

  if (!method) return;

  const handler = methodHandlers.get(method);
  if (handler) {
    if (!checkRateLimit(method)) {
      console.warn(`[opentabs] Rate limited: ${method}`);
      if (id !== undefined) {
        sendToServer({
          jsonrpc: '2.0',
          error: { code: JSONRPC_INTERNAL_ERROR, message: `Rate limited: ${method}` },
          id,
        });
      }
      return;
    }
    handler(params, id);
    return;
  }

  // Unrecognized method with an id — send JSONRPC_METHOD_NOT_FOUND
  if (id !== undefined) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: JSONRPC_METHOD_NOT_FOUND, message: `Method not found: ${method}` },
      id,
    });
  }
};

/** Method names registered in the dispatch table, exported for test verification */
const methodHandlerNames = Array.from(methodHandlers.keys());

export { handleServerMessage, methodHandlerNames, validatePluginPayload };
export type { ValidatedPluginPayload };
