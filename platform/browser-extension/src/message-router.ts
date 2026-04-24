import type {
  ConfigSchema,
  ConfigStateBrowserTool,
  ConfigStateFailedPlugin,
  ConfigStatePlugin,
  ConfigStateResult,
  ToolPermission,
  WireToolDef,
} from '@opentabs-dev/shared';
import {
  handleBrowserAddTabsToGroup,
  handleBrowserClearConsoleLogs,
  handleBrowserClearEmulation,
  handleBrowserClearNetworkThrottle,
  handleBrowserClearSiteData,
  handleBrowserClickElement,
  handleBrowserCloseTab,
  handleBrowserCloseWindow,
  handleBrowserCreateBookmark,
  handleBrowserCreateTabGroup,
  handleBrowserCreateWindow,
  handleBrowserDeleteCookies,
  handleBrowserDisableNetworkCapture,
  handleBrowserDownloadFile,
  handleBrowserEmulateDevice,
  handleBrowserEmulateVisionDeficiency,
  handleBrowserEnableNetworkCapture,
  handleBrowserExecuteScript,
  handleBrowserFailRequest,
  handleBrowserFocusTab,
  handleBrowserForcePseudoState,
  handleBrowserFulfillRequest,
  handleBrowserGetConsoleLogs,
  handleBrowserGetCookies,
  handleBrowserGetCssCoverage,
  handleBrowserGetDownloadStatus,
  handleBrowserGetElementStyles,
  handleBrowserGetNetworkRequests,
  handleBrowserGetPageHtml,
  handleBrowserGetRecentlyClosed,
  handleBrowserGetResourceContent,
  handleBrowserGetStorage,
  handleBrowserGetTabContent,
  handleBrowserGetTabInfo,
  handleBrowserGetVisits,
  handleBrowserGetWebSocketFrames,
  handleBrowserHandleDialog,
  handleBrowserHoverElement,
  handleBrowserInterceptRequests,
  handleBrowserListBookmarkTree,
  handleBrowserListDownloads,
  handleBrowserListResources,
  handleBrowserListTabGroups,
  handleBrowserListTabs,
  handleBrowserListTabsInGroup,
  handleBrowserListWindows,
  handleBrowserNavigateTab,
  handleBrowserOpenTab,
  handleBrowserPressKey,
  handleBrowserQueryElements,
  handleBrowserRemoveTabsFromGroup,
  handleBrowserRestoreSession,
  handleBrowserScreenshotTab,
  handleBrowserScroll,
  handleBrowserSearchBookmarks,
  handleBrowserSearchHistory,
  handleBrowserSelectOption,
  handleBrowserSetCookie,
  handleBrowserSetGeolocation,
  handleBrowserSetMediaFeatures,
  handleBrowserShowNotification,
  handleBrowserStopIntercepting,
  handleBrowserThrottleNetwork,
  handleBrowserTypeText,
  handleBrowserUpdateTabGroup,
  handleBrowserUpdateWindow,
  handleBrowserWaitForElement,
  handleExtensionCheckAdapter,
  handleExtensionForceReconnect,
  handleExtensionGetLogs,
  handleExtensionGetSidePanel,
  handleExtensionGetState,
} from './browser-commands/index.js';
import { notifyConfirmationRequest } from './confirmation-badge.js';
import { isValidPluginName, RELOAD_FLUSH_DELAY_MS, WS_CONNECTED_KEY } from './constants.js';
import type { PluginMeta } from './extension-messages.js';
import { cleanupAdaptersInMatchingTabs, injectPluginIntoMatchingTabs, queryMatchingTabIds } from './iife-injection.js';
import { JSONRPC_INTERNAL_ERROR, JSONRPC_INVALID_PARAMS, JSONRPC_METHOD_NOT_FOUND } from './json-rpc-errors.js';
import { forwardToSidePanel, sendTabStateNotification, sendToServer } from './messaging.js';
import {
  getAllPluginMeta,
  getPluginMeta,
  removePlugin,
  removePluginsBatch,
  storePluginsBatch,
} from './plugin-storage.js';
import { removePreScript, syncPreScripts, upsertPreScript } from './pre-script-registration.js';
import { checkRateLimit } from './rate-limiter.js';
import { consumeServerResponse } from './server-request.js';
import {
  flushServerStateCacheToSession,
  getServerStateCache,
  setCachesInitialized,
  updateServerStateCache,
} from './server-state-cache.js';
import {
  clearPluginTabState,
  computePluginTabState,
  flushLastKnownStateToSession,
  getLastKnownStates,
  loadLastKnownStateFromSession,
  sendTabSyncAll,
  startReadinessPoll,
  updateLastKnownState,
} from './tab-state.js';
import { handleToolDispatch } from './tool-dispatch.js';

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
  excludePatterns: string[];
  homepage?: string;
  permission: ToolPermission;
  sourcePath?: string;
  adapterHash?: string;
  adapterFile?: string;
  resolvedSettings?: Record<string, unknown>;
  instanceMap?: Record<string, string>;
  iconSvg?: string;
  iconInactiveSvg?: string;
  iconDarkSvg?: string;
  iconDarkInactiveSvg?: string;
  preScriptFile?: string;
  preScriptHash?: string;
  tools: WireToolDef[];
}

