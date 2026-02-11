const KEEPALIVE_ALARM = "opentabs-keepalive";
const KEEPALIVE_INTERVAL_MINUTES = 25 / 60; // 25 seconds in minutes
const STORAGE_KEY_PREFIX = "plugin:";

let wsConnected = false;

let creatingOffscreen: Promise<void> | null = null;

/** Stored plugin data in chrome.storage.local */
interface StoredPlugin {
  name: string;
  version: string;
  displayName?: string;
  urlPatterns: string[];
  trustTier: string;
  sourcePath?: string;
  iife: string;
  tools: Array<{
    name: string;
    description: string;
    enabled: boolean;
  }>;
}

/** Plugin data as received from sync.full / plugin.update */
interface PluginPayload {
  name: string;
  version: string;
  displayName?: string;
  urlPatterns: string[];
  trustTier: string;
  sourcePath?: string;
  iife: string;
  tools?: Array<{
    name: string;
    description: string;
    enabled: boolean;
  }>;
}

type TabState = "closed" | "unavailable" | "ready";

const storageKey = (pluginName: string): string =>
  `${STORAGE_KEY_PREFIX}${pluginName}`;

const ensureOffscreenDocument = async (): Promise<void> => {
  if (creatingOffscreen) return creatingOffscreen;

  creatingOffscreen = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (contexts.length > 0) return;

    try {
      await chrome.offscreen.createDocument({
        url: "offscreen/offscreen.html",
        reasons: [chrome.offscreen.Reason.WEB_RTC],
        justification: "Maintain persistent WebSocket connection to MCP server",
      });
    } catch {
      // Already exists — race between onInstalled/onStartup and top-level call
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

/** Send a JSON-RPC message to the MCP server via offscreen WebSocket */
const sendToServer = (data: unknown): void => {
  chrome.runtime.sendMessage({ type: "ws:send", data }).catch(() => {
    // Offscreen may not be ready yet
  });
};

// --- Plugin storage (from US-009) ---

const storePlugin = async (plugin: StoredPlugin): Promise<void> => {
  await chrome.storage.local.set({ [storageKey(plugin.name)]: plugin });
};

const removePlugin = async (pluginName: string): Promise<void> => {
  await chrome.storage.local.remove(storageKey(pluginName));
};

const getAllStoredPlugins = async (): Promise<StoredPlugin[]> => {
  const all = await chrome.storage.local.get(null);
  const plugins: StoredPlugin[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(STORAGE_KEY_PREFIX) && value && typeof value === "object") {
      plugins.push(value as StoredPlugin);
    }
  }
  return plugins;
};

const getStoredPlugin = async (pluginName: string): Promise<StoredPlugin | undefined> => {
  const data = await chrome.storage.local.get(storageKey(pluginName));
  return data[storageKey(pluginName)] as StoredPlugin | undefined;
};

// --- IIFE injection (from US-009) ---

const injectPluginIntoMatchingTabs = async (plugin: StoredPlugin): Promise<number[]> => {
  const injectedTabIds: number[] = [];

  for (const pattern of plugin.urlPatterns) {
    let tabs: chrome.tabs.Tab[];
    try {
      tabs = await chrome.tabs.query({ url: pattern });
    } catch {
      continue;
    }

    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      if (injectedTabIds.includes(tab.id)) continue;

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: (iifeCode: string) => {
            (0, eval)(iifeCode);
          },
          args: [plugin.iife],
        });
        injectedTabIds.push(tab.id);
      } catch {
        // Tab may not be injectable (e.g., chrome:// pages)
      }
    }
  }

  return injectedTabIds;
};

// --- Tab matching helpers ---

/**
 * Check if a URL matches any of the plugin's Chrome match patterns.
 */
const urlMatchesPatterns = (url: string, patterns: string[]): boolean => {
  for (const pattern of patterns) {
    if (matchPattern(url, pattern)) return true;
  }
  return false;
};

