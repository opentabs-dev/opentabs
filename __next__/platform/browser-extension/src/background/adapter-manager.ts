/**
 * Adapter Manager — Dynamic Adapter Injection from Storage
 *
 * Loads adapter IIFE code from chrome.storage.local (placed there by the
 * plugin-store) and injects it into matching tabs via
 * chrome.scripting.executeScript. No pre-built adapter files are needed
 * in the extension bundle — adapters are fully dynamic.
 *
 * Three responsibilities:
 *
 * 1. **Injection** — When a tab finishes loading and its URL matches an
 *    enabled plugin's URL patterns, the adapter code is injected into the
 *    page's MAIN world via chrome.scripting.executeScript({ func }).
 *    The injected function runs in an extension-privileged context that
 *    bypasses the page's CSP, so adapters work on CSP-strict pages like
 *    Slack and GitHub.
 *
 * 2. **Tracking** — Maintains a map of tabId → Set<pluginName> to avoid
 *    double-injecting the same adapter into the same tab. The map is
 *    cleared when a tab navigates to a new origin or is closed.
 *
 * 3. **Dispatch** — Forwards JSON-RPC requests to a specific adapter
 *    running in a tab's MAIN world and returns the JSON-RPC response,
 *    bridging the background ↔ page context gap. If the adapter isn't
 *    loaded in the target tab yet, it's injected on demand before dispatch.
 *
 * The extension manifest must declare broad host permissions (e.g.
 * `<all_urls>`) so that chrome.scripting.executeScript can target any
 * origin where a plugin's adapter needs to run. This is set once in the
 * base manifest and covers all dynamically installed plugins.
 */

import { findPluginsForUrl, getPlugin } from './plugin-store.js';
import type { JsonRpcRequest, JsonRpcResponse, StoredPluginData } from '@opentabs/core';

/**
 * Adapter names correspond to service types — each service type has one
 * MAIN world adapter.
 */
type AdapterName = string;

// ---------------------------------------------------------------------------
// Injection Tracking
//
// Tracks which adapters have been injected into which tabs to avoid
// double-injection. Keyed by tabId, valued by a Set of plugin names.
// Entries are pruned when tabs are closed or navigate to a new origin.
// ---------------------------------------------------------------------------

const injectedAdapters = new Map<number, Set<string>>();

/** Check whether a specific adapter has been injected into a tab. */
const isAdapterInjected = (tabId: number, pluginName: string): boolean => {
  const plugins = injectedAdapters.get(tabId);
  return plugins !== undefined && plugins.has(pluginName);
};

/** Mark an adapter as injected into a tab. */
const markAdapterInjected = (tabId: number, pluginName: string): void => {
  let plugins = injectedAdapters.get(tabId);
  if (!plugins) {
    plugins = new Set();
    injectedAdapters.set(tabId, plugins);
  }
  plugins.add(pluginName);
};

/** Clear all injection tracking for a tab (e.g. tab closed or navigated). */
const clearTab = (tabId: number): void => {
  injectedAdapters.delete(tabId);
};

/** Clear injection tracking for a specific plugin across all tabs. */
const clearPlugin = (pluginName: string): void => {
  for (const [tabId, plugins] of injectedAdapters) {
    plugins.delete(pluginName);
    if (plugins.size === 0) {
      injectedAdapters.delete(tabId);
    }
  }
};

/** Clear all injection tracking (e.g. on extension reload). */
const clearAllTracking = (): void => {
  injectedAdapters.clear();
};

// ---------------------------------------------------------------------------
// Adapter Injection
// ---------------------------------------------------------------------------

/**
 * The function injected into the page's MAIN world via
 * chrome.scripting.executeScript. It receives the adapter IIFE source code
 * as a string argument and executes it.
 *
 * This function runs in an extension-privileged injection context, which
 * means it bypasses the page's Content Security Policy. The adapter code
 * can freely set up globals on `window.__openTabs.adapters` and make
 * fetch calls with the user's session credentials.
 *
 * IMPORTANT: This function is serialized by Chrome and sent to the renderer.
 * It cannot capture any variables from the outer scope — everything it
 * needs must be passed via `args`.
 */