/** Server-only fields extracted from raw WebSocket JSON payloads. */
interface ServerOnlyPluginFields {
  source: 'npm' | 'local';
  reviewed: boolean;
  npmPackageName?: string;
  sdkVersion?: string;
  update?: { latestVersion: string; updateCommand: string };
  configSchema?: ConfigSchema;
  resolvedSettings?: Record<string, unknown>;
}

/** Extract server-only fields from a raw JSON payload with runtime type validation. */
const extractServerOnlyFields = (raw: Record<string, unknown> | undefined): ServerOnlyPluginFields => ({
  source: raw?.source === 'npm' || raw?.source === 'local' ? raw.source : 'local',
  reviewed: raw?.reviewed === true,
  ...(typeof raw?.npmPackageName === 'string' ? { npmPackageName: raw.npmPackageName } : {}),
  ...(typeof raw?.sdkVersion === 'string' ? { sdkVersion: raw.sdkVersion } : {}),
  ...(raw?.update && typeof raw.update === 'object'
    ? { update: raw.update as { latestVersion: string; updateCommand: string } }
    : {}),
  ...(raw?.configSchema && typeof raw.configSchema === 'object'
    ? { configSchema: raw.configSchema as ConfigSchema }
    : {}),
  ...(raw?.resolvedSettings && typeof raw.resolvedSettings === 'object'
    ? { resolvedSettings: raw.resolvedSettings as Record<string, unknown> }
    : {}),
});

/** Convert a validated plugin payload to the PluginMeta shape stored in chrome.storage */
const toPluginMeta = (p: ValidatedPluginPayload): PluginMeta => ({
  name: p.name,
  version: p.version,
  displayName: p.displayName,
  urlPatterns: p.urlPatterns,
  excludePatterns: p.excludePatterns.length > 0 ? p.excludePatterns : undefined,
  homepage: p.homepage,
  permission: p.permission,
  sourcePath: p.sourcePath,
  adapterHash: p.adapterHash,
  adapterFile: p.adapterFile,
  resolvedSettings: p.resolvedSettings,
  instanceMap: p.instanceMap,
  iconSvg: p.iconSvg,
  iconInactiveSvg: p.iconInactiveSvg,
  iconDarkSvg: p.iconDarkSvg,
  iconDarkInactiveSvg: p.iconDarkInactiveSvg,
  preScriptFile: p.preScriptFile,
  preScriptHash: p.preScriptHash,
  tools: p.tools,
});

/** Parse and validate an instanceMap (Record<string, string>) from a raw payload value. */
const parseInstanceMap = (raw: unknown): Record<string, string> | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const result: Record<string, string> = {};
  let hasEntries = false;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = value;
      hasEntries = true;
    }
  }
  return hasEntries ? result : undefined;
};

/** Parse and validate a resolvedSettings object from a raw payload value.
 *  Accepts primitives (string, number, boolean) and plain objects (url field maps). */