/**
 * Simple Chrome match pattern matcher.
 * Pattern format: <scheme>://<host>[:<port>]/<path>
 *
 * Chrome match patterns support an optional port in the host portion:
 *   *://localhost:9516/*   → matches http://localhost:9516/anything
 *   *://*.slack.com/*      → matches https://app.slack.com/anything
 *   http://example.com/*   → matches http://example.com/anything (default port)
 */
const matchPattern = (url: string, pattern: string): boolean => {
  const m = pattern.match(/^(\*|https?|ftp):\/\/(.+?)(\/.*)$/);
  if (!m) return false;

  const [, scheme, hostWithPort, path] = m;

  // Separate host and optional port from the pattern's host portion.
  // Examples: "localhost:9516" → host="localhost", port="9516"
  //           "*.slack.com"   → host="*.slack.com", port=""
  //           "*"             → host="*", port=""
  let patternHost: string;
  let patternPort: string;
  const colonIdx = hostWithPort.lastIndexOf(":");
  // Only split on colon if what follows looks like a port number (all digits)
  // and the host isn't just "*" — avoids misinterpreting IPv6 or *.host:port
  if (colonIdx > 0 && /^\d+$/.test(hostWithPort.slice(colonIdx + 1))) {
    patternHost = hostWithPort.slice(0, colonIdx);
    patternPort = hostWithPort.slice(colonIdx + 1);
  } else {
    patternHost = hostWithPort;
    patternPort = "";
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Scheme match
  if (scheme !== "*" && parsed.protocol !== `${scheme}:`) return false;
  if (scheme === "*" && !["http:", "https:"].includes(parsed.protocol)) return false;

  // Port match — if the pattern specifies a port, the URL must have that port.
  // URL.port is "" for default ports (80 for http, 443 for https).
  if (patternPort) {
    if (parsed.port !== patternPort) return false;
  }

  // Host match
  if (patternHost !== "*") {
    if (patternHost.startsWith("*.")) {
      const suffix = patternHost.slice(2);
      if (parsed.hostname !== suffix && !parsed.hostname.endsWith(`.${suffix}`)) return false;
    } else {
      if (parsed.hostname !== patternHost) return false;
    }
  }

  // Path match — convert glob to regex
  if (path !== "/*") {
    const pathRegex = new RegExp(
      "^" + path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
    );
    if (!pathRegex.test(parsed.pathname + parsed.search)) return false;
  }

  return true;
};

/**
 * Find the first tab matching a plugin's URL patterns.
 */
const findMatchingTab = async (plugin: StoredPlugin): Promise<chrome.tabs.Tab | null> => {
  for (const pattern of plugin.urlPatterns) {
    let tabs: chrome.tabs.Tab[];
    try {
      tabs = await chrome.tabs.query({ url: pattern });
    } catch {
      continue;
    }
    if (tabs.length > 0 && tabs[0].id !== undefined) {
      return tabs[0];
    }
  }
  return null;
};

// --- Console logging helper (US-021) ---

/**
 * Get the link for console.warn logging: npm URL for published plugins, filesystem path for local.
 */
const getPluginLink = (plugin: StoredPlugin): string => {
  if (plugin.trustTier === "local" && plugin.sourcePath) {
    return plugin.sourcePath;
  }
  // For official plugins under @opentabs scope
  if (plugin.trustTier === "official") {
    return `https://npmjs.com/package/@opentabs/plugin-${plugin.name}`;
  }
  // For community plugins
  return `https://npmjs.com/package/opentabs-plugin-${plugin.name}`;
};

/**
 * Inject a console.warn into the target tab before tool execution for transparency.
 */
const injectToolInvocationLog = async (
  tabId: number,
  pluginName: string,
  toolName: string,
  link: string
): Promise<void> => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (pName: string, tName: string, lnk: string) => {
        console.warn(`[OpenTabs] ${pName}.${tName} invoked — ${lnk}`);
      },
      args: [pluginName, toolName, link],
    });
  } catch {
    // Tab may not be injectable — logging is best-effort
  }
};

// --- Tool dispatch (US-010) ---

/**
 * Handle tool.dispatch request from MCP server.
 * Finds matching tab, checks adapter readiness, executes tool, returns result.
 */
