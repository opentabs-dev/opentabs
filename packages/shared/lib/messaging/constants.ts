// Message type constants for extension communication

/**
 * All message types used in the extension.
 * Messages use serviceId field to identify which service they relate to.
 */
export const MessageTypes = {
  // Unified tab messages (used by all services with serviceId field)
  TAB_READY: 'tab_ready',
  GET_TAB_STATUS: 'get_tab_status',
  FOCUS_TAB: 'focus_tab',

  // Status communication (popup/sidepanel)
  STATUS_UPDATE: 'status_update',
  GET_STATUS: 'get_status',

  // WebSocket/Offscreen
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

  // MCP Server actions
  OPEN_SERVER_FOLDER: 'open_server_folder',

  // Content script health check (for auto-refresh on extension reload)
  PING: 'ping',
  PONG: 'pong',

  // Side panel
  SIDE_PANEL_OPENED: 'side_panel_opened',
  SIDE_PANEL_CLOSED: 'side_panel_closed',
  CLOSE_SIDE_PANEL: 'close_side_panel',
} as const;

/**
 * Default configuration values.
 */
export const Defaults = {
  /** Default WebSocket port for MCP server */
  WS_PORT: 8765,
  /** Interval between reconnection attempts (base) */
  RECONNECT_BASE_INTERVAL_MS: 1000,
  /** Maximum interval between reconnection attempts */
  RECONNECT_MAX_INTERVAL_MS: 30000,
  /** Interval between WebSocket ping messages */
  PING_INTERVAL_MS: 20000,
  /** Interval for keepalive alarms (in minutes) */
  KEEPALIVE_INTERVAL_MINUTES: 0.33,
  /** Interval between session health checks */
  SESSION_HEALTH_CHECK_INTERVAL_MS: 15000,
} as const;