const parseResolvedSettings = (raw: unknown): Record<string, unknown> | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  let hasEntries = false;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
      hasEntries = true;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = value;
      hasEntries = true;
    }
  }
  return hasEntries ? result : undefined;
};

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

  const excludePatterns = Array.isArray(obj.excludePatterns)
    ? (obj.excludePatterns as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];
  const homepage = typeof obj.homepage === 'string' && obj.homepage.length > 0 ? obj.homepage : undefined;

  const tools = Array.isArray(obj.tools)
    ? (obj.tools as unknown[])
        .filter(
          (t): t is Record<string, unknown> =>
            typeof t === 'object' &&
            t !== null &&
            typeof (t as Record<string, unknown>).name === 'string' &&
            typeof (t as Record<string, unknown>).description === 'string',
        )
        .map((t): WireToolDef => {
          if (t.permission !== 'off' && t.permission !== 'ask' && t.permission !== 'auto') {
            console.warn(
              `[opentabs] Tool "${t.name as string}" in plugin "${obj.name as string}" has invalid "permission" field — defaulting to permission='off'. This is a server-side bug.`,
            );
          }
          return {
            name: t.name as string,
            displayName: typeof t.displayName === 'string' ? t.displayName : (t.name as string),
            description: t.description as string,
            ...(typeof t.summary === 'string' ? { summary: t.summary } : {}),
            icon: typeof t.icon === 'string' ? t.icon : 'wrench',
            ...(typeof t.group === 'string' ? { group: t.group } : {}),
            permission:
              t.permission === 'off' || t.permission === 'ask' || t.permission === 'auto'
                ? (t.permission as ToolPermission)
                : 'off',
          };
        })
    : [];

  return {
    name: obj.name,
    version: typeof obj.version === 'string' ? obj.version : '0.0.0',
    displayName: typeof obj.displayName === 'string' ? obj.displayName : obj.name,
    urlPatterns,
    excludePatterns,
    homepage,
    permission:
      obj.permission === 'off' || obj.permission === 'ask' || obj.permission === 'auto'
        ? (obj.permission as ToolPermission)
        : 'off',
    sourcePath: typeof obj.sourcePath === 'string' ? obj.sourcePath : undefined,
    adapterHash: typeof obj.adapterHash === 'string' ? obj.adapterHash : undefined,
    adapterFile: typeof obj.adapterFile === 'string' ? obj.adapterFile : undefined,
    resolvedSettings: parseResolvedSettings(obj.resolvedSettings),
    instanceMap: parseInstanceMap(obj.instanceMap),
    iconSvg: typeof obj.iconSvg === 'string' ? obj.iconSvg : undefined,
    iconInactiveSvg: typeof obj.iconInactiveSvg === 'string' ? obj.iconInactiveSvg : undefined,
    iconDarkSvg: typeof obj.iconDarkSvg === 'string' ? obj.iconDarkSvg : undefined,
    iconDarkInactiveSvg: typeof obj.iconDarkInactiveSvg === 'string' ? obj.iconDarkInactiveSvg : undefined,
    preScriptFile: typeof obj.preScriptFile === 'string' ? obj.preScriptFile : undefined,
    preScriptHash: typeof obj.preScriptHash === 'string' ? obj.preScriptHash : undefined,
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
        if (meta) return cleanupAdaptersInMatchingTabs(name, meta.urlPatterns, meta.excludePatterns);
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
  await syncPreScripts(metas);

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
        meta.excludePatterns,
        meta.resolvedSettings,
        meta.instanceMap,
      ),
    ),
  );
  for (const result of injectionResults) {
    if (result.status === 'rejected') {
      console.warn('[opentabs] Plugin injection failed during sync.full:', result.reason);
    }
  }

  // Populate the server state cache with the full state payload from sync.full
  // so the side panel can read it locally via bg:getFullState without a round-trip.
  // Build a map from plugin name to raw object for extracting config-specific
  // fields (source, sdkVersion, update) that the server now includes in sync.full.
  const rawPluginMap = new Map<string, Record<string, unknown>>();
  for (const raw of rawPlugins) {
    if (typeof raw === 'object' && raw !== null && typeof (raw as Record<string, unknown>).name === 'string') {
      rawPluginMap.set((raw as Record<string, unknown>).name as string, raw as Record<string, unknown>);
    }
  }

  const cachePlugins: ConfigStatePlugin[] = uniquePlugins.map(p => {
    const raw = rawPluginMap.get(p.name);
    return {
      name: p.name,
      displayName: p.displayName,
      version: p.version,
      permission: p.permission,
      tabState: 'closed' as const,
      urlPatterns: p.urlPatterns,
      ...(p.excludePatterns.length > 0 ? { excludePatterns: p.excludePatterns } : {}),
      ...(p.homepage ? { homepage: p.homepage } : {}),
      tools: p.tools,
      iconSvg: p.iconSvg,
      iconInactiveSvg: p.iconInactiveSvg,
      iconDarkSvg: p.iconDarkSvg,
      iconDarkInactiveSvg: p.iconDarkInactiveSvg,
      ...extractServerOnlyFields(raw),
      ...(p.instanceMap ? { instanceMap: p.instanceMap } : {}),
    };
  });

  // Extract server-owned fields from the enriched sync.full payload
  const rawFailedPlugins = Array.isArray(params.failedPlugins)
    ? (params.failedPlugins as ConfigStateFailedPlugin[])
    : undefined;
  const rawBrowserTools = Array.isArray(params.browserTools)
    ? (params.browserTools as ConfigStateBrowserTool[])
    : undefined;
  const rawServerVersion = typeof params.serverVersion === 'string' ? params.serverVersion : undefined;
  const rawServerSourcePath = typeof params.serverSourcePath === 'string' ? params.serverSourcePath : undefined;
  const rawExtensionHash = typeof params.extensionHash === 'string' ? params.extensionHash : undefined;
  const rawBrowserPermission = params.browserPermission;
  const browserPermission =
    rawBrowserPermission === 'off' || rawBrowserPermission === 'ask' || rawBrowserPermission === 'auto'
      ? rawBrowserPermission
      : undefined;
  const rawSkipPermissions = typeof params.skipPermissions === 'boolean' ? params.skipPermissions : undefined;
  const rawServerUpdate =
    params.serverUpdate &&
    typeof params.serverUpdate === 'object' &&
    typeof (params.serverUpdate as Record<string, unknown>).latestVersion === 'string'
      ? (params.serverUpdate as { latestVersion: string; updateCommand: string })
      : undefined;

  updateServerStateCache({
    plugins: cachePlugins,
    ...(rawFailedPlugins ? { failedPlugins: rawFailedPlugins } : {}),
    ...(rawBrowserTools ? { browserTools: rawBrowserTools } : {}),
    ...(browserPermission !== undefined ? { browserPermission } : {}),
    ...(rawServerVersion !== undefined ? { serverVersion: rawServerVersion } : {}),
    ...(rawServerSourcePath !== undefined ? { serverSourcePath: rawServerSourcePath } : {}),
    ...(rawSkipPermissions !== undefined ? { skipPermissions: rawSkipPermissions } : {}),
    ...(rawExtensionHash !== undefined ? { extensionHash: rawExtensionHash } : {}),
    serverUpdate: rawServerUpdate,
  });

  // Mark caches as initialized so the bg:getFullState wake detection
  // heuristic can distinguish "woke from suspension" (cachesInitialized=true)
  // from "connected but sync.full has not arrived yet" (cachesInitialized=false).
  setCachesInitialized(true);

  // Flush server state to session storage immediately so critical state
  // (including cachesInitialized) survives MV3 service worker suspension
  // during the sendTabSyncAll window.
  flushServerStateCacheToSession();

  // Notify the side panel immediately so it renders plugin cards from the
  // background cache (metaCache + serverStateCache) without waiting for
  // sendTabSyncAll to probe every plugin's isReady(). Tab states stream
  // in progressively via tab.stateChanged as each probe completes.
  forwardToSidePanel({
    type: 'sp:serverMessage',
    data: { jsonrpc: '2.0', method: 'plugins.changed' },
  });

  // Fire-and-forget: send tab.syncAll after all plugins are stored and
  // injected, then flush the populated tab state cache immediately so it
  // survives any service worker suspension during the probing window, then
  // start the readiness poll. Runs after the side panel notification so
  // the UI is not blocked by the O(N × round-trip) latency of probing.
  void sendTabSyncAll().then(() => {
    flushLastKnownStateToSession();
    startReadinessPoll();
  });
};

