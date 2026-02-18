/**
 * Offscreen document — maintains persistent WebSocket to MCP server.
 *
 * Reconnection: exponential backoff (1s → 2s → 4s → 8s → … → 30s cap), resets on success.
 * Keepalive: sends ping every 15s; if no pong within 5s, connection is considered dead
 *            and force-closed to trigger reconnect. This detects zombie connections
 *            caused by server hot reload (bun --hot) where the TCP socket stays alive
 *            but the server-side handler has been replaced.
 *
 * The WebSocket URL defaults to ws://localhost:9515/ws but can be overridden
 * by the background script sending a { type: 'ws:setUrl', url: '...' } message.
 * The background script reads from chrome.storage.local and relays it
 * here because offscreen documents do not have access to chrome.storage APIs.
 */

import type { InternalMessage, WsStateMessage, WsDataMessage } from '../types.js';

const DEFAULT_MCP_SERVER_URL = 'ws://localhost:9515/ws';
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const BACKOFF_MULTIPLIER = 2;

// Ping/pong keepalive — tuned for fast zombie detection during hot reload
const PING_INTERVAL_MS = 15_000; // Send ping every 15s
const PONG_TIMEOUT_MS = 5_000; // Expect pong within 5s or connection is dead

/**
 * Allowlist of expected JSON-RPC methods from the MCP server.
 * Messages with methods not in this set (and without an `id` response field)
 * are dropped to prevent forwarding unexpected payloads to the background script.
 */
const ALLOWED_METHODS = new Set([
  'pong',
  'sync.full',
  'plugin.update',
  'plugin.uninstall',
  'tool.dispatch',
  'tool.invocationStart',
  'tool.invocationEnd',
  'browser.listTabs',
  'browser.openTab',
  'browser.closeTab',
  'browser.navigateTab',
  'browser.focusTab',
  'browser.getTabInfo',
  'browser.screenshotTab',
  'browser.getTabContent',
  'browser.getPageHtml',
  'browser.getStorage',
  'browser.clickElement',
  'browser.typeText',
  'browser.selectOption',
  'browser.waitForElement',
  'browser.queryElements',
  'browser.getCookies',
  'browser.setCookie',
  'browser.deleteCookies',
  'browser.enableNetworkCapture',
  'browser.getNetworkRequests',
  'browser.disableNetworkCapture',
  'browser.getConsoleLogs',
  'browser.clearConsoleLogs',
  'browser.executeScript',
  'browser.listResources',
  'browser.getResourceContent',
  'extension.reload',
]);

/**
 * Validate that a WebSocket URL from /ws-info has the expected origin.
 * Rejects URLs with a different host than the source or non-WebSocket protocols.
 */
const isValidWsOrigin = (wsUrl: string, httpBase: string): boolean => {
  try {
    const parsed = new URL(wsUrl);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      console.warn(`[opentabs:offscreen] Rejected wsUrl with invalid protocol: ${parsed.protocol}`);
      return false;
    }
    const source = new URL(httpBase);
    if (parsed.host !== source.host) {
      console.warn(
        `[opentabs:offscreen] Rejected wsUrl with mismatched host: ${parsed.host} (expected ${source.host})`,
      );
      return false;
    }
    return true;
  } catch {
    console.warn('[opentabs:offscreen] Rejected wsUrl: failed to parse URL');
    return false;
  }
};

let mcpServerUrl = DEFAULT_MCP_SERVER_URL;
/** WebSocket auth token — sent via Sec-WebSocket-Protocol header, not URL query */
let wsSecret: string | null = null;
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
        ws.close(4000, 'Pong timeout');
      } catch {
        // Already closed
      }
      ws = null;
      clearPingInterval();
      sendToBackground({ type: 'ws:state', connected: false } satisfies WsStateMessage);
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
 */
const refreshWsUrl = async (): Promise<void> => {
  try {
    const httpBase = mcpServerUrl.replace(/^ws/, 'http').replace(/\/ws$/, '');
    const res = await fetch(`${httpBase}/ws-info`, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) {
      const wsInfo = (await res.json()) as { wsUrl?: string; wsSecret?: string };
      if (typeof wsInfo.wsUrl === 'string' && wsInfo.wsUrl !== '' && wsInfo.wsUrl !== mcpServerUrl) {
        if (isValidWsOrigin(wsInfo.wsUrl, httpBase)) {
          mcpServerUrl = wsInfo.wsUrl;
        }
      }
      if (typeof wsInfo.wsSecret === 'string' && wsInfo.wsSecret !== '') {
        wsSecret = wsInfo.wsSecret;
      }
    }
  } catch {
    // Server may be down — use existing URL as fallback
  }
};

