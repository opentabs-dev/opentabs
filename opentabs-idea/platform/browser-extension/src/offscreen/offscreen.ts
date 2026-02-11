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
 * by writing { mcpServerUrl: "ws://localhost:<port>/ws" } to chrome.storage.local.
 * This enables parallel E2E tests where each test worker runs its own MCP server
 * on a unique port.
 */

const DEFAULT_MCP_SERVER_URL = "ws://localhost:9515/ws";
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const BACKOFF_MULTIPLIER = 2;

// Ping/pong keepalive — tuned for fast zombie detection during hot reload
const PING_INTERVAL_MS = 15_000; // Send ping every 15s
const PONG_TIMEOUT_MS = 5_000; // Expect pong within 5s or connection is dead

let mcpServerUrl = DEFAULT_MCP_SERVER_URL;
let ws: WebSocket | null = null;
let backoffMs = INITIAL_BACKOFF_MS;
let pingIntervalId: ReturnType<typeof setInterval> | null = null;
let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
let pongWatchdogId: ReturnType<typeof setTimeout> | null = null;
let awaitingPong = false;

/**
 * Read the MCP server URL from chrome.storage.local.
 * Falls back to DEFAULT_MCP_SERVER_URL if not set.
 */
const loadMcpServerUrl = async (): Promise<string> => {
  try {
    const data = await chrome.storage.local.get("mcpServerUrl");
    if (data.mcpServerUrl && typeof data.mcpServerUrl === "string") {
      return data.mcpServerUrl;
    }
  } catch {
    // Storage not available — use default
  }
  return DEFAULT_MCP_SERVER_URL;
};

const sendToBackground = (message: unknown): void => {
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

  ws.send(JSON.stringify({ jsonrpc: "2.0", method: "ping" }));
  awaitingPong = true;

  // Arm the watchdog: if no pong within PONG_TIMEOUT_MS, kill the connection
  pongWatchdogId = setTimeout(() => {
    pongWatchdogId = null;

    if (!awaitingPong) return; // Pong arrived just in time

    console.warn(
      "[opentabs:offscreen] Pong timeout — connection is dead (likely server hot reload). Forcing reconnect."
    );
    awaitingPong = false;

    // Force-close the zombie WebSocket. This triggers onclose → reconnect.
    if (ws) {
      try {
        ws.close(4000, "Pong timeout");
      } catch {
        // Already closed
      }
      // If close doesn't fire onclose synchronously, null it out and reconnect manually
      if (ws) {
        ws = null;
        clearPingInterval();
        sendToBackground({ type: "ws:state", connected: false });
        scheduleReconnect();
      }
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
    connect();
  }, delay);
  backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
};

// --- Connection ---

const connect = (): void => {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
    return;
  }

  try {
    ws = new WebSocket(mcpServerUrl);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    backoffMs = INITIAL_BACKOFF_MS; // Reset backoff on success
    startPingInterval();
    sendToBackground({ type: "ws:state", connected: true });
  };

  ws.onmessage = (event) => {
    const text = typeof event.data === "string" ? event.data : "";
    try {
      const parsed = JSON.parse(text);

      // Handle pong — cancel the watchdog, connection is alive
      if (parsed.method === "pong") {
        onPongReceived();
        return;
      }

      // Forward all other messages from MCP server to background script
      sendToBackground({ type: "ws:message", data: parsed });
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onclose = () => {
    ws = null;
    clearPingInterval();
    clearPongWatchdog();
    sendToBackground({ type: "ws:state", connected: false });
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror — reconnect handled there
  };
};

// --- Message routing from background script ---

chrome.runtime.onMessage.addListener(
  (message: { type: string; data?: unknown }, _sender, sendResponse) => {
    if (message.type === "ws:send" && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message.data));
      sendResponse({ sent: true });
    } else if (message.type === "ws:send") {
      sendResponse({ sent: false, reason: "not connected" });
    } else if (message.type === "ws:getState") {
      sendResponse({ connected: ws?.readyState === WebSocket.OPEN });
    }
    // Return true to indicate we will send response asynchronously (for safety)
    return true;
  }
);

// Load the MCP server URL from storage, then start connection
loadMcpServerUrl().then((url) => {
  mcpServerUrl = url;
  console.log(`[opentabs:offscreen] Connecting to ${mcpServerUrl}`);
  connect();
});

// Also listen for storage changes so the URL can be updated at runtime
// (e.g., by E2E test fixtures writing to chrome.storage.local).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.mcpServerUrl?.newValue) {
    const newUrl = changes.mcpServerUrl.newValue as string;
    if (newUrl !== mcpServerUrl) {
      console.log(`[opentabs:offscreen] MCP server URL changed to ${newUrl}`);
      mcpServerUrl = newUrl;
      // Force reconnect to the new URL
      if (ws) {
        try {
          ws.close(1000, "URL changed");
        } catch {
          // Already closed
        }
      }
    }
  }
});