const handlePluginUpdate = async (params: Record<string, unknown>): Promise<void> => {
  const validated = validatePluginPayload(params);
  if (!validated) return;

  const previous = await getPluginMeta(validated.name);
  const meta = toPluginMeta(validated);

  await storePluginsBatch([meta]);
  await upsertPreScript(meta);

  const hashChanged =
    meta.preScriptFile !== undefined &&
    previous?.preScriptFile !== undefined &&
    previous.preScriptHash !== meta.preScriptHash;

  if (hashChanged) {
    // Pre-script content changed for an already-registered plugin. Chrome's
    // registered scripts only fire on FUTURE navigations, so tabs currently
    // open with the stale pre-script must be reloaded for the new pre-script
    // to take effect. First-time registrations (previous.preScriptFile was
    // undefined) are NOT auto-reloaded — forcing a reload on first install
    // would surprise the user mid-task; the new registration applies on the
    // user's next navigation.
    const matchingTabIds = await queryMatchingTabIds(meta.urlPatterns, meta.excludePatterns);
    for (const tabId of matchingTabIds) {
      try {
        await chrome.tabs.reload(tabId);
      } catch (e) {
        console.warn(`[opentabs] failed to reload tab ${tabId} after pre-script hash change:`, e);
      }
    }
  }

  // Force re-injection so the new IIFE overwrites the stale adapter code
  // already present in matching tabs. Without this, injectPluginIntoMatchingTabs
  // skips tabs where the adapter is already injected, leaving old code running.
  await injectPluginIntoMatchingTabs(
    meta.name,
    meta.urlPatterns,
    true,
    meta.adapterHash,
    meta.adapterFile,
    undefined,
    meta.excludePatterns,
    meta.resolvedSettings,
    meta.instanceMap,
  );

  // Report updated tab state to the server after re-injection so the MCP
  // server's tabMapping reflects the new adapter's readiness immediately.
  // updateLastKnownState goes through the plugin lock to avoid interleaving
  // with concurrent checkTabChanged / checkTabRemoved for the same plugin.
  const newState = await computePluginTabState(meta);
  await updateLastKnownState(meta.name, newState);
  sendTabStateNotification(meta.name, newState);

  // Update the server state cache with the updated plugin's data so the
  // side panel reads fresh tool permission states and metadata from bg:getFullState.
  // Merge the updated plugin into the existing cache's plugin list.
  const existingCache = getServerStateCache();
  const updatedPlugin: ConfigStatePlugin = {
    name: validated.name,
    displayName: validated.displayName,
    version: validated.version,
    permission: validated.permission,
    tabState: newState.state,
    urlPatterns: validated.urlPatterns,
    ...(validated.excludePatterns.length > 0 ? { excludePatterns: validated.excludePatterns } : {}),
    ...(validated.homepage ? { homepage: validated.homepage } : {}),
    tools: validated.tools,
    iconSvg: validated.iconSvg,
    iconInactiveSvg: validated.iconInactiveSvg,
    iconDarkSvg: validated.iconDarkSvg,
    iconDarkInactiveSvg: validated.iconDarkInactiveSvg,
    ...extractServerOnlyFields(params),
    ...(validated.instanceMap ? { instanceMap: validated.instanceMap } : {}),
  };
  const otherPlugins = existingCache.plugins.filter(p => p.name !== validated.name);
  updateServerStateCache({ plugins: [...otherPlugins, updatedPlugin] });

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
      error: {
        code: JSONRPC_INVALID_PARAMS,
        message: `Invalid plugin name format: "${pluginName}"`,
      },
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
      await cleanupAdaptersInMatchingTabs(pluginName, pluginMeta.urlPatterns, pluginMeta.excludePatterns);
    } catch (err: unknown) {
      console.warn(`[opentabs] Failed to clean up adapters for ${pluginName}:`, err);
    }
  }

  await removePlugin(pluginName);
  clearPluginTabState(pluginName);
  await removePreScript(pluginName);

  // Remove the uninstalled plugin from the cache so bg:getFullState returns
  // fresh state immediately, without waiting for the server's plugins.changed.
  const existingCache = getServerStateCache();
  updateServerStateCache({
    plugins: existingCache.plugins.filter(p => p.name !== pluginName),
  });

  // Notify the side panel so it removes the plugin card without waiting for
  // the server's own plugins.changed (which arrives after the success response).
  forwardToSidePanel({
    type: 'sp:serverMessage',
    data: { jsonrpc: '2.0', method: 'plugins.changed' },
  });

  sendToServer({
    jsonrpc: '2.0',
    result: { success: true },
    id,
  });
};