// --- Connection ---

const connect = async (): Promise<void> => {
  if (connecting || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
    return;
  }

  connecting = true;
  try {
    await refreshWsUrl();
    // Send auth token via Sec-WebSocket-Protocol header (not URL query)
    // to keep it out of server logs, browser history, and proxy logs.
    ws = wsSecret ? new WebSocket(mcpServerUrl, ['opentabs', wsSecret]) : new WebSocket(mcpServerUrl);
  } catch {
    scheduleReconnect();
    return;
  } finally {
    connecting = false;
  }

  ws.onopen = () => {
    backoffMs = INITIAL_BACKOFF_MS; // Reset backoff on success
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
      // Ignore malformed messages
    }
  };

  ws.onclose = () => {
    // The pong watchdog sets ws = null before calling ws.close(), so onclose
    // fires with ws already null. Skip duplicate cleanup and notification.
    if (!ws) {
      reconnectScheduledByWatchdog = false;
      return;
    }

    ws = null;
    clearPingInterval();
    clearPongWatchdog();
    sendToBackground({ type: 'ws:state', connected: false } satisfies WsStateMessage);

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

chrome.runtime.onMessage.addListener((message: InternalMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'ws:send': {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message.data));
        sendResponse({ sent: true });
      } else {
        sendResponse({ sent: false, reason: 'not connected' });
      }
      break;
    }

    case 'ws:getState': {
      sendResponse({ connected: ws?.readyState === WebSocket.OPEN });
      break;
    }

    case 'ws:setUrl': {
      void (async () => {
        const rawUrl = message.url;
        const httpBase = rawUrl.replace(/^ws/, 'http').replace(/\/ws$/, '');
        let resolvedUrl = rawUrl;
        try {
          const res = await fetch(`${httpBase}/ws-info`, { signal: AbortSignal.timeout(3_000) });
          if (res.ok) {
            const wsInfo = (await res.json()) as { wsUrl?: string; wsSecret?: string };
            if (typeof wsInfo.wsUrl === 'string' && wsInfo.wsUrl !== '') {
              if (isValidWsOrigin(wsInfo.wsUrl, httpBase)) {
                resolvedUrl = wsInfo.wsUrl;
              } else {
                sendResponse({ ok: true });
                return;
              }
            } else if (typeof wsInfo.wsUrl === 'string') {
              console.warn('[opentabs:offscreen] /ws-info returned empty wsUrl, using fallback URL');
            }
            if (typeof wsInfo.wsSecret === 'string' && wsInfo.wsSecret !== '') {
              wsSecret = wsInfo.wsSecret;
            }
          }
        } catch {
          // Server may not be running yet — use raw URL as fallback
        }
        if (!isValidWsOrigin(resolvedUrl, httpBase)) {
          sendResponse({ ok: true });
          return;
        }
        if (resolvedUrl !== mcpServerUrl) {
          console.log(`[opentabs:offscreen] MCP server URL changed to ${resolvedUrl}`);
          mcpServerUrl = resolvedUrl;
          backoffMs = INITIAL_BACKOFF_MS;
          if (ws) {
            try {
              ws.close(1000, 'URL changed');
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
        }
        sendResponse({ ok: true });
      })();
      // Async sendResponse — tell Chrome to keep the message channel open
      return true;
    }

    // Messages handled by the background script or side panel — not processed here.
    case 'offscreen:getUrl':
    case 'ws:state':
    case 'ws:message':
    case 'bg:send':
    case 'bg:getConnectionState':
    case 'sp:connectionState':
    case 'sp:serverMessage':
      break;
  }

  return undefined;
});

// Request the MCP server URL from the background script on startup.
// The background reads from chrome.storage.local (unavailable here) and responds.
chrome.runtime.sendMessage(
  { type: 'offscreen:getUrl' } satisfies InternalMessage,
  (response: { url?: string } | undefined) => {
    if (chrome.runtime.lastError) {
      // Background not ready yet — use default URL
      console.log(`[opentabs:offscreen] Could not get URL from background, using default: ${mcpServerUrl}`);
      void connect();
      return;
    }
    if (response?.url && typeof response.url === 'string') {
      mcpServerUrl = response.url;
    }
    console.log(`[opentabs:offscreen] Connecting to ${mcpServerUrl}`);
    void connect();
  },
);
