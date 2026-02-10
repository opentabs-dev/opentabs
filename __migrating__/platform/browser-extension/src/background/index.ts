/**
 * Background Script — Composition Root
 *
 * Wires together the extracted modules. Each concern lives in its own file;
 * this file handles initialization and the message router that dispatches to them.
 *
 * The plugin system is fully dynamic: plugins are installed, updated, and
 * removed at runtime via WebSocket messages from the MCP server. Plugin data
 * (manifests, adapter code, service configs) is stored in chrome.storage.local
 * and loaded on startup. No build-time code generation is required.
 *
 * Initialization flow:
 *   1. Initialize the plugin manager (loads plugins from storage, creates
 *      service controllers, populates the service registry)
 *   2. Set up WebSocket connection to the MCP server
 *   3. Register tab event listeners (delegate to plugin manager)
 *   4. Set up alarms for keepalive and health checks
 *   5. Wait for MCP server to push plugin sync on connect
 */

import { setupAlarms } from './alarm-handlers.js';
import { BrowserController } from './browser-controller.js';
import { updateBadge } from './icon-manager.js';
import { handleMcpMessage } from './mcp-router.js';
import { initializeWebSocket, sendViaWebSocket, updateWebSocketUrl } from './offscreen-manager.js';
import {
  initializePluginManager,
  getManagers,
  getConnectionStatus,
  handlePluginInstall,
  handlePluginUninstall,
  handlePluginEnable,
  handlePluginDisable,
  handlePluginSync,
  handleTabLoadComplete,
  handleTabRemoved,
  listPlugins,
} from './plugin-manager.js';
import { setupSidePanel, markOpened, markClosed } from './side-panel-manager.js';
import { checkAndRefreshStaleTabs } from './stale-tab-manager.js';
import { MessageTypes } from '@opentabs/core';
import type { ServiceManagerContext } from './service-managers/types.js';
import type { BackgroundMessage, PluginInstallPayload, PluginUninstallPayload } from '@opentabs/core';

console.log('[OpenTabs] Background script loaded');

// =============================================================================
// Startup
//
// The background script starts by initializing the plugin manager, which
// loads all previously installed plugins from chrome.storage.local and
// creates their service controllers. No build-time generated data is needed.
//
// When the MCP server connects over WebSocket, it sends a plugin_sync
// message with all discovered plugins. The plugin manager reconciles
// this with the stored state: installing new plugins, upgrading changed
// ones, and removing stale ones.
// =============================================================================

