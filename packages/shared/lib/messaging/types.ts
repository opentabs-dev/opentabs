/**
 * Type-safe message definitions for Chrome extension communication.
 *
 * Each message channel is a discriminated union on the `type` field, allowing
 * TypeScript to narrow `message.data`, `message.serviceId`, etc. without casts.
 */

import type { MessageTypes } from './constants.js';
import type { ConnectionStatus, ServiceId } from '../services/types.js';

// ============================================================================
// Messages received by the background script (chrome.runtime.onMessage)
// ============================================================================

/** Offscreen → Background: WebSocket connected */
interface OffscreenConnectedMessage {
  source: 'offscreen';
  type: typeof MessageTypes.CONNECTED;
}

/** Offscreen → Background: WebSocket disconnected */
interface OffscreenDisconnectedMessage {
  source: 'offscreen';
  type: typeof MessageTypes.DISCONNECTED;
}

/** Offscreen → Background: incoming WebSocket message */
interface OffscreenDataMessage {
  source: 'offscreen';
  type: typeof MessageTypes.MESSAGE;
  data: unknown;
}

/** Union of all messages originating from the offscreen document */
type OffscreenToBackgroundMessage = OffscreenConnectedMessage | OffscreenDisconnectedMessage | OffscreenDataMessage;

/** Content script → Background: tab is ready */
interface TabReadyMessage {
  type: typeof MessageTypes.TAB_READY;
  serviceId: ServiceId;
}

/** Popup/SidePanel → Background: request current status */
interface GetStatusMessage {
  type: typeof MessageTypes.GET_STATUS;
}

/** Popup/Options → Background: change WebSocket port */
interface SetPortMessage {
  type: typeof MessageTypes.SET_PORT;
  port: number;
}

/** SidePanel → Background: focus a service tab */
interface FocusTabMessage {
  type: typeof MessageTypes.FOCUS_TAB;
  serviceId: ServiceId;
}

/** SidePanel → Background: open MCP server folder */
interface OpenServerFolderMessage {
  type: typeof MessageTypes.OPEN_SERVER_FOLDER;
}

/** SidePanel → Background: side panel opened */
interface SidePanelOpenedMessage {
  type: typeof MessageTypes.SIDE_PANEL_OPENED;
  windowId: number;
}

/** SidePanel → Background: side panel closed */
interface SidePanelClosedMessage {
  type: typeof MessageTypes.SIDE_PANEL_CLOSED;
  windowId: number;
}

/**
 * All messages the background script can receive via chrome.runtime.onMessage.
 * Use this union in the background's message listener for type narrowing.
 */
type BackgroundMessage =
  | OffscreenToBackgroundMessage
  | TabReadyMessage
  | GetStatusMessage
  | SetPortMessage
  | FocusTabMessage
  | OpenServerFolderMessage
  | SidePanelOpenedMessage
  | SidePanelClosedMessage;

// ============================================================================
// Messages broadcast FROM the background script
// ============================================================================

/** Background → Popup/SidePanel: connection status update */
interface StatusUpdateMessage extends ConnectionStatus {
  type: typeof MessageTypes.STATUS_UPDATE;
}

/** Background → SidePanel: close the side panel */
interface CloseSidePanelMessage {
  type: typeof MessageTypes.CLOSE_SIDE_PANEL;
}

/**
 * All messages the background script sends via chrome.runtime.sendMessage.
 */
type BackgroundBroadcastMessage = StatusUpdateMessage | CloseSidePanelMessage;

// ============================================================================
// Messages received by the offscreen document
// ============================================================================

/** Background → Offscreen: connect WebSocket */
interface OffscreenConnectMessage {
  target: 'offscreen';
  type: typeof MessageTypes.CONNECT;
  url: string;
}

/** Background → Offscreen: disconnect WebSocket */
interface OffscreenDisconnectMessage {
  target: 'offscreen';
  type: typeof MessageTypes.DISCONNECT;
}

/** Background → Offscreen: send data via WebSocket */
interface OffscreenSendMessage {
  target: 'offscreen';
  type: typeof MessageTypes.SEND;
  data: unknown;
}

/** Background → Offscreen: check WebSocket status */
interface OffscreenStatusMessage {
  target: 'offscreen';
  type: typeof MessageTypes.STATUS;
}

/** Background → Offscreen: update WebSocket URL */
interface OffscreenUpdateUrlMessage {
  target: 'offscreen';
  type: typeof MessageTypes.UPDATE_URL;
  url: string;
}

/** Background → Offscreen: keepalive ping */
interface OffscreenKeepaliveMessage {
  target: 'offscreen';
  type: typeof MessageTypes.KEEPALIVE;
}

/**
 * All messages the offscreen document can receive.
 */
type OffscreenMessage =
  | OffscreenConnectMessage
  | OffscreenDisconnectMessage
  | OffscreenSendMessage
  | OffscreenStatusMessage
  | OffscreenUpdateUrlMessage
  | OffscreenKeepaliveMessage;

// ============================================================================
// Messages received by content scripts
// ============================================================================

/** Background → Content: health check ping */
interface PingMessage {
  type: typeof MessageTypes.PING;
}

/** Background → Content: get tab status */
interface GetTabStatusMessage {
  type: typeof MessageTypes.GET_TAB_STATUS;
}

/**
 * All messages content scripts can receive.
 */
type ContentScriptMessage = PingMessage | GetTabStatusMessage;

// ============================================================================
// Type guard
// ============================================================================

/**
 * Type guard to check if a message came from the offscreen document.
 */
const isOffscreenMessage = (message: unknown): message is OffscreenToBackgroundMessage =>
  typeof message === 'object' &&
  message !== null &&
  'source' in message &&
  (message as OffscreenToBackgroundMessage).source === 'offscreen';

// ============================================================================
// Exports
// ============================================================================

export type {
  BackgroundMessage,
  BackgroundBroadcastMessage,
  OffscreenToBackgroundMessage,
  OffscreenMessage,
  ContentScriptMessage,
  TabReadyMessage,
  GetStatusMessage,
  SetPortMessage,
  FocusTabMessage,
  OpenServerFolderMessage,
  SidePanelOpenedMessage,
  SidePanelClosedMessage,
  StatusUpdateMessage,
  CloseSidePanelMessage,
};

export { isOffscreenMessage };
