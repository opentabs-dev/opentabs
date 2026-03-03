import type { PluginTabInfo, TabState, TrustTier, WireToolDef } from '@opentabs-dev/shared';

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
  entries: Array<{ level: string; message: string; data: unknown[]; ts: string }>;
}

/** Background → Side panel: forwarded JSON-RPC message from the MCP server */
export interface SpRelayMessage {
  type: 'sp:serverMessage';
  data: Record<string, unknown>;
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
    decision: 'allow_once' | 'allow_always' | 'deny';
    scope?: 'tool_domain' | 'tool_all' | 'domain_all';
  };
}

/** Side panel → Background: confirmation timed out without user response */
export interface SpConfirmationTimeoutMessage {
  type: 'sp:confirmationTimeout';
  id: string;
}

/** Side panel → Background: toggle a single tool's enabled state */
export interface BgSetToolEnabledMessage {
  type: 'bg:setToolEnabled';
  plugin: string;
  tool: string;
  enabled: boolean;
}

/** Side panel → Background: toggle all tools for a plugin */
export interface BgSetAllToolsEnabledMessage {
  type: 'bg:setAllToolsEnabled';
  plugin: string;
  enabled: boolean;
}

/** Side panel → Background: toggle a subset of tools for a plugin */
export interface BgSetToolsEnabledMessage {
  type: 'bg:setToolsEnabled';
  plugin: string;
  tools: string[];
  enabled: boolean;
}

/** Side panel → Background: toggle a browser tool's enabled state */
export interface BgSetBrowserToolEnabledMessage {
  type: 'bg:setBrowserToolEnabled';
  tool: string;
  enabled: boolean;
}

/** Side panel → Background: toggle all browser tools' enabled state */
export interface BgSetAllBrowserToolsEnabledMessage {
  type: 'bg:setAllBrowserToolsEnabled';
  enabled: boolean;
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

/** Side panel → Background: update a plugin to the latest registry version */
export interface BgUpdatePluginMessage {
  type: 'bg:updatePlugin';
  name: string;
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
  | BgSetToolEnabledMessage
  | BgSetAllToolsEnabledMessage
  | BgSetToolsEnabledMessage
  | BgSetBrowserToolEnabledMessage
  | BgSetAllBrowserToolsEnabledMessage
  | BgSearchPluginsMessage
  | BgInstallPluginMessage
  | BgRemovePluginMessage
  | BgUpdatePluginMessage
  | OffscreenGetLogsMessage
  | BgForceReconnectMessage
  | PluginLogsMessage
  | ToolProgressMessage
  | SpGetStateMessage
  | SpConnectionStateMessage
  | SpRelayMessage
  | SpConfirmationResponseMessage
  | SpConfirmationTimeoutMessage
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
  trustTier: TrustTier;
  sourcePath?: string;
  adapterHash?: string;
  adapterFile?: string;
  iconSvg?: string;
  iconInactiveSvg?: string;
  tools: WireToolDef[];
}