const start = async (): Promise<void> => {
  // ============================================================================
  // 1. Build the service manager context (shared dependencies for controllers)
  // ============================================================================

  const boundUpdateBadge = async (): Promise<void> => {
    const status = getConnectionStatus();
    await updateBadge(status);
  };

  const serviceManagerCtx: ServiceManagerContext = {
    sendViaWebSocket,
    updateBadge: boundUpdateBadge,
  };

  // ============================================================================
  // 2. Initialize the plugin manager
  //
  // This loads all previously installed plugins from chrome.storage.local,
  // creates their service controllers, populates the service registry,
  // and injects adapters into any existing matching tabs.
  // ============================================================================

  // Restore the WebSocket port from storage
  let restoredPort: number | undefined;
  try {
    const stored = await chrome.storage.sync.get('wsPort');
    if (typeof stored.wsPort === 'number') {
      restoredPort = stored.wsPort;
    }
  } catch {
    // Storage may not be available yet
  }

  await initializePluginManager(serviceManagerCtx, restoredPort);

  const browserController = new BrowserController();

  // ============================================================================
  // 3. Message Handlers
  // ============================================================================

  chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
    const connectionStatus = getConnectionStatus();
    const managers = getManagers();

    // ------------------------------------------------------------------
    // Offscreen document messages (WebSocket lifecycle + data)
    // ------------------------------------------------------------------

    if ('source' in message && message.source === 'offscreen') {
      if (message.type === MessageTypes.CONNECTED) {
        console.log('[OpenTabs] WebSocket connected');
        connectionStatus.mcpConnected = true;
        boundUpdateBadge();
      } else if (message.type === MessageTypes.DISCONNECTED) {
        console.log('[OpenTabs] WebSocket disconnected');
        connectionStatus.mcpConnected = false;
        connectionStatus.serverPath = undefined;
        boundUpdateBadge();
      } else if (message.type === MessageTypes.MESSAGE) {
        const data = message.data as Record<string, unknown>;

        // Handle plugin system messages before MCP routing
        if (data.type === MessageTypes.PLUGIN_SYNC) {
          handlePluginSyncMessage(data);
          return;
        }
        if (data.type === MessageTypes.PLUGIN_INSTALL) {
          handlePluginInstallMessage(data);
          return;
        }
        if (data.type === MessageTypes.PLUGIN_UNINSTALL) {
          handlePluginUninstallMessage(data);
          return;
        }

        // Standard MCP JSON-RPC routing
        handleMcpMessage(data, {
          managers,
          browserController,
          sendViaWebSocket,
          updateBadge: boundUpdateBadge,
          connectionStatus,
        });
      }
      return;
    }

    // ------------------------------------------------------------------
    // Content script: tab ready
    // ------------------------------------------------------------------

    if (message.type === MessageTypes.TAB_READY && 'serviceId' in message && sender.tab?.id) {
      const manager = managers[message.serviceId];
      if (manager) {
        manager.handleTabReady(sender.tab.id, sender.tab?.url ?? '');
      } else {
        console.log('[OpenTabs] Unknown service in tab_ready:', message.serviceId);
      }
      return false;
    }

    // ------------------------------------------------------------------
    // Status request (side panel, options page)
    // ------------------------------------------------------------------

    if (message.type === MessageTypes.GET_STATUS) {
      sendResponse(connectionStatus);
      return true;
    }

    // ------------------------------------------------------------------
    // Port change
    // ------------------------------------------------------------------

    if (message.type === MessageTypes.SET_PORT && 'port' in message) {
      const newPort = message.port;
      if (typeof newPort === 'number' && newPort > 0 && newPort < 65536) {
        connectionStatus.port = newPort;
        chrome.storage.sync.set({ wsPort: newPort });
        updateWebSocketUrl(newPort);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Invalid port' });
      }
      return true;
    }

    // ------------------------------------------------------------------
    // Focus tab
    // ------------------------------------------------------------------

    if (message.type === MessageTypes.FOCUS_TAB && 'serviceId' in message) {
      const manager = managers[message.serviceId];
      if (manager) {
        manager.focusTab().then(sendResponse);
      } else {
        sendResponse({ success: false, error: 'Unknown service' });
      }
      return true;
    }

    // ------------------------------------------------------------------
    // Open server folder
    // ------------------------------------------------------------------

    if (message.type === MessageTypes.OPEN_SERVER_FOLDER) {
      sendViaWebSocket({ type: MessageTypes.OPEN_SERVER_FOLDER });
      sendResponse({ success: true });
      return true;
    }

    // ------------------------------------------------------------------
    // Side panel lifecycle
    // ------------------------------------------------------------------

    if (message.type === MessageTypes.SIDE_PANEL_OPENED && 'windowId' in message) {
      markOpened(message.windowId);
      return false;
    }

    if (message.type === MessageTypes.SIDE_PANEL_CLOSED && 'windowId' in message) {
      markClosed(message.windowId);
      return false;
    }

    // ------------------------------------------------------------------
    // Plugin enable / disable (from options page or side panel)
    // ------------------------------------------------------------------

    if (message.type === MessageTypes.PLUGIN_ENABLE && 'pluginName' in message) {
      handlePluginEnable(message.pluginName)
        .then(success => {
          boundUpdateBadge();
          sendResponse({ success });
        })
        .catch(err => {
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
        });
      return true;
    }

    if (message.type === MessageTypes.PLUGIN_DISABLE && 'pluginName' in message) {
      handlePluginDisable(message.pluginName)
        .then(success => {
          boundUpdateBadge();
          sendResponse({ success });
        })
        .catch(err => {
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
        });
      return true;
    }

    // ------------------------------------------------------------------
    // Plugin list (for options page / side panel)
    // ------------------------------------------------------------------

    if (message.type === MessageTypes.PLUGIN_LIST) {
      listPlugins()
        .then(sendResponse)
        .catch(() => sendResponse([]));
      return true;
    }

    return false;
  });

  // ============================================================================
  // 4. Tab Event Listeners
  //
  // All tab events are forwarded through the plugin manager, which delegates
  // to both the adapter manager (for dynamic injection) and the service
  // controllers (for tab lifecycle management).
  // ============================================================================

  chrome.tabs.onRemoved.addListener(tabId => {
    handleTabRemoved(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    handleTabLoadComplete(tabId, tab.url);
  });

  // ============================================================================
  // 5. Startup Sequence
  // ============================================================================

  await initializeWebSocket();

  await setupSidePanel();
  await setupAlarms(getConnectionStatus(), getManagers());
  await checkAndRefreshStaleTabs();

  // Trigger tab discovery for all service controllers
  const managers = getManagers();
  await Promise.all(Object.values(managers).map(manager => manager.findTabs()));

  await boundUpdateBadge();
  console.log('[OpenTabs] Initialization complete');
};