const handleToolDispatch = async (
  params: Record<string, unknown>,
  id: string | number
): Promise<void> => {
  const pluginName = params.plugin as string;
  const toolName = params.tool as string;
  const input = (params.input ?? {}) as Record<string, unknown>;

  const plugin = await getStoredPlugin(pluginName);
  if (!plugin) {
    sendToServer({
      jsonrpc: "2.0",
      error: { code: -32603, message: `Plugin "${pluginName}" not found` },
      id,
    });
    return;
  }

  // Find a tab matching the plugin's URL patterns
  const tab = await findMatchingTab(plugin);
  if (!tab || tab.id === undefined) {
    sendToServer({
      jsonrpc: "2.0",
      error: { code: -32001, message: `No matching tab for plugin "${pluginName}" (state: closed)` },
      id,
    });
    return;
  }

  // Log tool invocation in target tab's console for transparency (US-021)
  const link = getPluginLink(plugin);
  await injectToolInvocationLog(tab.id, pluginName, toolName, link);

  // Check if adapter is ready, then execute the tool — all in one executeScript call
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async (pName: string, tName: string, tInput: Record<string, unknown>) => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, { isReady(): Promise<boolean>; tools: Array<{ name: string; handle(params: unknown): Promise<unknown> }> }> }
          | undefined;
        const adapter = ot?.adapters?.[pName];
        if (!adapter) {
          return { __error: true, code: -32002, message: `Adapter "${pName}" not injected or not ready` };
        }

        let ready: boolean;
        try {
          ready = await adapter.isReady();
        } catch {
          return { __error: true, code: -32002, message: `Adapter "${pName}" isReady() threw an error` };
        }

        if (!ready) {
          return { __error: true, code: -32002, message: `Plugin "${pName}" is not ready (state: unavailable)` };
        }

        const tool = adapter.tools.find((t: { name: string }) => t.name === tName);
        if (!tool) {
          return { __error: true, code: -32603, message: `Tool "${tName}" not found in adapter "${pName}"` };
        }

        try {
          const output = await tool.handle(tInput);
          return { __output: true, output };
        } catch (err: unknown) {
          const e = err as { message?: string; code?: string };
          return { __error: true, code: -32603, message: e.message ?? "Tool execution failed" };
        }
      },
      args: [pluginName, toolName, input],
    });

    const result = results?.[0]?.result as
      | { __error: true; code: number; message: string }
      | { __output: true; output: unknown }
      | undefined;

    if (!result) {
      sendToServer({
        jsonrpc: "2.0",
        error: { code: -32603, message: "No result from tool execution" },
        id,
      });
      return;
    }

    if ("__error" in result && result.__error) {
      sendToServer({
        jsonrpc: "2.0",
        error: { code: result.code, message: result.message },
        id,
      });
      return;
    }

    if ("__output" in result && result.__output) {
      sendToServer({
        jsonrpc: "2.0",
        result: { output: result.output },
        id,
      });
      return;
    }

    sendToServer({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Unexpected result format from tool execution" },
      id,
    });
  } catch (err) {
    sendToServer({
      jsonrpc: "2.0",
      error: { code: -32603, message: `Script execution failed: ${(err as Error).message}` },
      id,
    });
  }
};

// --- Tab state tracking (US-010) ---

/**
 * Compute the tab state for a single plugin by checking for matching tabs
 * and adapter readiness.
 */
const computePluginTabState = async (
  plugin: StoredPlugin
): Promise<{ state: TabState; tabId: number | null; url: string | null }> => {
  const tab = await findMatchingTab(plugin);
  if (!tab || tab.id === undefined) {
    return { state: "closed", tabId: null, url: null };
  }

  // Check if adapter is injected and ready
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: (pName: string) => {
        const ot = (globalThis as Record<string, unknown>).__openTabs as
          | { adapters?: Record<string, { isReady(): Promise<boolean> }> }
          | undefined;
        const adapter = ot?.adapters?.[pName];
        if (!adapter) return false;
        return adapter.isReady();
      },
      args: [plugin.name],
    });

    const ready = results?.[0]?.result;
    // ready could be a promise result (boolean) or false if adapter not found
    if (ready === true) {
      return { state: "ready", tabId: tab.id, url: tab.url ?? null };
    }
    return { state: "unavailable", tabId: tab.id, url: tab.url ?? null };
  } catch {
    // Script execution failed — tab exists but we can't check readiness
    return { state: "unavailable", tabId: tab.id, url: tab.url ?? null };
  }
};