const executeAdapterCode = (adapterCode: string): void => {
  // Execute the adapter IIFE in the page's JS context.
  // The adapter code is a self-contained IIFE that calls registerAdapter()
  // internally, which sets up window.__openTabs.adapters[name].
  //
  // We use indirect eval ((0, eval)(...)) so the code runs in the global
  // scope rather than the function's local scope. This is important because
  // the adapter needs to set globals on `window`.
  //
  // CSP note: chrome.scripting.executeScript with `func` injects code via
  // Chrome's internal pipeline, not via the page's script evaluation. The
  // entire execution of this function (including the eval) is treated as
  // extension-injected code and is exempt from the page's CSP.
  (0, eval)(adapterCode);
};

/**
 * Inject a plugin's adapter into a specific tab.
 *
 * Reads the adapter code from chrome.storage.local (via plugin-store) and
 * executes it in the tab's MAIN world. The adapter registers itself on
 * window.__openTabs.adapters[name] and becomes available for dispatch.
 *
 * No-ops if the adapter is already injected in the target tab.
 *
 * @param tabId - The Chrome tab ID to inject into
 * @param pluginName - The plugin whose adapter to inject
 * @returns true if injection succeeded, false if it failed or was skipped
 */
const injectAdapter = async (tabId: number, pluginName: string): Promise<boolean> => {
  // Skip if already injected
  if (isAdapterInjected(tabId, pluginName)) {
    return true;
  }

  const plugin = await getPlugin(pluginName);
  if (!plugin || !plugin.enabled) {
    return false;
  }

  return injectAdapterCode(tabId, pluginName, plugin.adapterCode);
};

/**
 * Inject adapter code directly (when we already have the code string).
 * Used both by injectAdapter (reads from storage) and by the plugin
 * manager during install (has the code in memory).
 *
 * @param tabId - The Chrome tab ID to inject into
 * @param pluginName - The plugin name (for tracking)
 * @param adapterCode - The adapter IIFE source code
 * @returns true if injection succeeded
 */
const injectAdapterCode = async (tabId: number, pluginName: string, adapterCode: string): Promise<boolean> => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: executeAdapterCode,
      args: [adapterCode],
    });

    markAdapterInjected(tabId, pluginName);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Don't log errors for expected cases (restricted URLs, closed tabs)
    if (!msg.includes('Cannot access') && !msg.includes('No tab with id')) {
      console.error(`[OpenTabs] Failed to inject adapter "${pluginName}" into tab ${tabId}:`, msg);
    }

    return false;
  }
};

/**
 * Inject all matching plugin adapters into a tab based on its URL.
 *
 * Called when a tab finishes loading (chrome.tabs.onUpdated with
 * status === 'complete') or when the extension starts up and discovers
 * existing tabs.
 *
 * @param tabId - The Chrome tab ID
 * @param url - The tab's current URL
 * @returns Array of plugin names that were successfully injected
 */
const injectMatchingAdapters = async (tabId: number, url: string): Promise<string[]> => {
  const matchingPlugins = await findPluginsForUrl(url);
  const injected: string[] = [];

  for (const plugin of matchingPlugins) {
    if (!plugin.enabled) continue;

    const success = await injectAdapterCode(tabId, plugin.manifest.name, plugin.adapterCode);
    if (success) {
      injected.push(plugin.manifest.name);
    }
  }

  return injected;
};

/**
 * Inject a specific plugin's adapter into all currently open tabs that
 * match its URL patterns. Used when a new plugin is installed or an
 * existing plugin is re-enabled.
 *
 * @param plugin - The plugin data (must include manifest and adapterCode)
 * @returns Number of tabs successfully injected
 */
const injectAdapterIntoMatchingTabs = async (plugin: StoredPluginData): Promise<number> => {
  const allPatterns = Object.values(plugin.manifest.adapter.urlPatterns).flat();
  if (allPatterns.length === 0) return 0;

  let count = 0;

  try {
    const tabs = await chrome.tabs.query({ url: [...allPatterns] });

    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;

      const success = await injectAdapterCode(tab.id, plugin.manifest.name, plugin.adapterCode);
      if (success) count++;
    }
  } catch (err) {
    console.error(`[OpenTabs] Error querying tabs for plugin "${plugin.manifest.name}":`, err);
  }

  return count;
};

// ---------------------------------------------------------------------------
// Startup — Inject Adapters into Existing Tabs
// ---------------------------------------------------------------------------

/**
 * On extension startup, scan all open tabs and inject adapters for matching
 * enabled plugins. This ensures adapters are present even if the extension
 * was reloaded or the service worker was restarted.
 */
