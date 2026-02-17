import {
  handleBrowserCloseTab,
  handleBrowserExecuteScript,
  handleBrowserListTabs,
  handleBrowserNavigateTab,
  handleBrowserOpenTab,
} from './browser-commands.js';
import { RELOAD_FLUSH_DELAY_MS, WS_CONNECTED_KEY } from './constants.js';
import { cleanupAdaptersInMatchingTabs, injectPluginIntoMatchingTabs } from './iife-injection.js';
import { forwardToSidePanel, sendToServer } from './messaging.js';
import { getAllPluginMeta, removePlugin, removePluginsBatch, storePluginsBatch } from './plugin-storage.js';
import { clearPluginTabState, computePluginTabState, sendTabSyncAll } from './tab-state.js';
import { handleToolDispatch } from './tool-dispatch.js';
import type { PluginMeta } from './types.js';
import type { TrustTier, WireToolDef } from '@opentabs-dev/shared';

type MessageHandler = (params: Record<string, unknown>, id?: string | number) => void;

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
]);

// ---------------------------------------------------------------------------
// Payload validation — defense-in-depth for data that arrives over WebSocket
// and flows into chrome.storage and chrome.scripting.executeScript (MAIN world).
// ---------------------------------------------------------------------------

/** Validated plugin payload after passing through validatePluginPayload */
interface ValidatedPluginPayload {
  name: string;
  version: string;
  displayName?: string;
  urlPatterns: string[];
  trustTier: TrustTier;
  sourcePath?: string;
  adapterHash?: string;
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
  if (/[/\\]|\.\./.test(obj.name) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(obj.name)) {
    console.warn(`[opentabs] Rejecting plugin payload: unsafe name "${obj.name}"`);
    return null;
  }

  const urlPatterns = Array.isArray(obj.urlPatterns)
    ? (obj.urlPatterns as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  const tools = Array.isArray(obj.tools)
    ? (obj.tools as unknown[]).filter(
        (t): t is WireToolDef =>
          typeof t === 'object' &&
          t !== null &&
          typeof (t as Record<string, unknown>).name === 'string' &&
          typeof (t as Record<string, unknown>).description === 'string' &&
          typeof (t as Record<string, unknown>).enabled === 'boolean',
      )
    : [];

  return {
    name: obj.name,
    version: typeof obj.version === 'string' ? obj.version : '0.0.0',
    displayName: typeof obj.displayName === 'string' ? obj.displayName : undefined,
    urlPatterns,
    trustTier:
      obj.trustTier === 'official' || obj.trustTier === 'community' || obj.trustTier === 'local'
        ? obj.trustTier
        : 'local',
    sourcePath: typeof obj.sourcePath === 'string' ? obj.sourcePath : undefined,
    adapterHash: typeof obj.adapterHash === 'string' ? obj.adapterHash : undefined,
    tools,
  };
};

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

/** Dispatch table mapping JSON-RPC methods to handlers */
const methodHandlers = new Map<string, MessageHandler>([
  [
    'extension.reload',
    (_params, id) => {
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
    },
  ],
  [
    'sync.full',
    params => {
      handleSyncFull(params).catch(console.error);
    },
  ],
  [
    'plugin.update',
    params => {
      handlePluginUpdate(params).catch(console.error);
    },
  ],
  [
    'plugin.uninstall',
    (params, id) => {
      if (id !== undefined) {
        handlePluginUninstall(params, id).catch(console.error);
      }
    },
  ],
  [
    'tool.dispatch',
    (params, id) => {
      if (id !== undefined) {
        handleToolDispatch(params, id).catch(console.error);
      }
    },
  ],
  [
    'browser.listTabs',
    (_params, id) => {
      if (id !== undefined) {
        handleBrowserListTabs(id).catch(console.error);
      }
    },
  ],
  [
    'browser.openTab',
    (params, id) => {
      if (id !== undefined) {
        handleBrowserOpenTab(params, id).catch(console.error);
      }
    },
  ],
  [
    'browser.closeTab',
    (params, id) => {
      if (id !== undefined) {
        handleBrowserCloseTab(params, id).catch(console.error);
      }
    },
  ],
  [
    'browser.navigateTab',
    (params, id) => {
      if (id !== undefined) {
        handleBrowserNavigateTab(params, id).catch(console.error);
      }
    },
  ],
  [
    'browser.executeScript',
    (params, id) => {
      if (id !== undefined) {
        handleBrowserExecuteScript(params, id).catch(console.error);
      }
    },
  ],
]);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

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
  const injectionResults = await Promise.allSettled(
    metas.map(meta => injectPluginIntoMatchingTabs(meta.name, meta.urlPatterns, false, meta.version, meta.adapterHash)),
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
  await injectPluginIntoMatchingTabs(meta.name, meta.urlPatterns, true, meta.version, meta.adapterHash);

  // Report updated tab state to the server after re-injection so the MCP
  // server's tabMapping reflects the new adapter's readiness immediately.
  const newState = await computePluginTabState(meta);
  sendToServer({
    jsonrpc: '2.0',
    method: 'tab.stateChanged',
    params: {
      plugin: meta.name,
      state: newState.state,
      tabId: newState.tabId,
      url: newState.url,
    },
  });

  forwardToSidePanel({
    type: 'sp:serverMessage',
    data: {
      jsonrpc: '2.0',
      method: 'tab.stateChanged',
      params: {
        plugin: meta.name,
        state: newState.state,
        tabId: newState.tabId,
        url: newState.url,
      },
    },
  });

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
      error: { code: -32602, message: 'Missing plugin name' },
      id,
    });
    return;
  }

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pluginName)) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32602, message: `Invalid plugin name format: "${pluginName}"` },
      id,
    });
    return;
  }

  // Clean up injected adapters from matching tabs before removing storage
  // (need URL patterns from meta to find the right tabs)
  const meta = await getAllPluginMeta();
  const pluginMeta = meta[pluginName];
  if (pluginMeta) {
    await cleanupAdaptersInMatchingTabs(pluginName, pluginMeta.urlPatterns);
  }

  await removePlugin(pluginName);
  clearPluginTabState(pluginName);
  sendToServer({
    jsonrpc: '2.0',
    result: { success: true },
    id,
  });
};

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

  if (!method) return;

  const handler = methodHandlers.get(method);
  if (handler) {
    handler(params, id);
    return;
  }

  // Unrecognized method with an id — send JSON-RPC -32601 'Method not found'
  if (id !== undefined) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32601, message: `Method not found: ${method}` },
      id,
    });
  }
};

export { handleServerMessage, validatePluginPayload };
export type { ValidatedPluginPayload };