/**
 * Handle extension.getTabState: return the last-known tab state for all plugins.
 * The MCP server sends this request to get live tab state for the /health endpoint.
 * On service worker wake, the in-memory map is empty; load from session storage first.
 */
const handleExtensionGetTabState = async (_params: Record<string, unknown>, id: string | number): Promise<void> => {
  let states = getLastKnownStates();
  if (states.size === 0) {
    await loadLastKnownStateFromSession();
    states = getLastKnownStates();
  }
  const tabStates: Record<string, { state: string; tabs: unknown[] }> = {};
  for (const [pluginName, serialized] of states) {
    try {
      tabStates[pluginName] = JSON.parse(serialized) as {
        state: string;
        tabs: unknown[];
      };
    } catch {
      tabStates[pluginName] = { state: 'closed', tabs: [] };
    }
  }
  sendToServer({ jsonrpc: '2.0', result: { tabStates }, id });
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
  ['browser.listTabs', wrapAsync('browser.listTabs', (_params, id) => handleBrowserListTabs(id))],
  ['browser.openTab', wrapAsync('browser.openTab', handleBrowserOpenTab)],
  ['browser.closeTab', wrapAsync('browser.closeTab', handleBrowserCloseTab)],
  ['browser.navigateTab', wrapAsync('browser.navigateTab', handleBrowserNavigateTab)],
  ['browser.focusTab', wrapAsync('browser.focusTab', handleBrowserFocusTab)],
  ['browser.getTabInfo', wrapAsync('browser.getTabInfo', handleBrowserGetTabInfo)],
  ['browser.listTabGroups', wrapAsync('browser.listTabGroups', handleBrowserListTabGroups)],
  ['browser.createTabGroup', wrapAsync('browser.createTabGroup', handleBrowserCreateTabGroup)],
  ['browser.addTabsToGroup', wrapAsync('browser.addTabsToGroup', handleBrowserAddTabsToGroup)],
  ['browser.removeTabsFromGroup', wrapAsync('browser.removeTabsFromGroup', handleBrowserRemoveTabsFromGroup)],
  ['browser.updateTabGroup', wrapAsync('browser.updateTabGroup', handleBrowserUpdateTabGroup)],
  ['browser.listTabsInGroup', wrapAsync('browser.listTabsInGroup', handleBrowserListTabsInGroup)],
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
  ['browser.showNotification', wrapAsync('browser.showNotification', handleBrowserShowNotification)],
  ['browser.interceptRequests', wrapAsync('browser.interceptRequests', handleBrowserInterceptRequests)],
  ['browser.fulfillRequest', wrapAsync('browser.fulfillRequest', handleBrowserFulfillRequest)],
  ['browser.failRequest', wrapAsync('browser.failRequest', handleBrowserFailRequest)],
  ['browser.stopIntercepting', wrapAsync('browser.stopIntercepting', handleBrowserStopIntercepting)],
  ['browser.emulateDevice', wrapAsync('browser.emulateDevice', handleBrowserEmulateDevice)],
  ['browser.setGeolocation', wrapAsync('browser.setGeolocation', handleBrowserSetGeolocation)],
  ['browser.setMediaFeatures', wrapAsync('browser.setMediaFeatures', handleBrowserSetMediaFeatures)],
  [
    'browser.emulateVisionDeficiency',
    wrapAsync('browser.emulateVisionDeficiency', handleBrowserEmulateVisionDeficiency),
  ],
  ['browser.clearEmulation', wrapAsync('browser.clearEmulation', handleBrowserClearEmulation)],
  ['browser.getElementStyles', wrapAsync('browser.getElementStyles', handleBrowserGetElementStyles)],
  ['browser.forcePseudoState', wrapAsync('browser.forcePseudoState', handleBrowserForcePseudoState)],
  ['browser.getCssCoverage', wrapAsync('browser.getCssCoverage', handleBrowserGetCssCoverage)],
  ['browser.throttleNetwork', wrapAsync('browser.throttleNetwork', handleBrowserThrottleNetwork)],
  ['browser.clearNetworkThrottle', wrapAsync('browser.clearNetworkThrottle', handleBrowserClearNetworkThrottle)],
  ['browser.listWindows', wrapAsync('browser.listWindows', handleBrowserListWindows)],
  ['browser.createWindow', wrapAsync('browser.createWindow', handleBrowserCreateWindow)],
  ['browser.updateWindow', wrapAsync('browser.updateWindow', handleBrowserUpdateWindow)],
  ['browser.closeWindow', wrapAsync('browser.closeWindow', handleBrowserCloseWindow)],
  ['browser.downloadFile', wrapAsync('browser.downloadFile', handleBrowserDownloadFile)],
  ['browser.listDownloads', wrapAsync('browser.listDownloads', handleBrowserListDownloads)],
  ['browser.getDownloadStatus', wrapAsync('browser.getDownloadStatus', handleBrowserGetDownloadStatus)],
  ['browser.searchHistory', wrapAsync('browser.searchHistory', handleBrowserSearchHistory)],
  ['browser.getVisits', wrapAsync('browser.getVisits', handleBrowserGetVisits)],
  ['browser.searchBookmarks', wrapAsync('browser.searchBookmarks', handleBrowserSearchBookmarks)],
  ['browser.createBookmark', wrapAsync('browser.createBookmark', handleBrowserCreateBookmark)],
  ['browser.listBookmarkTree', wrapAsync('browser.listBookmarkTree', handleBrowserListBookmarkTree)],
  ['browser.getRecentlyClosed', wrapAsync('browser.getRecentlyClosed', handleBrowserGetRecentlyClosed)],
  ['browser.restoreSession', wrapAsync('browser.restoreSession', handleBrowserRestoreSession)],
  ['browser.clearSiteData', wrapAsync('browser.clearSiteData', handleBrowserClearSiteData)],
  ['extension.getState', wrapAsync('extension.getState', (_params, id) => handleExtensionGetState(id))],
  ['extension.getLogs', wrapAsync('extension.getLogs', handleExtensionGetLogs)],
  ['extension.getSidePanel', wrapAsync('extension.getSidePanel', (_params, id) => handleExtensionGetSidePanel(id))],
  ['extension.checkAdapter', wrapAsync('extension.checkAdapter', handleExtensionCheckAdapter)],
  [
    'extension.forceReconnect',
    wrapAsync('extension.forceReconnect', (_params, id) => handleExtensionForceReconnect(id)),
  ],
  ['extension.getTabState', wrapAsync('extension.getTabState', handleExtensionGetTabState)],
]);

