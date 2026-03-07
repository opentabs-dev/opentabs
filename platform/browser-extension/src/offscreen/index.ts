/**
 * Offscreen document — maintains persistent WebSocket to MCP server.
 *
 * Reconnection: exponential backoff (1s → 2s → 4s → 8s → … → 30s cap), resets on success.
 * Keepalive: sends ping every 15s; if no pong within 5s, connection is considered dead
 *            and force-closed to trigger reconnect. This detects zombie connections
 *            caused by server hot reload where the TCP socket stays alive
 *            but the server-side handler has been replaced.
 *
 * The WebSocket URL defaults to ws://localhost:9515/ws. The port is
 * configurable via chrome.storage.local ('serverPort' key). The background
 * script reads the port and relays the constructed URL here because offscreen
 * documents do not have access to chrome.storage APIs.
 */

import {
  buildWsUrl,
  DEFAULT_SERVER_PORT,
  WS_CLOSE_AUTH_FAILED,
  WS_CLOSE_PONG_TIMEOUT,
  WS_INFO_TIMEOUT_MS,
} from '../constants.js';
import type { DisconnectReason, InternalMessage, WsDataMessage, WsStateMessage } from '../extension-messages.js';
import { ALL_ALLOWED_METHODS } from '../known-methods.js';
import { installLogCollector } from '../log-collector.js';
import { isValidWsOrigin, wsToHttpBase } from './ws-utils.js';

/** Capture console output in a ring buffer for retrieval by debugging tools */
const offscreenLogCollector = installLogCollector('offscreen');

const DEFAULT_MCP_SERVER_URL = buildWsUrl(DEFAULT_SERVER_PORT);
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 3000;
const BACKOFF_MULTIPLIER = 2;

// Ping/pong keepalive — tuned for fast zombie detection during hot reload
const PING_INTERVAL_MS = 15_000; // Send ping every 15s
const PONG_TIMEOUT_MS = 5_000; // Expect pong within 5s or connection is dead

/**
 * Allowlist of expected JSON-RPC methods from the MCP server.
 * Messages with methods not in this set (and without an `id` response field)
 * are dropped to prevent forwarding unexpected payloads to the background script.
 *
 * Derived from ALL_ALLOWED_METHODS in known-methods.ts — the single source of
 * truth for all recognized WebSocket methods.
 */
const ALLOWED_METHODS = new Set<string>(ALL_ALLOWED_METHODS);

/**
 * Fetch /ws-info from the MCP server with automatic 401 retry.
 *
 * On 401, re-reads auth.json for the latest secret and retries once.
 * Returns `{ response }` on success (caller inspects .ok / .status),
 * `{ reason: 'auth_failed' }` on double-401, or
 * `{ reason: 'connection_refused' }` on network error.
 */
const fetchWsInfo = async (httpBase: string): Promise<{ response: Response } | { reason: DisconnectReason }> => {
  try {
    const headers: Record<string, string> = {};
    if (wsSecret) headers.Authorization = `Bearer ${wsSecret}`;
    let res = await fetch(`${httpBase}/ws-info`, {
      headers,
      signal: AbortSignal.timeout(WS_INFO_TIMEOUT_MS),
      cache: 'no-store',
    });
    // 401 means the secret is stale (e.g., server rotated secrets during hot
    // reload). Re-read auth.json for the latest secret and retry once.
    if (res.status === 401) {
      await bootstrapFromAuthFile();
      const retryHeaders: Record<string, string> = {};
      if (wsSecret) retryHeaders.Authorization = `Bearer ${wsSecret}`;
      res = await fetch(`${httpBase}/ws-info`, {
        headers: retryHeaders,
        signal: AbortSignal.timeout(WS_INFO_TIMEOUT_MS),
        cache: 'no-store',
      });
    }
    if (res.status === 401) return { reason: 'auth_failed' };
    return { response: res };
  } catch {
    return { reason: 'connection_refused' };
  }
};

/**
 * Close any active WebSocket connection, cancel any pending reconnect timer,
 * reset backoff, and initiate a fresh connection. Used by ws:setUrl,
 * port-changed, and bg:forceReconnect handlers.
 */
