/** Chrome runtime message types used for communication between extension components */
const MessageTypes = {
  /** Request current extension status */
  GET_STATUS: 'GET_STATUS',
  /** Status update broadcast */
  STATUS_UPDATE: 'STATUS_UPDATE',
  /** Side panel opened in a window */
  SIDE_PANEL_OPENED: 'SIDE_PANEL_OPENED',
  /** Side panel closed in a window */
  SIDE_PANEL_CLOSED: 'SIDE_PANEL_CLOSED',
  /** Request to close the side panel */
  CLOSE_SIDE_PANEL: 'CLOSE_SIDE_PANEL',
  /** Forward a message to the MCP server via WebSocket */
  FORWARD_TO_SERVER: 'FORWARD_TO_SERVER',
  /** Message received from MCP server via WebSocket */
  FROM_SERVER: 'FROM_SERVER',
  /** WebSocket connection state change */
  WS_STATE_CHANGE: 'WS_STATE_CHANGE',
  /** Request to reload the extension */
  RELOAD_EXTENSION: 'RELOAD_EXTENSION',
  /** Plugin install payload received from server */
  PLUGIN_INSTALL: 'PLUGIN_INSTALL',
  /** Plugin uninstall request from server */
  PLUGIN_UNINSTALL: 'PLUGIN_UNINSTALL',
  /** Get plugin state (for side panel) */
  GET_PLUGIN_STATE: 'GET_PLUGIN_STATE',
  /** Set tool enabled/disabled (from side panel) */
  SET_TOOL_ENABLED: 'SET_TOOL_ENABLED',
  /** Tool invocation started */
  TOOL_INVOCATION_START: 'TOOL_INVOCATION_START',
  /** Tool invocation ended */
  TOOL_INVOCATION_END: 'TOOL_INVOCATION_END',
  /** Tab state update for a service */
  TAB_STATE_UPDATE: 'TAB_STATE_UPDATE',
} as const;

type MessageType = (typeof MessageTypes)[keyof typeof MessageTypes];

interface RuntimeMessage<T extends MessageType = MessageType, P = unknown> {
  readonly type: T;
  readonly payload?: P;
}

export { MessageTypes, type MessageType, type RuntimeMessage };
