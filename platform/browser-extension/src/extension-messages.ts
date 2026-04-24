import type { PluginTabInfo, TabState, ToolPermission, WireToolDef } from '@opentabs-dev/shared';

// ---------------------------------------------------------------------------
// Internal Chrome extension message types — discriminated union
//
// All chrome.runtime.sendMessage calls between the background script,
// offscreen document, and side panel use these typed messages. Adding a
// new message type here gives exhaustiveness checking at every handler site.
// ---------------------------------------------------------------------------

/** Offscreen → Background: request the MCP server WebSocket URL */
export interface OffscreenGetUrlMessage {
  type: 'offscreen:getUrl';
}

/** Reason the WebSocket disconnected — enables distinct error states in the side panel */
export type DisconnectReason = 'connection_refused' | 'auth_failed' | 'timeout';

/** Background → Offscreen: WebSocket connection state changed */
export interface WsStateMessage {
  type: 'ws:state';
  connected: boolean;
  /** Present only when connected is false — indicates why the connection failed */
  disconnectReason?: DisconnectReason;
}

/** Background/Offscreen: relay a JSON-RPC message from the MCP server */
export interface WsDataMessage {
  type: 'ws:message';
  data: Record<string, unknown>;
}

/** Offscreen/Side panel → Background → Offscreen: send a JSON-RPC message to the MCP server */
export interface WsSendMessage {
  type: 'ws:send';
  data: unknown;
}

/** Background → Offscreen: query WebSocket connection state */
export interface WsGetStateMessage {
  type: 'ws:getState';
}

/** Background → Offscreen: change the MCP server WebSocket URL */
export interface WsSetUrlMessage {
  type: 'ws:setUrl';
  url: string;
}

/** Side panel → Background: request full merged state for initial render */
export interface BgGetFullStateMessage {
  type: 'bg:getFullState';
}

/** Background → Offscreen: request log entries from the offscreen LogCollector */
export interface OffscreenGetLogsMessage {
  type: 'offscreen:getLogs';
  options?: {
    level?: 'log' | 'warn' | 'error' | 'info';
    source?: 'background' | 'offscreen' | 'side-panel';
    since?: number;
    limit?: number;
  };
}

/** Background → Offscreen: force WebSocket disconnect and immediate reconnect */
export interface BgForceReconnectMessage {
  type: 'bg:forceReconnect';
}

/** Background → Side panel: request current React state and rendered HTML */
export interface SpGetStateMessage {
  type: 'sp:getState';
}

/** Background → Side panel: WebSocket connection state update */
export interface SpConnectionStateMessage {
  type: 'sp:connectionState';
  data: { connected: boolean; disconnectReason?: DisconnectReason };
}

/** Content script relay → Background: batched plugin log entries from adapter IIFE */
export interface PluginLogsMessage {
  type: 'plugin:logs';
  plugin: string;
  entries: Array<{
    level: string;
    message: string;
    data: unknown[];
    ts: string;
  }>;
}

/** Background → Side panel: forwarded JSON-RPC message from the MCP server */
export interface SpRelayMessage {
  type: 'sp:serverMessage';
  data: Record<string, unknown>;
}

/** Content script relay → Background: adapter signaled readiness state may have changed */
export interface PluginReadinessChangedMessage {
  type: 'plugin:readinessChanged';
  plugin: string;
}

/** Content script relay → Background: tool progress notification from adapter IIFE */
export interface ToolProgressMessage {
  type: 'tool:progress';
  dispatchId: string;
  progress: number;
  total: number;
  message?: string;
}

/** Side panel → Background: confirmation response from user */
export interface SpConfirmationResponseMessage {
  type: 'sp:confirmationResponse';
  data: {
    id: string;
    decision: 'allow' | 'deny';
    alwaysAllow?: boolean;
  };
}

/** Side panel → Background: set a single tool's permission */
export interface BgSetToolPermissionMessage {
  type: 'bg:setToolPermission';
  plugin: string;
  tool: string;
  permission: ToolPermission;
}

/** Side panel → Background: set all tools' permission for a plugin */
export interface BgSetAllToolsPermissionMessage {
  type: 'bg:setAllToolsPermission';
  plugin: string;
  permission: ToolPermission;
}

/** Side panel → Background: set a plugin's default permission */
export interface BgSetPluginPermissionMessage {
  type: 'bg:setPluginPermission';
  plugin: string;
  permission: ToolPermission;
  /** When provided, also sets the plugin's reviewedVersion (used by "Enable Anyway" in the side panel) */
  reviewedVersion?: string;
}