const disconnectAndReconnect = (closeReason: string): void => {
  backoffMs = INITIAL_BACKOFF_MS;
  lastDisconnectReason = undefined;
  if (ws) {
    try {
      ws.close(1000, closeReason);
    } catch {
      // Already closed
    }
  } else if (reconnectTimeoutId !== null) {
    // No active connection and backoff timer is pending — cancel it
    // and connect immediately with the new URL.
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
    void connect();
  } else {
    // No active connection and no pending reconnect (backoff exhausted
    // or no connection was ever established) — connect immediately.
    void connect();
  }
};

let mcpServerUrl = DEFAULT_MCP_SERVER_URL;
/** WebSocket auth token — sent via Sec-WebSocket-Protocol header, not URL query */
let wsSecret: string | null = null;
/** Suppresses repeated auth.json warnings until a successful read resets it */
let authJsonWarned = false;
let ws: WebSocket | null = null;
let backoffMs = INITIAL_BACKOFF_MS;
let pingIntervalId: ReturnType<typeof setInterval> | null = null;
let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
let pongWatchdogId: ReturnType<typeof setTimeout> | null = null;
let awaitingPong = false;
/** Guard flag to prevent double reconnect when pong watchdog triggers ws.close() */
let reconnectScheduledByWatchdog = false;
/** Guard flag to prevent concurrent connect() calls during the async refreshWsUrl phase */
let connecting = false;
/** Tracks why the last connection attempt failed, for side panel error state display */
let lastDisconnectReason: DisconnectReason | undefined;

const sendToBackground = (message: InternalMessage): void => {
  chrome.runtime.sendMessage(message).catch(() => {
    // Background may not be listening yet — ignore
  });
};

// --- Ping/Pong watchdog ---

const clearPingInterval = (): void => {
  if (pingIntervalId !== null) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
};

const clearPongWatchdog = (): void => {
  if (pongWatchdogId !== null) {
    clearTimeout(pongWatchdogId);
    pongWatchdogId = null;
  }
  awaitingPong = false;
};

/**
 * Called when a pong is received from the server.
 * Cancels the watchdog timer — connection is healthy.
 */
const onPongReceived = (): void => {
  clearPongWatchdog();
};

/**
 * Send a ping and arm the watchdog.
 * If the watchdog fires before a pong arrives, the connection is dead.
 */
const sendPing = (): void => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  // Don't stack pings — if we're still waiting for a pong from the last
  // ping, the watchdog is already running and will handle it.
  if (awaitingPong) return;

  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }));
  awaitingPong = true;

  // Arm the watchdog: if no pong within PONG_TIMEOUT_MS, kill the connection
  pongWatchdogId = setTimeout(() => {
    pongWatchdogId = null;

    if (!awaitingPong) return; // Pong arrived just in time

    console.warn(
      '[opentabs:offscreen] Pong timeout — connection is dead (likely server hot reload). Forcing reconnect.',
    );
    awaitingPong = false;

    // Force-close the zombie WebSocket. This triggers onclose → reconnect.
    // Set the guard flag so onclose doesn't schedule a second reconnect.
    if (ws) {
      reconnectScheduledByWatchdog = true;
      try {
        ws.close(WS_CLOSE_PONG_TIMEOUT, 'Pong timeout');
      } catch {
        // Already closed
      }
      ws = null;
      clearPingInterval();
      lastDisconnectReason = 'timeout';
      sendToBackground({
        type: 'ws:state',
        connected: false,
        disconnectReason: 'timeout',
      } satisfies WsStateMessage);
      scheduleReconnect();
    }
  }, PONG_TIMEOUT_MS);
};

const startPingInterval = (): void => {
  clearPingInterval();
  clearPongWatchdog();

  // Send the first ping after a short delay (gives the server time to send sync.full)
  // then continue on the regular interval.
  pingIntervalId = setInterval(sendPing, PING_INTERVAL_MS);
};

// --- Reconnect logic ---

