/**
 * Firefox host for the persistent WebSocket transport.
 *
 * Firefox has no `chrome.offscreen` API, but a Firefox MV3 background event page
 * *can* hold a long-lived WebSocket. So on Firefox the same {@link WsTransport}
 * that Chrome runs inside an offscreen document runs directly in the background
 * page. This module provides the Firefox-flavoured {@link TransportHost} and a
 * single entry point, {@link startFirefoxBackgroundTransport}, that the
 * background script calls in place of `ensureOffscreenDocument()`.
 *
 * Because the transport runs in the same context as the consumer, inbound
 * messages and state are delivered through direct in-process callbacks
 * ({@link TransportConsumer}) rather than round-tripping through
 * `chrome.runtime.sendMessage` (which does not reliably deliver a context's own
 * messages back to itself).
 *
 * Wiring into `background.ts` (selecting this path when {@link isFirefox}) lands
 * with the Firefox build target; this module is the isolated, Chrome-safe
 * Firefox transport surface it depends on.
 */

import { buildWsUrl, SERVER_PORT_KEY } from '../constants.js';
import { isFirefox } from './target.js';
import type { TransportHost, WsConnectionState } from './ws-transport.js';
import { WsTransport } from './ws-transport.js';

/**
 * Consumer of transport output, implemented by the background script. These
 * are the same two effects the Chrome offscreen host relays via `ws:message`
 * and `ws:state`, delivered here as direct calls.
 */
export interface TransportConsumer {
  /** Handle a validated inbound JSON-RPC message from the MCP server. */
  onMessage(msg: Record<string, unknown>): void;
  /** Handle a connection-state transition. */
  onState(state: WsConnectionState): void;
}

/** Read the shared secret from auth.json (available to the background page). */
const loadSecretFromAuthFile = async (): Promise<string | null> => {
  try {
    const authUrl = `${chrome.runtime.getURL('auth.json')}?_t=${Date.now()}`;
    const res = await fetch(authUrl, { signal: AbortSignal.timeout(1_000), cache: 'no-store' });
    if (res.ok) {
      const auth = (await res.json()) as { secret?: string };
      if (typeof auth.secret === 'string' && auth.secret !== '') {
        return auth.secret;
      }
    }
  } catch {
    // auth.json not yet written — connect unauthenticated and retry on 401
  }
  return null;
};

/**
 * Read the configured server URL and connectionId directly from
 * chrome.storage.local. The background page has storage access, so unlike the
 * Chrome offscreen host there is no need to relay through a message.
 */
const loadInitialConfig = async (): Promise<{ url?: string; connectionId?: string }> => {
  const stored: Record<string, unknown> = await chrome.storage.local
    .get([SERVER_PORT_KEY, 'connectionId'])
    .catch(() => ({}) as Record<string, unknown>);
  const port =
    typeof stored[SERVER_PORT_KEY] === 'number' && (stored[SERVER_PORT_KEY] as number) > 0
      ? (stored[SERVER_PORT_KEY] as number)
      : undefined;
  const url = port ? buildWsUrl(port) : undefined;
  const connectionId = typeof stored.connectionId === 'string' ? stored.connectionId : undefined;
  return { url, connectionId };
};

/**
 * Start the persistent WebSocket transport in the Firefox background page.
 *
 * Returns the live {@link WsTransport} so the background script can drive it
 * (send, setUrl, portChanged, forceReconnect) from its own message handlers and
 * storage listeners — the same surface the Chrome path drives via messages to
 * the offscreen document.
 *
 * Throws on a non-Firefox build: running this on Chrome would open a second
 * connection alongside the offscreen document's. The Chrome path must use
 * `ensureOffscreenDocument()` instead.
 */
export const startFirefoxBackgroundTransport = (consumer: TransportConsumer): WsTransport => {
  if (!isFirefox) {
    throw new Error(
      'startFirefoxBackgroundTransport called on a non-Firefox build. Chrome must run the WebSocket in an offscreen document.',
    );
  }

  const host: TransportHost = {
    deliverMessage(msg: Record<string, unknown>): void {
      consumer.onMessage(msg);
    },
    notifyState(state: WsConnectionState): void {
      consumer.onState(state);
    },
    loadSecret: loadSecretFromAuthFile,
    loadInitialConfig,
  };

  const transport = new WsTransport(host);
  void transport.start();
  return transport;
};
