// =============================================================================
// Messaging Constants and Types
//
// Type-safe message definitions for Chrome extension internal communication
// between the background script, offscreen document, content scripts, and
// UI surfaces (side panel, options page).
//
// This module is service-agnostic — no plugin-specific message types here.
// Plugins communicate via JSON-RPC through the standard adapter dispatch path.
// =============================================================================

// -----------------------------------------------------------------------------
// Message Type Constants
// -----------------------------------------------------------------------------

/**
 * All message types used in the extension's internal communication.
 * Plugin-specific communication uses JSON-RPC methods, not these constants.
 */
export const MessageTypes = {
  // Tab lifecycle (used by all webapp service plugins via serviceId)
  TAB_READY: 'tab_ready',
  GET_TAB_STATUS: 'get_tab_status',
  FOCUS_TAB: 'focus_tab',

  // Status communication (side panel, options page)
  STATUS_UPDATE: 'status_update',
  GET_STATUS: 'get_status',

  // WebSocket / Offscreen document
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  MESSAGE: 'message',
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  SEND: 'send',
  STATUS: 'status',
  UPDATE_URL: 'update_url',
  KEEPALIVE: 'keepalive',
  SERVER_INFO: 'server_info',

  // Settings
  SET_PORT: 'set_port',

  // MCP server actions
  OPEN_SERVER_FOLDER: 'open_server_folder',

  // Content script health check (for auto-refresh on extension reload)
  PING: 'ping',
  PONG: 'pong',

  // Side panel lifecycle
  SIDE_PANEL_OPENED: 'side_panel_opened',
  SIDE_PANEL_CLOSED: 'side_panel_closed',
  CLOSE_SIDE_PANEL: 'close_side_panel',

  // Plugin system
  PLUGIN_ADAPTER_REGISTER: 'plugin_adapter_register',
  PLUGIN_ADAPTER_UNREGISTER: 'plugin_adapter_unregister',
} as const;

export type MessageType = (typeof MessageTypes)[keyof typeof MessageTypes];

// -----------------------------------------------------------------------------
// Default Configuration Values
// -----------------------------------------------------------------------------

/**
 * Platform-wide default configuration values.
 * Plugins should not override these — they configure the platform transport,
 * not individual services.
 */
export const Defaults = {
  /** Default WebSocket port for MCP server ↔ extension communication */
  WS_PORT: 8765,
  /** Base interval between reconnection attempts (milliseconds) */
  RECONNECT_BASE_INTERVAL_MS: 1000,
  /** Maximum interval between reconnection attempts (milliseconds) */
  RECONNECT_MAX_INTERVAL_MS: 30000,
  /** Interval between WebSocket ping messages (milliseconds) */
  PING_INTERVAL_MS: 20000,
  /** Interval for keepalive alarms (minutes, Chrome alarms API minimum ~0.33) */
  KEEPALIVE_INTERVAL_MINUTES: 0.33,
  /** Interval between session health checks (milliseconds) */
  SESSION_HEALTH_CHECK_INTERVAL_MS: 15000,
} as const;

// -----------------------------------------------------------------------------
// Messages: Offscreen → Background
// -----------------------------------------------------------------------------

/** Offscreen → Background: WebSocket connected */
export interface OffscreenConnectedMessage {
  readonly source: 'offscreen';
  readonly type: typeof MessageTypes.CONNECTED;
}

/** Offscreen → Background: WebSocket disconnected */
export interface OffscreenDisconnectedMessage {
  readonly source: 'offscreen';
  readonly type: typeof MessageTypes.DISCONNECTED;
}

/** Offscreen → Background: incoming WebSocket message */
export interface OffscreenDataMessage {
  readonly source: 'offscreen';
  readonly type: typeof MessageTypes.MESSAGE;
  readonly data: unknown;
}

/** All messages originating from the offscreen document */
export type OffscreenToBackgroundMessage =
  | OffscreenConnectedMessage
  | OffscreenDisconnectedMessage
  | OffscreenDataMessage;

// -----------------------------------------------------------------------------
// Messages: Content Script / UI → Background
// -----------------------------------------------------------------------------

/** Content script → Background: tab is ready for a specific service */
export interface TabReadyMessage {
  readonly type: typeof MessageTypes.TAB_READY;
  readonly serviceId: string;
}

/** UI → Background: request current connection status */
export interface GetStatusMessage {
  readonly type: typeof MessageTypes.GET_STATUS;
}

/** Options → Background: change the WebSocket port */
export interface SetPortMessage {
  readonly type: typeof MessageTypes.SET_PORT;
  readonly port: number;
}

/** Side panel → Background: focus the tab for a specific service */
export interface FocusTabMessage {
  readonly type: typeof MessageTypes.FOCUS_TAB;
  readonly serviceId: string;
}

/** Side panel → Background: open the MCP server folder on disk */
export interface OpenServerFolderMessage {
  readonly type: typeof MessageTypes.OPEN_SERVER_FOLDER;
}

