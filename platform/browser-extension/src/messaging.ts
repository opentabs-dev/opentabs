import type {
  InternalMessage,
  PluginTabStateInfo,
  SpConnectionStateMessage,
  SpRelayMessage,
} from './extension-messages.js';

/** Messages that can be forwarded to the side panel */
type SidePanelMessage = SpConnectionStateMessage | SpRelayMessage;

/** Send a JSON-RPC message to the MCP server via offscreen WebSocket */
export const sendToServer = (data: unknown): void => {
  const method = (data as { method?: string }).method ?? 'unknown';
  chrome.runtime.sendMessage({ type: 'ws:send', data } satisfies InternalMessage).catch((err: unknown) => {
    console.warn(`[opentabs] sendToServer failed for "${method}":`, err);
  });
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
    tabId: stateInfo.tabId,
    url: stateInfo.url,
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