const scheduleReconnect = (): void => {
  if (reconnectTimeoutId !== null) {
    clearTimeout(reconnectTimeoutId);
  }
  const delay = backoffMs;
  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    void connect();
  }, delay);
  backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
};

// --- Token refresh ---

/**
 * Re-fetch the WebSocket URL and auth secret from /ws-info.
 * Called before each connection attempt so reconnects after secret rotation
 * pick up the new token automatically. Falls back to the current URL on error.
 *
 * Returns the disconnect reason if the server explicitly rejected us (auth_failed)
 * or could not be reached (connection_refused). Returns undefined on success.
 */
const refreshWsUrl = async (): Promise<DisconnectReason | undefined> => {
  const httpBase = wsToHttpBase(mcpServerUrl);
  const result = await fetchWsInfo(httpBase);
  if ('reason' in result) return result.reason;

  const res = result.response;
  if (!res.ok) return 'connection_refused';

  const wsInfo = (await res.json()) as { wsUrl?: string };
  if (typeof wsInfo.wsUrl === 'string' && wsInfo.wsUrl !== '' && wsInfo.wsUrl !== mcpServerUrl) {
    if (isValidWsOrigin(wsInfo.wsUrl, httpBase)) {
      mcpServerUrl = wsInfo.wsUrl;
    }
  }
  return undefined;
};

// --- Connection ---

const connect = async (): Promise<void> => {
  if (connecting || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
    return;
  }

  connecting = true;
  try {
    await bootstrapFromAuthFile();
    const reason = await refreshWsUrl();
    if (reason) {
      lastDisconnectReason = reason;
      sendToBackground({ type: 'ws:state', connected: false, disconnectReason: reason } satisfies WsStateMessage);
      scheduleReconnect();
      return;
    }
    // Send auth token via Sec-WebSocket-Protocol header (not URL query)
    // to keep it out of server logs, browser history, and proxy logs.
    const protocols: string[] = ['opentabs'];
    if (wsSecret) protocols.push(wsSecret);
    ws = protocols.length > 1 ? new WebSocket(mcpServerUrl, protocols) : new WebSocket(mcpServerUrl);
  } catch {
    lastDisconnectReason = 'connection_refused';
    sendToBackground({
      type: 'ws:state',
      connected: false,
      disconnectReason: 'connection_refused',
    } satisfies WsStateMessage);
    scheduleReconnect();
    return;
  } finally {
    connecting = false;
  }

  ws.onopen = () => {
    backoffMs = INITIAL_BACKOFF_MS; // Reset backoff on success
    lastDisconnectReason = undefined;
    startPingInterval();
    sendToBackground({ type: 'ws:state', connected: true } satisfies WsStateMessage);
  };

  ws.onmessage = event => {
    if (typeof event.data !== 'string') {
      console.warn('[opentabs:offscreen] Received non-string WebSocket message, discarding');
      return;
    }
    const text = event.data;
    try {
      const parsed: unknown = JSON.parse(text);

      if (typeof parsed !== 'object' || parsed === null) return;
      const msg = parsed as Record<string, unknown>;

      // Handle pong — cancel the watchdog, connection is alive
      if (msg.method === 'pong') {
        onPongReceived();
        return;
      }

      const method = msg.method as string | undefined;
      const hasId = 'id' in msg;

      // Allow response messages (have id, no method) — these are replies to
      // requests the background script sent to the server (e.g., config.*).
      // Allow request/notification messages only if their method is in the allowlist.
      if (method && !ALLOWED_METHODS.has(method)) {
        console.warn(`[opentabs:offscreen] Dropping message with unknown method: ${method}`);
        return;
      }

      if (!method && !hasId) {
        console.warn('[opentabs:offscreen] Dropping message with neither method nor id');
        return;
      }

      sendToBackground({ type: 'ws:message', data: msg } satisfies WsDataMessage);
    } catch {
      console.warn('[opentabs:offscreen] Failed to parse WebSocket message as JSON');
    }
  };

  ws.onclose = event => {
    // The pong watchdog sets ws = null before calling ws.close(), so onclose
    // fires with ws already null. Skip duplicate cleanup and notification.
    if (!ws) {
      reconnectScheduledByWatchdog = false;
      return;
    }

    ws = null;
    clearPingInterval();
    clearPongWatchdog();

    // Determine disconnect reason from the WebSocket close code.
    // WS_CLOSE_AUTH_FAILED is sent by the MCP server when authentication fails
    // during the WebSocket handshake (invalid or missing Sec-WebSocket-Protocol token).
    if (event.code === WS_CLOSE_AUTH_FAILED) {
      lastDisconnectReason = 'auth_failed';
    } else if (!lastDisconnectReason) {
      lastDisconnectReason = 'connection_refused';
    }

    sendToBackground({
      type: 'ws:state',
      connected: false,
      disconnectReason: lastDisconnectReason,
    } satisfies WsStateMessage);

    // If the pong watchdog already scheduled a reconnect, skip to avoid double scheduling
    if (reconnectScheduledByWatchdog) {
      reconnectScheduledByWatchdog = false;
      return;
    }

    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror — reconnect handled there
  };
};

