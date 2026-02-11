/**
 * Bridge for side panel ↔ background script ↔ MCP server communication.
 * Uses chrome.runtime.sendMessage with bg:* message types.
 */

export interface PluginState {
  name: string;
  displayName: string;
  version: string;
  trustTier: string;
  tabState: "closed" | "unavailable" | "ready";
  urlPatterns: string[];
  tools: Array<{
    name: string;
    description: string;
    enabled: boolean;
  }>;
}

export interface ConfigState {
  plugins: PluginState[];
}

let requestId = 1;

/** Send a JSON-RPC request to the MCP server via the background script */
const sendToServer = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
  const id = requestId++;
  const data = { jsonrpc: "2.0", method, params, id };
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "bg:send", data },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      }
    );
  });
};

/** Query the background script for WebSocket connection state */
export const getConnectionState = (): Promise<boolean> =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "bg:getConnectionState" },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve(false);
        } else {
          resolve(response?.connected === true);
        }
      }
    );
  });

/** Request full state from MCP server via config.getState */
export const fetchConfigState = (): void => {
  sendToServer("config.getState").catch(() => {
    // Will be handled by background relaying the response
  });
};

/** Toggle a single tool's enabled state */
export const setToolEnabled = (plugin: string, tool: string, enabled: boolean): void => {
  sendToServer("config.setToolEnabled", { plugin, tool, enabled }).catch(() => {});
};

/** Toggle all tools for a plugin */
export const setAllToolsEnabled = (plugin: string, enabled: boolean): void => {
  sendToServer("config.setAllToolsEnabled", { plugin, enabled }).catch(() => {});
};