/**
 * Scan all open tabs and send tab.syncAll to MCP server with current state
 * of all known plugins. Called on WebSocket connect/reconnect.
 */
const sendTabSyncAll = async (): Promise<void> => {
  const plugins = await getAllStoredPlugins();
  if (plugins.length === 0) return;

  const tabs: Record<string, { state: TabState; tabId: number | null; url: string | null }> = {};
  for (const plugin of plugins) {
    tabs[plugin.name] = await computePluginTabState(plugin);
  }

  sendToServer({
    jsonrpc: "2.0",
    method: "tab.syncAll",
    params: { tabs },
  });

  console.log(`[opentabs] tab.syncAll sent — ${Object.keys(tabs).length} plugin(s)`);
};

/**
 * Check if a tab change (URL update or removal) affects any plugin's tab state,
 * and send tab.stateChanged notifications for affected plugins.
 */
const checkTabStateChanges = async (
  changedTabId: number,
  changeInfo?: { url?: string; status?: string },
  removed?: boolean
): Promise<void> => {
  const plugins = await getAllStoredPlugins();
  if (plugins.length === 0) return;

  for (const plugin of plugins) {
    // Check if this tab could be relevant to this plugin
    let relevant = false;

    if (removed) {
      // If a tab was removed, check if any of the plugin's patterns might have matched it
      // We can't query the tab anymore, so re-compute state from remaining tabs
      relevant = true;
    } else if (changeInfo?.url) {
      // URL changed — check if the new URL matches this plugin
      relevant = urlMatchesPatterns(changeInfo.url, plugin.urlPatterns);
      // Also check if any existing tab for this plugin was the one that changed
      if (!relevant) {
        const tab = await findMatchingTab(plugin);
        if (tab?.id === changedTabId) {
          relevant = true;
        }
      }
    } else if (changeInfo?.status === "complete") {
      // Page finished loading — check if this is a matching tab (adapter might now be ready)
      const tab = await findMatchingTab(plugin);
      if (tab?.id === changedTabId) {
        relevant = true;
      }
    }

    if (!relevant) continue;

    const newState = await computePluginTabState(plugin);
    sendToServer({
      jsonrpc: "2.0",
      method: "tab.stateChanged",
      params: {
        plugin: plugin.name,
        state: newState.state,
        tabId: newState.tabId,
        url: newState.url,
      },
    });
  }
};

// Listen for tab URL changes and loading completion.
// Two responsibilities:
//   1. Inject plugin IIFEs into newly opened/navigated matching tabs.
//      Without this, tabs opened AFTER sync.full would never get the adapter.
//   2. Push tab.stateChanged notifications to the MCP server.
chrome.tabs.onUpdated.addListener(
  (tabId, changeInfo, tab) => {
    // When a matching tab finishes loading, inject any stored plugins into it.
    // This covers the common case: user opens Slack AFTER the extension is
    // already running. Previously injection only happened on sync.full/startup.
    if (changeInfo.status === "complete" && tab.url) {
      injectPluginsIntoTab(tabId, tab.url).catch(console.error);
    }

    if (changeInfo.url || changeInfo.status === "complete") {
      checkTabStateChanges(tabId, changeInfo).catch(console.error);
    }
  }
);

/**
 * Inject all stored plugins whose URL patterns match the given tab.
 * Called on chrome.tabs.onUpdated (status=complete) so that tabs opened
 * AFTER sync.full still get their adapter IIFEs.
 */