/** Side panel → Background: set skipPermissions runtime toggle */
export interface BgSetSkipPermissionsMessage {
  type: 'bg:setSkipPermissions';
  skipPermissions: boolean;
}

/** Side panel → Background: search npm registry for plugins */
export interface BgSearchPluginsMessage {
  type: 'bg:searchPlugins';
  query: string;
}

/** Side panel → Background: install a plugin by package name */
export interface BgInstallPluginMessage {
  type: 'bg:installPlugin';
  name: string;
}

/** Side panel → Background: remove an installed plugin */
export interface BgRemovePluginMessage {
  type: 'bg:removePlugin';
  name: string;
}

/** Side panel → Background: remove a failed plugin by its config specifier */
export interface BgRemoveFailedPluginMessage {
  type: 'bg:removeFailedPlugin';
  specifier: string;
}

/** Side panel → Background: update a plugin to the latest registry version */
export interface BgUpdatePluginMessage {
  type: 'bg:updatePlugin';
  name: string;
}

/** Side panel → Background: trigger server self-update (phoenix restart) */
export interface BgSelfUpdateServerMessage {
  type: 'bg:selfUpdateServer';
}

/** Side panel → Background: focus or open a tab for a plugin */
export interface BgOpenPluginTabMessage {
  type: 'bg:openPluginTab';
  pluginName: string;
}

/** Side panel → Background: save plugin settings (relayed to MCP server) */
export interface BgSetPluginSettingsMessage {
  type: 'bg:setPluginSettings';
  plugin: string;
  settings: Record<string, unknown>;
}

/** Side panel → Background: open a folder in the system file manager (relayed to MCP server) */
export interface BgOpenFolderMessage {
  type: 'bg:openFolder';
  path: string;
}

/** Side panel → Background → Offscreen: MCP server port changed */
export interface PortChangedMessage {
  type: 'port-changed';
  port: number;
}

/** All internal message types flowing through chrome.runtime.sendMessage */
export type InternalMessage =
  | OffscreenGetUrlMessage
  | WsStateMessage
  | WsDataMessage
  | WsSendMessage
  | WsGetStateMessage
  | WsSetUrlMessage
  | BgGetFullStateMessage
  | BgSetToolPermissionMessage
  | BgSetAllToolsPermissionMessage
  | BgSetPluginPermissionMessage
  | BgSetSkipPermissionsMessage
  | BgSearchPluginsMessage
  | BgInstallPluginMessage
  | BgRemovePluginMessage
  | BgRemoveFailedPluginMessage
  | BgUpdatePluginMessage
  | BgSelfUpdateServerMessage
  | BgOpenPluginTabMessage
  | BgSetPluginSettingsMessage
  | BgOpenFolderMessage
  | OffscreenGetLogsMessage
  | BgForceReconnectMessage
  | PluginLogsMessage
  | PluginReadinessChangedMessage
  | ToolProgressMessage
  | SpGetStateMessage
  | SpConnectionStateMessage
  | SpRelayMessage
  | SpConfirmationResponseMessage
  | PortChangedMessage;

/** Tab state info for a single plugin — shared shape used by tab.stateChanged payloads */
export interface PluginTabStateInfo {
  state: TabState;
  tabs: PluginTabInfo[];
}

/** Lightweight plugin metadata stored in the `plugins_meta` index (no IIFE content) */
export interface PluginMeta {
  name: string;
  version: string;
  displayName: string;
  urlPatterns: string[];
  excludePatterns?: string[];
  homepage?: string;
  permission: ToolPermission;
  sourcePath?: string;
  adapterHash?: string;
  adapterFile?: string;
  resolvedSettings?: Record<string, unknown>;
  /** Instance name → Chrome match pattern mapping for multi-instance url settings */
  instanceMap?: Record<string, string>;
  iconSvg?: string;
  iconInactiveSvg?: string;
  iconDarkSvg?: string;
  iconDarkInactiveSvg?: string;
  /** Relative path to the pre-script IIFE within the extension bundle (e.g. 'adapters/<name>-prescript-<hash8>.js'). */
  preScriptFile?: string;
  /** SHA-256 hash of the pre-script IIFE content. */
  preScriptHash?: string;
  tools: WireToolDef[];
}