const injectAdaptersOnStartup = async (): Promise<void> => {
  clearAllTracking();

  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }

  let totalInjected = 0;

  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;

    // Skip chrome://, chrome-extension://, and other restricted URLs
    if (tab.url.startsWith('chrome') || tab.url.startsWith('about:') || tab.url.startsWith('edge:')) {
      continue;
    }

    const injected = await injectMatchingAdapters(tab.id, tab.url);
    totalInjected += injected.length;
  }

  if (totalInjected > 0) {
    console.log(`[OpenTabs] Injected adapters into ${totalInjected} tab(s) on startup`);
  }
};

// ---------------------------------------------------------------------------
// Tab Event Handlers
//
// These are meant to be wired into chrome.tabs.onUpdated and
// chrome.tabs.onRemoved by the background script's composition root.
// ---------------------------------------------------------------------------

/**
 * Handle a tab completing its load. Injects matching adapters.
 *
 * Wire this into chrome.tabs.onUpdated:
 *   chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
 *     if (changeInfo.status === 'complete' && tab.url) {
 *       handleTabLoadComplete(tabId, tab.url);
 *     }
 *   });
 */
const handleTabLoadComplete = async (tabId: number, url: string): Promise<void> => {
  // Clear previous injection state for this tab (page navigated)
  clearTab(tabId);

  // Skip restricted URLs
  if (url.startsWith('chrome') || url.startsWith('about:') || url.startsWith('edge:')) {
    return;
  }

  await injectMatchingAdapters(tabId, url);
};

/**
 * Handle a tab being closed. Cleans up injection tracking.
 *
 * Wire this into chrome.tabs.onRemoved:
 *   chrome.tabs.onRemoved.addListener(handleTabRemoved);
 */
const handleTabRemoved = (tabId: number): void => {
  clearTab(tabId);
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Forward a JSON-RPC request to an adapter running in the MAIN world and
 * return its JSON-RPC response. If the adapter hasn't been injected into
 * the target tab yet, attempts injection first.
 *
 * This is the single dispatch function — callers do not need to know what
 * methods the adapter supports or whether the adapter is already loaded.
 */
const dispatchToAdapter = async (
  tabId: number,
  adapter: AdapterName,
  request: JsonRpcRequest,
): Promise<JsonRpcResponse> => {
  // Ensure the adapter is injected before dispatching
  if (!isAdapterInjected(tabId, adapter)) {
    const injected = await injectAdapter(tabId, adapter);
    if (!injected) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: `Failed to inject adapter "${adapter}" into tab ${tabId}. The plugin may be disabled or not installed.`,
        },
      };
    }

    // Brief delay to allow the adapter's IIFE to execute and register on
    // window.__openTabs.adapters before we dispatch the request.
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (adapterName: string, jsonRpcRequest: JsonRpcRequest) => {
        const openTabs = (window as unknown as { __openTabs?: { adapters: Record<string, unknown> } }).__openTabs;
        if (!openTabs?.adapters) {
          return {
            jsonrpc: '2.0' as const,
            id: jsonRpcRequest.id,
            error: { code: -32603, message: 'OpenTabs adapters not loaded' },
          };
        }

        const instance = openTabs.adapters[adapterName] as
          | { handleRequest?: (req: JsonRpcRequest) => Promise<JsonRpcResponse> }
          | undefined;

        if (!instance?.handleRequest || typeof instance.handleRequest !== 'function') {
          return {
            jsonrpc: '2.0' as const,
            id: jsonRpcRequest.id,
            error: { code: -32603, message: `Adapter "${adapterName}" not loaded or missing handleRequest` },
          };
        }

        return instance.handleRequest(jsonRpcRequest);
      },
      args: [adapter, request],
    });

    if (chrome.runtime.lastError) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message: chrome.runtime.lastError.message ?? 'Unknown chrome error' },
      };
    }

    const result = results[0]?.result as JsonRpcResponse | undefined;
    return result ?? { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'No result from adapter' } };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32603, message: normalizeError(err) },
    };
  }
};

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

const normalizeError = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('Cannot access')) {
    return 'Cannot access this page. The tab may be on a restricted URL.';
  }
  if (msg.includes('No tab with id')) {
    return 'Tab not found. It may have been closed.';
  }

  return msg;
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type { AdapterName };
export {
  // Injection
  injectAdapter,
  injectAdapterCode,
  injectMatchingAdapters,
  injectAdapterIntoMatchingTabs,
  injectAdaptersOnStartup,
  // Tab lifecycle
  handleTabLoadComplete,
  handleTabRemoved,
  // Tracking
  isAdapterInjected,
  clearTab,
  clearPlugin,
  clearAllTracking,
  // Dispatch
  dispatchToAdapter,
};