const injectPluginsIntoTab = async (tabId: number, tabUrl: string): Promise<void> => {
  const plugins = await getAllStoredPlugins();
  console.log(`[opentabs] injectPluginsIntoTab: tabId=${tabId}, url=${tabUrl}, storedPlugins=${plugins.length}`);

  if (plugins.length === 0) {
    console.log(`[opentabs] injectPluginsIntoTab: no stored plugins — nothing to inject`);
    return;
  }

  for (const plugin of plugins) {
    const matches = urlMatchesPatterns(tabUrl, plugin.urlPatterns);
    console.log(`[opentabs] injectPluginsIntoTab: plugin=${plugin.name}, patterns=${JSON.stringify(plugin.urlPatterns)}, matches=${matches}, iifeLength=${plugin.iife?.length ?? 0}`);

    if (matches) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: (iifeCode: string) => {
            (0, eval)(iifeCode);
          },
          args: [plugin.iife],
        });
        console.log(`[opentabs] injectPluginsIntoTab: ✅ injected ${plugin.name} into tab ${tabId}`);
      } catch (err) {
        console.warn(`[opentabs] injectPluginsIntoTab: ❌ failed to inject ${plugin.name} into tab ${tabId}:`, (err as Error).message);
      }
    }
  }
};

// Listen for tab removal
chrome.tabs.onRemoved.addListener(
  (tabId) => {
    checkTabStateChanges(tabId, undefined, true).catch(console.error);
  }
);

// --- sync.full handler (from US-009) ---

const handleSyncFull = async (params: Record<string, unknown>): Promise<void> => {
  const plugins = params.plugins as PluginPayload[] | undefined;
  if (!Array.isArray(plugins)) return;

  for (const p of plugins) {
    const stored: StoredPlugin = {
      name: p.name,
      version: p.version,
      displayName: p.displayName,
      urlPatterns: p.urlPatterns,
      trustTier: p.trustTier,
      sourcePath: p.sourcePath,
      iife: p.iife,
      tools: p.tools ?? [],
    };

    await storePlugin(stored);
    const tabIds = await injectPluginIntoMatchingTabs(stored);
    console.log(`[opentabs] sync.full: injected ${p.name} into ${tabIds.length} tab(s)`);
  }

  // Send tab.syncAll AFTER all plugins are stored. This fixes a race condition
  // where the ws:state handler called sendTabSyncAll() before sync.full had
  // finished storing plugins — resulting in an empty tab.syncAll that the MCP
  // server ignored. Now we guarantee plugins are in storage first.
  await sendTabSyncAll();
};

// --- plugin.update handler (from US-009) ---

const handlePluginUpdate = async (
  params: Record<string, unknown>,
  id: string | number
): Promise<void> => {
  const plugin = params as unknown as PluginPayload;
  if (!plugin.name || !plugin.iife) {
    sendToServer({
      jsonrpc: "2.0",
      error: { code: -32602, message: "Invalid plugin.update params" },
      id,
    });
    return;
  }

  const existingData = await chrome.storage.local.get(storageKey(plugin.name));
  const existing = existingData[storageKey(plugin.name)] as StoredPlugin | undefined;

  const stored: StoredPlugin = {
    name: plugin.name,
    version: plugin.version ?? existing?.version ?? "0.0.0",
    displayName: plugin.displayName ?? existing?.displayName,
    urlPatterns: plugin.urlPatterns ?? existing?.urlPatterns ?? [],
    trustTier: plugin.trustTier ?? existing?.trustTier ?? "local",
    sourcePath: plugin.sourcePath ?? existing?.sourcePath,
    iife: plugin.iife,
    tools: plugin.tools ?? existing?.tools ?? [],
  };

  await storePlugin(stored);
  const tabIds = await injectPluginIntoMatchingTabs(stored);
  console.log(`[opentabs] plugin.update: re-injected ${plugin.name} into ${tabIds.length} tab(s)`);

  sendToServer({
    jsonrpc: "2.0",
    result: { reinjectedTabs: tabIds },
    id,
  });
};

// --- plugin.uninstall handler (from US-009) ---

