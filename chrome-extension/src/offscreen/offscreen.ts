/**
 * Offscreen document for persistent WebSocket connection.
 * This document doesn't sleep like service workers do, allowing
 * us to maintain a stable WebSocket connection to the MCP server.
 */

import { Defaults, MessageTypes } from '@extension/shared';

// Constants
const DEFAULT_WS_URL = `ws://127.0.0.1:${Defaults.WS_PORT}`;

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let wsUrl = DEFAULT_WS_URL;
let shouldReconnect = false;

// ============================================================================
// Message Handler
// ============================================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case MessageTypes.CONNECT:
      wsUrl = message.url || wsUrl;
      shouldReconnect = true;
      connect();
      sendResponse({ success: true });
      break;

    case MessageTypes.DISCONNECT:
      shouldReconnect = false;
      disconnect();
      sendResponse({ success: true });
      break;

    case MessageTypes.SEND:
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message.data));
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Not connected' });
      }
      break;

    case MessageTypes.STATUS:
      sendResponse({
        connected: ws !== null && ws.readyState === WebSocket.OPEN,
        url: wsUrl,
      });
      break;

    case MessageTypes.UPDATE_URL:
      if (message.url !== wsUrl) {
        wsUrl = message.url;
        if (shouldReconnect) {
          disconnect();
          connect();
        }
      }
      sendResponse({ success: true });
      break;

    case MessageTypes.KEEPALIVE:
      sendResponse({ alive: true });
      break;
  }

  return true;
});

// ============================================================================
// WebSocket Management
// ============================================================================

const connect = (): void => {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
    return;
  }

  try {
    console.log(`[Offscreen] Connecting to ${wsUrl}...`);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Offscreen] Connected');
      reconnectAttempts = 0;
      notifyServiceWorker(MessageTypes.CONNECTED);
    };

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        notifyServiceWorker(MessageTypes.MESSAGE, data);
      } catch (err) {
        console.error('[Offscreen] Failed to parse message:', err);
      }
    };

    ws.onclose = event => {
      console.log('[Offscreen] Disconnected:', event.code);
      ws = null;
      notifyServiceWorker(MessageTypes.DISCONNECTED);
      if (shouldReconnect) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // WebSocket errors don't contain useful info - just an Event object
      // The actual disconnect reason comes via onclose
    };
  } catch (err) {
    console.error('[Offscreen] Failed to connect:', err);
    if (shouldReconnect) {
      scheduleReconnect();
    }
  }
};

const disconnect = (): void => {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (ws) {
    ws.close(1000, 'Disconnect requested');
    ws = null;
  }
};

const scheduleReconnect = (): void => {
  if (reconnectTimeout || !shouldReconnect) return;

  const delay = Math.min(
    Defaults.RECONNECT_BASE_INTERVAL_MS * Math.pow(2, reconnectAttempts),
    Defaults.RECONNECT_MAX_INTERVAL_MS,
  );
  const attemptNum = reconnectAttempts + 1;
  if (attemptNum <= 3 || attemptNum % 5 === 0) {
    // Log first 3 attempts and then every 5th to avoid log spam
    console.log(`[Offscreen] Reconnecting in ${delay}ms (attempt ${attemptNum})`);
  }

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    reconnectAttempts++;
    connect();
  }, delay);
};

const notifyServiceWorker = (type: string, data?: unknown): void => {
  chrome.runtime.sendMessage({ source: 'offscreen', type, data }).catch(() => {
    // Service worker might be asleep, that's ok
  });
};

// ============================================================================
// Keep-alive
// ============================================================================

// Send ping to keep WebSocket alive
setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, Defaults.PING_INTERVAL_MS);

console.log('[Offscreen] Ready');