// --- Message routing from background script ---

chrome.runtime.onMessage.addListener((message: InternalMessage, sender, sendResponse) => {
  // Defense-in-depth: only accept messages from our own extension.
  // Prevents content scripts or other extensions from sending ws:send messages.
  if (sender.id !== chrome.runtime.id) return false;

  switch (message.type) {
    case 'ws:send': {
      if (ws?.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message.data));
        } catch (err) {
          const method =
            typeof message.data === 'object' && message.data !== null
              ? (message.data as Record<string, unknown>).method
              : undefined;
          console.error('[opentabs:offscreen] Failed to serialize message for WebSocket:', method, err);
        }
        sendResponse({ sent: true });
      } else {
        sendResponse({ sent: false, reason: 'not connected' });
      }
      break;
    }

    case 'ws:getState': {
      const isConnected = ws?.readyState === WebSocket.OPEN;
      sendResponse({
        connected: isConnected,
        disconnectReason: isConnected ? undefined : lastDisconnectReason,
      });
      break;
    }

    case 'ws:setUrl': {
      void (async () => {
        const rawUrl = message.url;

        // Validate URL format and protocol before using it
        try {
          const parsed = new URL(rawUrl);
          if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
            console.warn(`[opentabs:offscreen] Rejected ws:setUrl with invalid protocol: ${parsed.protocol}`);
            sendResponse({ ok: false, reason: 'Invalid WebSocket protocol' });
            return;
          }
        } catch {
          console.warn('[opentabs:offscreen] Rejected ws:setUrl: invalid URL format');
          sendResponse({ ok: false, reason: 'Invalid URL format' });
          return;
        }

        const httpBase = wsToHttpBase(rawUrl);
        let resolvedUrl = rawUrl;
        const result = await fetchWsInfo(httpBase);
        if ('response' in result && result.response.ok) {
          let wsInfo: { wsUrl?: string };
          try {
            wsInfo = (await result.response.json()) as { wsUrl?: string };
          } catch {
            console.warn('[opentabs:offscreen] Failed to parse /ws-info response as JSON');
            sendResponse({ ok: false, reason: 'Invalid /ws-info response' });
            return;
          }
          if (typeof wsInfo.wsUrl === 'string' && wsInfo.wsUrl !== '') {
            if (isValidWsOrigin(wsInfo.wsUrl, httpBase)) {
              resolvedUrl = wsInfo.wsUrl;
            } else {
              sendResponse({ ok: false, reason: 'WebSocket URL origin mismatch' });
              return;
            }
          } else if (typeof wsInfo.wsUrl === 'string') {
            console.warn('[opentabs:offscreen] /ws-info returned empty wsUrl, using fallback URL');
          }
        }
        if (!isValidWsOrigin(resolvedUrl, httpBase)) {
          sendResponse({ ok: false, reason: 'WebSocket URL origin mismatch' });
          return;
        }
        if (resolvedUrl !== mcpServerUrl) {
          console.log(`[opentabs:offscreen] MCP server URL changed to ${resolvedUrl}`);
          mcpServerUrl = resolvedUrl;
          disconnectAndReconnect('URL changed');
        }
        sendResponse({ ok: true });
      })();
      // Async sendResponse — tell Chrome to keep the message channel open
      return true;
    }

    case 'offscreen:getLogs': {
      sendResponse({
        entries: offscreenLogCollector.getEntries(message.options),
        stats: offscreenLogCollector.getStats(),
      });
      break;
    }

    case 'bg:forceReconnect': {
      disconnectAndReconnect('Force reconnect');
      sendResponse({ ok: true });
      break;
    }

    case 'port-changed': {
      const newUrl = buildWsUrl(message.port);
      if (newUrl !== mcpServerUrl) {
        console.log(`[opentabs:offscreen] Port changed to ${message.port}, reconnecting`);
        mcpServerUrl = newUrl;
        disconnectAndReconnect('Port changed');
      }
      sendResponse({ ok: true });
      break;
    }

    // Messages handled by the background script or side panel — not processed here.
    case 'offscreen:getUrl':
    case 'ws:state':
    case 'ws:message':
    case 'bg:getFullState':
    case 'bg:setToolPermission':
    case 'bg:setAllToolsPermission':
    case 'bg:setPluginPermission':
    case 'bg:searchPlugins':
    case 'bg:installPlugin':
    case 'bg:removePlugin':
    case 'bg:removeFailedPlugin':
    case 'bg:updatePlugin':
    case 'plugin:logs':
    case 'tool:progress':
    case 'sp:getState':
    case 'sp:connectionState':
    case 'sp:serverMessage':
    case 'sp:confirmationResponse':
      break;
  }

  return undefined;
});