const handlePluginUninstall = async (
  params: Record<string, unknown>,
  id: string | number
): Promise<void> => {
  const pluginName = params.name as string | undefined;
  if (!pluginName) {
    sendToServer({
      jsonrpc: "2.0",
      error: { code: -32602, message: "Missing plugin name" },
      id,
    });
    return;
  }

  await removePlugin(pluginName);
  console.log(`[opentabs] plugin.uninstall: removed ${pluginName}`);

  sendToServer({
    jsonrpc: "2.0",
    result: { success: true },
    id,
  });
};

// --- Re-inject stored plugins on startup ---

const reinjectStoredPlugins = async (): Promise<void> => {
  const plugins = await getAllStoredPlugins();
  if (plugins.length === 0) return;

  console.log(`[opentabs] startup: re-injecting ${plugins.length} stored plugin(s)`);
  for (const plugin of plugins) {
    const tabIds = await injectPluginIntoMatchingTabs(plugin);
    if (tabIds.length > 0) {
      console.log(`[opentabs] startup: injected ${plugin.name} into ${tabIds.length} tab(s)`);
    }
  }
};

// --- Message routing ---

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; data?: Record<string, unknown>; connected?: boolean },
    _sender,
    sendResponse
  ) => {
    if (message.type === "ws:state") {
      const wasConnected = wsConnected;
      wsConnected = message.connected === true;
      console.log(`[opentabs] WebSocket ${wsConnected ? "connected" : "disconnected"}`);
      // Forward connection state to side panel
      forwardToSidePanel("sp:connectionState", { connected: wsConnected });
      // On reconnect, send tab.syncAll to inform server of current tab states
      if (wsConnected && !wasConnected) {
        sendTabSyncAll().catch(console.error);
      }
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "ws:message" && message.data) {
      handleServerMessage(message.data);
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "bg:send") {
      sendToServer(message.data);
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "bg:getConnectionState") {
      sendResponse({ connected: wsConnected });
      return true;
    }

    return false;
  }
);

/** Forward a message to the side panel (fire-and-forget) */
const forwardToSidePanel = (type: string, data: Record<string, unknown>): void => {
  chrome.runtime.sendMessage({ type, data }).catch(() => {
    // Side panel may not be open — this is fine
  });
};

/** Handle a JSON-RPC message received from the MCP server */
const handleServerMessage = (message: Record<string, unknown>): void => {
  const method = message.method as string | undefined;
  const id = message.id as string | number | undefined;
  const params = (message.params ?? {}) as Record<string, unknown>;

  // Forward all server messages to the side panel for processing
  forwardToSidePanel("sp:serverMessage", message);

  if (method === "extension.reload" && id !== undefined) {
    sendToServer({ jsonrpc: "2.0", result: { reloading: true }, id });
    setTimeout(() => {
      chrome.runtime.reload();
    }, 100);
    return;
  }

  if (method === "sync.full") {
    handleSyncFull(params).catch(console.error);
    return;
  }

  if (method === "plugin.update" && id !== undefined) {
    handlePluginUpdate(params, id).catch(console.error);
    return;
  }

  if (method === "plugin.uninstall" && id !== undefined) {
    handlePluginUninstall(params, id).catch(console.error);
    return;
  }

  if (method === "tool.dispatch" && id !== undefined) {
    handleToolDispatch(params, id).catch(console.error);
    return;
  }
};

// --- Extension lifecycle ---

chrome.alarms.onAlarm.addListener((_alarm) => {
  // Alarm fires to keep the service worker alive — no action needed
});

chrome.runtime.onInstalled.addListener(async () => {
  await ensureOffscreenDocument();
  await setupKeepaliveAlarm();
  await reinjectStoredPlugins();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureOffscreenDocument();
  await setupKeepaliveAlarm();
  await reinjectStoredPlugins();
});

// Also ensure offscreen document exists when service worker wakes up
ensureOffscreenDocument().catch(console.error);
setupKeepaliveAlarm().catch(console.error);
reinjectStoredPlugins().catch(console.error);
