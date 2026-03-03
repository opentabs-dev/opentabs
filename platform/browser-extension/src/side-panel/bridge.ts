/**
 * Bridge for side panel ↔ background script communication.
 *
 * All state is fetched from the background script's local caches via
 * bg:getFullState. Mutations (tool toggles, plugin management) are relayed
 * to the MCP server via dedicated bg:* message handlers in the background
 * script. The side panel never communicates with the MCP server directly.
 */

import type {
  ConfigStateBrowserTool,
  ConfigStateFailedPlugin,
  ConfigStatePlugin,
  WireToolDef,
} from '@opentabs-dev/shared';
import type { DisconnectReason } from '../extension-messages.js';

/** Plugin state as displayed in the side panel. tools is optional to reflect that the server response may omit it. */
type PluginState = Omit<ConfigStatePlugin, 'tools'> & { tools?: WireToolDef[] };

/** Failed plugin state as displayed in the side panel */
type FailedPluginState = ConfigStateFailedPlugin;

/** Browser tool state as displayed in the side panel (matches bg:getFullState response) */
type BrowserToolState = ConfigStateBrowserTool;

/** npm registry search result for a plugin package */
interface PluginSearchResult {
  name: string;
  description: string;
  version: string;
  author: string;
  isOfficial: boolean;
}

/** Result returned after a successful plugin install or update */
interface PluginInstallResult {
  ok: true;
  plugin: {
    name: string;
    displayName: string;
    version: string;
    toolCount: number;
  };
}

/** Pending confirmation params included in bg:getFullState for late side panel hydration */
interface FullStateConfirmation {
  id: string;
  tool: string;
  domain: string | null;
  tabId?: number;
  paramsPreview: string;
  timeoutMs: number;
  receivedAt: number;
}

/** Full state returned by bg:getFullState */
interface FullStateResult {
  connected: boolean;
  disconnectReason?: DisconnectReason;
  plugins: PluginState[];
  failedPlugins: FailedPluginState[];
  browserTools: BrowserToolState[];
  serverVersion?: string;
  pendingConfirmations?: FullStateConfirmation[];
}

/** Returns true if a tool's displayName, name, or description matches the filter string */
const matchesTool = (tool: WireToolDef, filterLower: string): boolean =>
  tool.displayName.toLowerCase().includes(filterLower) ||
  tool.name.toLowerCase().includes(filterLower) ||
  tool.description.toLowerCase().includes(filterLower);

/** Returns true if a plugin's displayName, name, or any tool name matches the filter string.
 * Tool descriptions are excluded to avoid false positives (e.g., "slack" matching unrelated
 * plugins that mention Slack in a tool description). */
const matchesPlugin = (plugin: PluginState, filterLower: string): boolean =>
  plugin.displayName.toLowerCase().includes(filterLower) ||
  plugin.name.toLowerCase().includes(filterLower) ||
  (plugin.tools ?? []).some(
    tool => tool.displayName.toLowerCase().includes(filterLower) || tool.name.toLowerCase().includes(filterLower),
  );

/**
 * Extracts a normalized short name from an npm package name for deduplication.
 * "@opentabs-dev/opentabs-plugin-slack" → "slack"
 * "opentabs-plugin-datadog" → "datadog"
 * "slack" → "slack"
 */
const extractShortName = (name: string): string => (name.split('/').pop() ?? name).replace(/^opentabs-plugin-/, '');

/**
 * Send a message to the background script and return the response as a Promise.
 * Rejects with an Error if chrome.runtime.lastError is set or the response
 * contains an `error` field (the pattern used by bg:* mutation handlers).
 */
const sendBgMessage = <T>(message: Record<string, unknown>): Promise<T> =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? 'Unknown error'));
        return;
      }
      if (response && typeof response === 'object' && 'error' in response) {
        reject(new Error((response as { error: string }).error));
        return;
      }
      resolve(response as T);
    });
  });

/** Fetch full merged state from the background script's local caches */
const getFullState = (): Promise<FullStateResult> => sendBgMessage<FullStateResult>({ type: 'bg:getFullState' });

/** Toggle a single tool's enabled state */
const setToolEnabled = (plugin: string, tool: string, enabled: boolean): Promise<unknown> =>
  sendBgMessage({ type: 'bg:setToolEnabled', plugin, tool, enabled });

/** Toggle all tools for a plugin */
const setAllToolsEnabled = (plugin: string, enabled: boolean): Promise<unknown> =>
  sendBgMessage({ type: 'bg:setAllToolsEnabled', plugin, enabled });

/** Toggle a subset of tools for a plugin */
const setToolsEnabled = (plugin: string, tools: string[], enabled: boolean): Promise<unknown> =>
  sendBgMessage({ type: 'bg:setToolsEnabled', plugin, tools, enabled });

/** Toggle a browser tool's enabled state */
const setBrowserToolEnabled = (tool: string, enabled: boolean): Promise<unknown> =>
  sendBgMessage({ type: 'bg:setBrowserToolEnabled', tool, enabled });

/** Toggle all browser tools' enabled state in a single batch request */
const setAllBrowserToolsEnabled = (enabled: boolean): Promise<unknown> =>
  sendBgMessage({ type: 'bg:setAllBrowserToolsEnabled', enabled });

/** Search npm registry for plugins matching the given query */
const searchPlugins = (query: string): Promise<{ results: PluginSearchResult[] }> =>
  sendBgMessage<{ results: PluginSearchResult[] }>({ type: 'bg:searchPlugins', query });

/** Install a plugin by package name */
const installPlugin = (name: string): Promise<PluginInstallResult> =>
  sendBgMessage<PluginInstallResult>({ type: 'bg:installPlugin', name });

/** Remove an installed plugin by name */
const removePlugin = (name: string): Promise<{ ok: true }> =>
  sendBgMessage<{ ok: true }>({ type: 'bg:removePlugin', name });

/** Update an installed plugin to the latest registry version */
const updatePlugin = (name: string): Promise<PluginInstallResult> =>
  sendBgMessage<PluginInstallResult>({ type: 'bg:updatePlugin', name });

/** Send a confirmation response to the MCP server via the background script (fire-and-forget) */
const sendConfirmationResponse = (
  id: string,
  decision: 'allow_once' | 'allow_always' | 'deny',
  scope?: 'tool_domain' | 'tool_all' | 'domain_all',
): void => {
  chrome.runtime
    .sendMessage({
      type: 'sp:confirmationResponse' as const,
      data: { id, decision, ...(scope ? { scope } : {}) },
    })
    .catch((err: unknown) => {
      console.warn('[opentabs:side-panel] Failed to send confirmation response:', err);
    });
};

export type {
  BrowserToolState,
  FailedPluginState,
  FullStateResult,
  PluginInstallResult,
  PluginSearchResult,
  PluginState,
  WireToolDef,
};
export {
  extractShortName,
  getFullState,
  installPlugin,
  matchesPlugin,
  matchesTool,
  removePlugin,
  searchPlugins,
  sendConfirmationResponse,
  setAllBrowserToolsEnabled,
  setAllToolsEnabled,
  setBrowserToolEnabled,
  setToolEnabled,
  setToolsEnabled,
  updatePlugin,
};