/** Handle a JSON-RPC message received from the MCP server */
const handleServerMessage = (message: Record<string, unknown>): void => {
  const method = message.method as string | undefined;
  const id = message.id as string | number | undefined;
  const params = (message.params ?? {}) as Record<string, unknown>;

  // Consume responses to pending server requests (sent via sendServerRequest
  // in background mutation handlers). If consumed, the response resolves
  // the corresponding promise — no further processing needed.
  if (!method && consumeServerResponse(message)) {
    return;
  }

  // Update the server state cache from plugins.changed push notifications
  // BEFORE forwarding to the side panel so the side panel reads fresh data.
  if (method === 'plugins.changed') {
    const payload = params as Partial<ConfigStateResult>;
    const rawServerUpdate =
      params.serverUpdate &&
      typeof params.serverUpdate === 'object' &&
      typeof (params.serverUpdate as Record<string, unknown>).latestVersion === 'string'
        ? (params.serverUpdate as { latestVersion: string; updateCommand: string })
        : undefined;
    updateServerStateCache({
      ...(payload.plugins ? { plugins: payload.plugins } : {}),
      ...(payload.failedPlugins ? { failedPlugins: payload.failedPlugins } : {}),
      ...(payload.browserTools ? { browserTools: payload.browserTools } : {}),
      ...(payload.browserPermission !== undefined ? { browserPermission: payload.browserPermission } : {}),
      ...(payload.serverVersion !== undefined ? { serverVersion: payload.serverVersion } : {}),
      ...(payload.serverSourcePath !== undefined ? { serverSourcePath: payload.serverSourcePath } : {}),
      ...(payload.skipPermissions !== undefined ? { skipPermissions: payload.skipPermissions } : {}),
      ...(payload.extensionHash !== undefined ? { extensionHash: payload.extensionHash } : {}),
      serverUpdate: rawServerUpdate,
    });
  }

  // Forward notifications to the side panel only if the method is in the
  // allowed set. Responses (id without method) are NOT forwarded — the side
  // panel no longer sends JSON-RPC requests through the background relay.
  // Unclaimed responses (not consumed above) are discarded.
  if (method && SIDE_PANEL_METHODS.has(method)) {
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
          error: {
            code: JSONRPC_INTERNAL_ERROR,
            message: `Rate limited: ${method}`,
          },
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
      error: {
        code: JSONRPC_METHOD_NOT_FOUND,
        message: `Method not found: ${method}`,
      },
      id,
    });
  }
};

/** Method names registered in the dispatch table, exported for test verification */
const methodHandlerNames = Array.from(methodHandlers.keys());

export type { ServerOnlyPluginFields, ValidatedPluginPayload };
export { extractServerOnlyFields, handleServerMessage, methodHandlerNames, validatePluginPayload };
