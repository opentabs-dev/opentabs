export const KEEPALIVE_ALARM = 'opentabs-keepalive';
export const KEEPALIVE_INTERVAL_MINUTES = 0.5; // Chrome 120+ supports 30-second alarm periods; older versions require 1 minute minimum
export const PLUGINS_META_KEY = 'plugins_meta';
export const WS_CONNECTED_KEY = 'wsConnected';
/**
 * Default timeout for chrome.scripting.executeScript calls (ms).
 *
 * Set to 25 seconds — 5 seconds less than the MCP server's DISPATCH_TIMEOUT_MS
 * (30 seconds in platform/mcp-server/src/state.ts). This guarantees the extension
 * sends a response (success or timeout error) before the server gives up and
 * discards the pending dispatch, preventing orphaned script executions whose
 * results are silently dropped.
 *
 * For tools that report progress, this timeout is reset on each progress event
 * (see tool-dispatch.ts). The absolute upper bound is MAX_SCRIPT_TIMEOUT_MS.
 */
export const SCRIPT_TIMEOUT_MS = 25_000;
/**
 * Absolute maximum timeout for progress-reporting tools (ms).
 *
 * Matches MAX_DISPATCH_TIMEOUT_MS on the MCP server (5 minutes) minus a 5-second
 * safety margin, ensuring the extension always responds before the server gives up.
 */
export const MAX_SCRIPT_TIMEOUT_MS = 295_000;
/**
 * Timeout for isReady() probes during tab state computation (ms).
 *
 * Caps how long computePluginTabState waits for an adapter's isReady()
 * response. If the probe doesn't return within this window, the tab is
 * reported as "unavailable" rather than blocking state computation.
 */
export const IS_READY_TIMEOUT_MS = 5_000;
/** Delay before chrome.runtime.reload() to allow the WebSocket response to flush */
export const RELOAD_FLUSH_DELAY_MS = 100;
/** Delay (ms) before retrying adapter injection after a hash verification failure */
export const INJECTION_RETRY_DELAY_MS = 200;
/** Delay (ms) for a tab to render after focus before capturing a screenshot */
export const SCREENSHOT_RENDER_DELAY_MS = 100;
/** Delay (ms) to let the WebSocket response flush before forcing a reconnect */
export const WS_FLUSH_DELAY_MS = 50;
/** chrome.storage.local key for the configured MCP server port */
export const SERVER_PORT_KEY = 'serverPort';
/** Default MCP server port when no custom port is configured */
export const DEFAULT_SERVER_PORT = 9515;
/** Maximum character length for text preview truncation in DOM element queries */
export const TEXT_PREVIEW_MAX_LENGTH = 200;
/** Default timeout (ms) for browser_wait_for_element when no timeout param is provided */
export const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
/** Polling interval (ms) for browser_wait_for_element's DOM check loop */
export const POLL_INTERVAL_MS = 100;
/** Default element limit for browser_query_elements when no limit param is provided */
export const DEFAULT_QUERY_LIMIT = 100;
/** Maximum serialized JSON size (bytes) for tool dispatch input payloads */
export const MAX_INPUT_SIZE = 10 * 1024 * 1024;
/** Timeout (ms) for side panel state request via chrome.runtime.sendMessage */
export const SIDE_PANEL_TIMEOUT_MS = 3_000;
/** Chrome DevTools Protocol version used for debugger.attach calls */
export const CDP_VERSION = '1.3';
/** WebSocket close code sent when the pong watchdog detects a zombie connection */
export const WS_CLOSE_PONG_TIMEOUT = 4000;
/** WebSocket close code sent by the MCP server when authentication fails */
export const WS_CLOSE_AUTH_FAILED = 4001;
/** Timeout (ms) for /ws-info HTTP fetch requests in the offscreen document */
export const WS_INFO_TIMEOUT_MS = 3_000;
/** Maximum wait time (ms) for async script results in browser_execute_script */
export const EXEC_MAX_ASYNC_WAIT_MS = 10_000;
/** Polling interval (ms) for checking async script results in browser_execute_script */
export const EXEC_POLL_INTERVAL_MS = 50;
/** Maximum JSON string length before truncation in browser_execute_script results */
export const EXEC_RESULT_TRUNCATION_LIMIT = 50_000;
/** Default entry limit for browser_get_logs when no limit param is provided */
export const DEFAULT_LOG_LIMIT = 100;
/** Matches lowercase alphanumeric plugin names with optional hyphen separators (e.g., "slack", "e2e-test") */
export const VALID_PLUGIN_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Validate a plugin name against the expected format */
export const isValidPluginName = (name: string): boolean => VALID_PLUGIN_NAME.test(name);