/** Side panel → Background: side panel opened in a window */
export interface SidePanelOpenedMessage {
  readonly type: typeof MessageTypes.SIDE_PANEL_OPENED;
  readonly windowId: number;
}

/** Side panel → Background: side panel closed in a window */
export interface SidePanelClosedMessage {
  readonly type: typeof MessageTypes.SIDE_PANEL_CLOSED;
  readonly windowId: number;
}

/**
 * Union of all messages the background script can receive
 * via chrome.runtime.onMessage.
 */
export type BackgroundMessage =
  | OffscreenToBackgroundMessage
  | TabReadyMessage
  | GetStatusMessage
  | SetPortMessage
  | FocusTabMessage
  | OpenServerFolderMessage
  | SidePanelOpenedMessage
  | SidePanelClosedMessage;

// -----------------------------------------------------------------------------
// Messages: Background → UI
// -----------------------------------------------------------------------------

/** Background → Side panel / Options: connection status update */
export interface StatusUpdateMessage {
  readonly type: typeof MessageTypes.STATUS_UPDATE;
  readonly mcpConnected: boolean;
  readonly port?: number;
  readonly serverPath?: string;
  readonly services: Record<string, ServiceConnectionStatus>;
}

/** Background → Side panel: close the side panel */
export interface CloseSidePanelMessage {
  readonly type: typeof MessageTypes.CLOSE_SIDE_PANEL;
}

/** All messages the background script broadcasts via chrome.runtime.sendMessage */
export type BackgroundBroadcastMessage =
  | StatusUpdateMessage
  | CloseSidePanelMessage;

// -----------------------------------------------------------------------------
// Messages: Background → Offscreen
// -----------------------------------------------------------------------------

/** Background → Offscreen: connect WebSocket */
export interface OffscreenConnectMessage {
  readonly target: 'offscreen';
  readonly type: typeof MessageTypes.CONNECT;
  readonly url: string;
}

/** Background → Offscreen: disconnect WebSocket */
export interface OffscreenDisconnectMessage {
  readonly target: 'offscreen';
  readonly type: typeof MessageTypes.DISCONNECT;
}

/** Background → Offscreen: send data via WebSocket */
export interface OffscreenSendMessage {
  readonly target: 'offscreen';
  readonly type: typeof MessageTypes.SEND;
  readonly data: unknown;
}

/** Background → Offscreen: check WebSocket status */
export interface OffscreenStatusMessage {
  readonly target: 'offscreen';
  readonly type: typeof MessageTypes.STATUS;
}

/** Background → Offscreen: update WebSocket URL */
export interface OffscreenUpdateUrlMessage {
  readonly target: 'offscreen';
  readonly type: typeof MessageTypes.UPDATE_URL;
  readonly url: string;
}

/** Background → Offscreen: keepalive ping */
export interface OffscreenKeepaliveMessage {
  readonly target: 'offscreen';
  readonly type: typeof MessageTypes.KEEPALIVE;
}

/** All messages the offscreen document can receive */
export type OffscreenMessage =
  | OffscreenConnectMessage
  | OffscreenDisconnectMessage
  | OffscreenSendMessage
  | OffscreenStatusMessage
  | OffscreenUpdateUrlMessage
  | OffscreenKeepaliveMessage;

// -----------------------------------------------------------------------------
// Messages: Background → Content Script
// -----------------------------------------------------------------------------

/** Background → Content: health check ping */
export interface PingMessage {
  readonly type: typeof MessageTypes.PING;
}

/** Background → Content: get tab status */
export interface GetTabStatusMessage {
  readonly type: typeof MessageTypes.GET_TAB_STATUS;
}

/** All messages content scripts can receive */
export type ContentScriptMessage = PingMessage | GetTabStatusMessage;

// -----------------------------------------------------------------------------
// Connection Status (used in StatusUpdateMessage and internal state)
// -----------------------------------------------------------------------------

/** Connection status for a single service (plugin) instance. */
export interface ServiceConnectionStatus {
  readonly connected: boolean;
  readonly tabId?: number;
  readonly tabUrl?: string;
}

/**
 * Overall connection status for the platform.
 * Services are keyed by service ID (derived from plugin name + environment).
 */
export interface ConnectionStatus {
  /** Whether the MCP WebSocket relay is connected */
  mcpConnected: boolean;
  /** MCP server WebSocket port */
  port?: number;
  /** Path to MCP server executable */
  serverPath?: string;
  /** Per-service connection status keyed by service ID */
  services: Record<string, ServiceConnectionStatus>;
}

/** Tool permissions map — keys are tool IDs, values are enabled/disabled state */
export interface ToolPermissions {
  [toolId: string]: boolean;
}

// -----------------------------------------------------------------------------
// Type Guard
// -----------------------------------------------------------------------------

/** Check whether an unknown message came from the offscreen document. */
export const isOffscreenMessage = (
  message: unknown,
): message is OffscreenToBackgroundMessage =>
  typeof message === 'object' &&
  message !== null &&
  'source' in message &&
  (message as OffscreenToBackgroundMessage).source === 'offscreen';