// =============================================================================
// Plugin WebSocket Message Handlers
//
// These handle plugin management commands received from the MCP server
// over the WebSocket connection. The MCP server discovers plugins at
// startup (and on hot reload) and pushes them to the extension.
// =============================================================================

/**
 * Handle a plugin_sync message: the MCP server pushes all discovered plugins.
 * Reconciles the extension's stored plugins with the server's set.
 */
const handlePluginSyncMessage = async (data: Record<string, unknown>): Promise<void> => {
  const payloads = data.plugins as PluginInstallPayload[] | undefined;
  if (!Array.isArray(payloads)) {
    console.error('[OpenTabs] Invalid plugin_sync message: missing plugins array');
    return;
  }

  try {
    const result = await handlePluginSync(payloads);

    // Send confirmation back to MCP server
    await sendViaWebSocket({
      type: MessageTypes.PLUGIN_INSTALLED,
      syncResult: result,
    });

    // Update UI
    const connectionStatus = getConnectionStatus();
    await updateBadge(connectionStatus);
  } catch (err) {
    console.error('[OpenTabs] Plugin sync failed:', err);
  }
};

/**
 * Handle a plugin_install message: the MCP server pushes a single plugin.
 */
const handlePluginInstallMessage = async (data: Record<string, unknown>): Promise<void> => {
  const payload = data.plugin as PluginInstallPayload | undefined;
  if (!payload || typeof payload.name !== 'string') {
    console.error('[OpenTabs] Invalid plugin_install message: missing plugin payload');
    return;
  }

  const result = await handlePluginInstall(payload);

  // Send confirmation back to MCP server
  await sendViaWebSocket({
    type: MessageTypes.PLUGIN_INSTALLED,
    result,
  });

  // Update UI
  const connectionStatus = getConnectionStatus();
  await updateBadge(connectionStatus);
};

/**
 * Handle a plugin_uninstall message: the MCP server requests plugin removal.
 */
const handlePluginUninstallMessage = async (data: Record<string, unknown>): Promise<void> => {
  const payload = data.plugin as PluginUninstallPayload | undefined;
  if (!payload || typeof payload.name !== 'string') {
    console.error('[OpenTabs] Invalid plugin_uninstall message: missing plugin payload');
    return;
  }

  const result = await handlePluginUninstall(payload.name);

  // Send confirmation back to MCP server
  await sendViaWebSocket({
    type: MessageTypes.PLUGIN_UNINSTALLED,
    result,
  });

  // Update UI
  const connectionStatus = getConnectionStatus();
  await updateBadge(connectionStatus);
};

// =============================================================================
// Entry Point
//
// The background script is self-initializing. No external caller needs to
// invoke initialize() with build-time data — everything is loaded from
// chrome.storage.local and the MCP server pushes plugin updates over WS.
//
// The `initialize` export is kept for backward compatibility with the
// build script's generated entry point. If called with service definitions
// and configs, they are ignored — the plugin manager loads from storage.
// =============================================================================

/**
 * @deprecated Use the self-initializing `start()` flow instead.
 * Kept for backward compatibility with build-generated entry points.
 * The parameters are ignored — plugin data comes from storage and WS sync.
 */
const initialize = async (): Promise<void> => {
  await start();
};

// Auto-start the background script
start().catch(err => {
  console.error('[OpenTabs] Background startup failed:', err);
});

export { initialize };
