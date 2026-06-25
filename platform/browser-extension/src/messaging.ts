import type {
  InternalMessage,
  PluginTabStateInfo,
  SpConnectionStateMessage,
  SpRelayMessage,
} from './extension-messages.js';
import { isFirefox } from './transport/target.js';
import type { WsTransport } from './transport/ws-transport.js';

/** Messages that can be forwarded to the side panel */
type SidePanelMessage = SpConnectionStateMessage | SpRelayMessage;

// ---------------------------------------------------------------------------
// Server connection routing
//
// Outbound traffic to the MCP server reaches the persistent WebSocket through
// one of two paths, decided at build time:
//
// - **Chrome**: the transport lives in an offscreen document, so the background
//   relays operations to it via `chrome.runtime.sendMessage` (`ws:send`,
//   `ws:setUrl`, `port-changed`, `bg:forceReconnect`).
// - **Firefox**: the transport runs directly in the background event page, so
//   the background drives the live {@link WsTransport} instance in-process. No
//   `chrome.runtime.sendMessage` round-trip — a context's own messages are not
//   reliably delivered back to itself.
//
// `background.ts` registers the live Firefox transport via
// {@link setFirefoxTransport} at startup. On Chrome the reference stays null and
// every operation takes the message-relay branch.
// ---------------------------------------------------------------------------

/** The live Firefox background transport, or null on Chrome / before startup. */
let firefoxTransport: WsTransport | null = null;

/** Register the live Firefox background transport so outbound ops drive it directly. */
export const setFirefoxTransport = (transport: WsTransport): void => {
  firefoxTransport = transport;
};

/** Send a JSON-RPC message to the MCP server (direct on Firefox, via offscreen on Chrome). */
export const sendToServer = (data: unknown): void => {
  const method = (data as { method?: string }).method ?? 'unknown';
  if (isFirefox) {
    if (!firefoxTransport) {
      console.warn(`[opentabs] sendToServer dropped "${method}": Firefox transport not started`);
      return;
    }
    firefoxTransport.send(data);
    return;
  }
  chrome.runtime.sendMessage({ type: 'ws:send', data } satisfies InternalMessage).catch((err: unknown) => {
    console.warn(`[opentabs] sendToServer failed for "${method}":`, err);
  });
};

/** Apply a new MCP server WebSocket URL (direct on Firefox, via offscreen on Chrome). */
export const setServerUrl = (url: string): void => {
  if (isFirefox) {
    void firefoxTransport?.setUrl(url);
    return;
  }
  chrome.runtime.sendMessage({ type: 'ws:setUrl', url } satisfies InternalMessage).catch(() => {
    // Offscreen may not be ready yet
  });
};

/** Apply a new MCP server port (direct on Firefox, via offscreen on Chrome). */
export const changeServerPort = (port: number): void => {
  if (isFirefox) {
    firefoxTransport?.portChanged(port);
    return;
  }
  chrome.runtime.sendMessage({ type: 'port-changed', port } satisfies InternalMessage).catch(() => {
    // Offscreen may not be ready yet
  });
};

/** Force the MCP server connection to reconnect (direct on Firefox, via offscreen on Chrome). */
export const forceReconnectServer = async (): Promise<void> => {
  if (isFirefox) {
    firefoxTransport?.forceReconnect();
    return;
  }
  await chrome.runtime.sendMessage({ type: 'bg:forceReconnect' } satisfies InternalMessage);
};

/** Forward a message to the side panel (fire-and-forget) */
export const forwardToSidePanel = (message: SidePanelMessage): void => {
  const type = message.type;
  chrome.runtime.sendMessage(message).catch((err: unknown) => {
    console.warn(`[opentabs] forwardToSidePanel failed for "${type}":`, err);
  });
};

/**
 * Send a tab.stateChanged notification to both the MCP server and the side panel.
 * Encapsulates the JSON-RPC payload construction for the tab.stateChanged method,
 * eliminating duplicated payload building across tab-state.ts and message-router.ts.
 */
export const sendTabStateNotification = (pluginName: string, stateInfo: PluginTabStateInfo): void => {
  const params = {
    plugin: pluginName,
    state: stateInfo.state,
    tabs: stateInfo.tabs,
  };

  sendToServer({
    jsonrpc: '2.0',
    method: 'tab.stateChanged',
    params,
  });

  forwardToSidePanel({
    type: 'sp:serverMessage',
    data: {
      jsonrpc: '2.0',
      method: 'tab.stateChanged',
      params,
    },
  });
};