/**
 * Bootstrap the shared secret from auth.json.
 *
 * The MCP server writes auth.json to the managed extension directory
 * (~/.opentabs/extension/auth.json) on startup. The offscreen document
 * reads it via chrome.runtime.getURL to obtain the secret, avoiding an
 * unauthenticated HTTP request to /ws-info. Port configuration is read
 * from chrome.storage.local (via the background script) separately.
 */
const bootstrapFromAuthFile = async (): Promise<void> => {
  try {
    const authUrl = `${chrome.runtime.getURL('auth.json')}?_t=${Date.now()}`;
    const res = await fetch(authUrl, { signal: AbortSignal.timeout(1_000), cache: 'no-store' });
    if (res.ok) {
      const auth = (await res.json()) as { secret?: string };
      if (typeof auth.secret === 'string' && auth.secret !== '') {
        wsSecret = auth.secret;
        authJsonWarned = false;
      } else if (!authJsonWarned) {
        authJsonWarned = true;
        console.warn('[opentabs:offscreen] auth.json missing or invalid secret field');
      }
    } else if (!authJsonWarned) {
      authJsonWarned = true;
      console.warn('[opentabs:offscreen] auth.json returned HTTP', res.status);
    }
  } catch (e) {
    if (!authJsonWarned) {
      authJsonWarned = true;
      console.warn('[opentabs:offscreen] Failed to read auth.json:', e);
    }
  }
};

// Bootstrap the secret from auth.json, then get the port-based URL from
// the background script (chrome.storage.local), and connect.
void (async () => {
  await bootstrapFromAuthFile();

  // Check if the user has configured a custom server URL in chrome.storage.local.
  // The background script reads it and relays here since offscreen docs cannot
  // access chrome.storage APIs directly.
  try {
    const response = await new Promise<{ url?: string } | undefined>(resolve => {
      chrome.runtime.sendMessage(
        { type: 'offscreen:getUrl' } satisfies InternalMessage,
        (resp: { url?: string } | undefined) => {
          if (chrome.runtime.lastError) {
            resolve(undefined);
            return;
          }
          resolve(resp);
        },
      );
    });
    if (response?.url && typeof response.url === 'string' && response.url !== mcpServerUrl) {
      mcpServerUrl = response.url;
    }
  } catch {
    // Background not ready — use URL from auth.json or default
  }

  console.log(`[opentabs:offscreen] Connecting to ${mcpServerUrl}`);
  void connect();
})();
