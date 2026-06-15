/**
 * Offscreen document — Chrome host for the persistent WebSocket transport.
 *
 * Chrome's Manifest V3 service worker cannot hold a long-lived WebSocket, so the
 * connection lives here in an offscreen document. This file is a thin Chrome
 * adapter: it owns the offscreen-specific glue (reading auth.json, relaying to
 * the background service worker via chrome.runtime.sendMessage, exposing the
 * offscreen log buffer) and delegates all connection logic to {@link WsTransport}.
 *
 * Firefox runs the same {@link WsTransport} directly in its background event page
 * (see `src/transport/firefox-background-transport.ts`) because Firefox has no
 * offscreen API.
 *
 * The WebSocket URL defaults to ws://127.0.0.1:9515/ws. The port is configurable
 * via chrome.storage.local ('serverPort' key). The background script reads the
 * port and relays the constructed URL here because offscreen documents do not
 * have access to chrome.storage APIs.
 */

import type { InternalMessage, WsDataMessage, WsStateMessage } from '../extension-messages.js';
import { installLogCollector } from '../log-collector.js';
import type { TransportHost, WsConnectionState } from '../transport/ws-transport.js';
import { WsTransport } from '../transport/ws-transport.js';

/** Capture console output in a ring buffer for retrieval by debugging tools */
const offscreenLogCollector = installLogCollector('offscreen');

/** Suppresses repeated auth.json warnings until a successful read resets it */
let authJsonWarned = false;

const sendToBackground = (message: InternalMessage): void => {
  chrome.runtime.sendMessage(message).catch(() => {
    // Background may not be listening yet — ignore
  });
};

/**
 * Read the shared secret from auth.json.
 *
 * The MCP server writes auth.json to the managed extension directory
 * (~/.opentabs/extension/auth.json) on startup. The offscreen document reads it
 * via chrome.runtime.getURL to obtain the secret, avoiding an unauthenticated
 * HTTP request to /ws-info. Port configuration is read from chrome.storage.local
 * (via the background script) separately.
 */
const loadSecretFromAuthFile = async (): Promise<string | null> => {
  try {
    const authUrl = `${chrome.runtime.getURL('auth.json')}?_t=${Date.now()}`;
    const res = await fetch(authUrl, { signal: AbortSignal.timeout(1_000), cache: 'no-store' });
    if (res.ok) {
      const auth = (await res.json()) as { secret?: string };
      if (typeof auth.secret === 'string' && auth.secret !== '') {
        authJsonWarned = false;
        return auth.secret;
      }
      if (!authJsonWarned) {
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
  return null;
};

/**
 * Ask the background script for the configured server URL and connectionId.
 * The background script reads these from chrome.storage.local and relays here
 * since offscreen docs cannot access chrome.storage APIs directly.
 */
const loadInitialConfigFromBackground = async (): Promise<{ url?: string; connectionId?: string }> => {
  const response = await new Promise<{ url?: string; connectionId?: string } | undefined>(resolve => {
    chrome.runtime.sendMessage(
      { type: 'offscreen:getUrl' } satisfies InternalMessage,
      (resp: { url?: string; connectionId?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(resp);
      },
    );
  });
  return response ?? {};
};

/** Chrome offscreen host: relays transport output to the background service worker. */
const host: TransportHost = {
  deliverMessage(msg: Record<string, unknown>): void {
    sendToBackground({ type: 'ws:message', data: msg } satisfies WsDataMessage);
  },
  notifyState(state: WsConnectionState): void {
    sendToBackground({
      type: 'ws:state',
      connected: state.connected,
      disconnectReason: state.disconnectReason,
    } satisfies WsStateMessage);
  },
  loadSecret: loadSecretFromAuthFile,
  loadInitialConfig: loadInitialConfigFromBackground,
};

const transport = new WsTransport(host);

// --- Message routing from background script ---

chrome.runtime.onMessage.addListener((message: InternalMessage, sender, sendResponse) => {
  // Defense-in-depth: only accept messages from our own extension.
  // Prevents content scripts or other extensions from sending ws:send messages.
  if (sender.id !== chrome.runtime.id) return false;

  switch (message.type) {
    case 'ws:send': {
      sendResponse(transport.send(message.data));
      break;
    }

    case 'ws:getState': {
      sendResponse(transport.getState());
      break;
    }

    case 'ws:setUrl': {
      void (async () => {
        sendResponse(await transport.setUrl(message.url));
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
      transport.forceReconnect();
      sendResponse({ ok: true });
      break;
    }

    case 'port-changed': {
      transport.portChanged(message.port);
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

void transport.start();
