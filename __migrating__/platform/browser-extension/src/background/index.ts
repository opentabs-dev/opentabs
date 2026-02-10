/**
 * Background Script — Composition Root
 *
 * Wires together the extracted modules. Each concern lives in its own file;
 * this file handles initialization and the message router that dispatches to them.
 *
 * Ported from chrome-extension/src/background/index.ts.
 * Key changes:
 * - Uses @opentabs/core instead of @extension/shared
 * - Service managers are built from plugin-provided WebappServiceConfigs
 *   (produced by @opentabs/plugin-loader at build time) instead of a static
 *   buildServiceConfigs() function
 * - The service registry is populated dynamically via setServiceRegistry()
 *   during initialization, using build-time generated plugin data
 * - No static SERVICE_IDS constant — uses getServiceIds() from the dynamic
 *   registry after initialization
 */

import { registerAdapters } from './adapter-manager.js';
import { setupAlarms } from './alarm-handlers.js';
import { BrowserController } from './browser-controller.js';
import { updateBadge } from './icon-manager.js';
import { handleMcpMessage } from './mcp-router.js';
import { initializeWebSocket, sendViaWebSocket, updateWebSocketUrl } from './offscreen-manager.js';
import { WebappServiceController } from './service-controllers/index.js';
import { setupSidePanel, markOpened, markClosed } from './side-panel-manager.js';
import { checkAndRefreshStaleTabs } from './stale-tab-manager.js';
import { saveConnectionState, restoreConnectionState } from './state-persistence.js';
import { Defaults, MessageTypes, setServiceRegistry, getServiceIds } from '@opentabs/core';
import type { WebappServiceConfig } from './service-controllers/webapp-service-controller.js';
import type { ServiceManager, ServiceManagerContext } from './service-managers/types.js';
import type { ConnectionStatus, ServiceConnectionStatus, BackgroundMessage, ServiceDefinition } from '@opentabs/core';

console.log('[OpenTabs] Background script loaded');

// ============================================================================
// Plugin Configuration — Injected at Build Time
//
// These functions are the bridge between the build-time plugin discovery
// (which runs in Node via @opentabs/plugin-loader) and the runtime extension
// background script (which runs in Chrome's service worker).
//
// A build script calls loadPlugins() at build time, serializes the results,
// and generates a module that exports these two data structures. The background
// script imports and passes them to initialize().
//
// For development, these can also be populated inline for testing.
// ============================================================================

/**
 * Initialize the extension background with plugin-provided configuration.
 *
 * This is the main entry point. Call this with the service definitions and
 * service configs produced by @opentabs/plugin-loader at build time.
 *
 * @param serviceDefinitions - ServiceDefinition[] from mergeIntoRegistry()
 * @param serviceConfigs - Record<string, WebappServiceConfig> from mergeServiceConfigs()
 */
const initialize = async (
  serviceDefinitions: readonly ServiceDefinition[],
  serviceConfigs: Record<string, WebappServiceConfig>,
): Promise<void> => {
  // 1. Populate the dynamic service registry so all modules can access it
  setServiceRegistry(serviceDefinitions);

  const serviceIds = getServiceIds();

  // 2. Build connection status from the dynamic registry
  const DEFAULT_CONNECTION: ServiceConnectionStatus = { connected: false };

  const connectionStatus: ConnectionStatus = {
    mcpConnected: false,
    port: Defaults.WS_PORT,
    serverPath: undefined,
    services: Object.fromEntries(serviceIds.map(id => [id, { ...DEFAULT_CONNECTION }])),
  };

  // 3. Bind convenience helpers that close over shared state
  const boundUpdateBadge = (): Promise<void> => updateBadge(connectionStatus);

  const boundSaveConnectionState = (): Promise<void> => saveConnectionState(managers, connectionStatus);

  // 4. Build service manager context
  const serviceManagerCtx: ServiceManagerContext = {
    sendViaWebSocket,
    updateBadge: boundUpdateBadge,
    saveConnectionState: boundSaveConnectionState,
  };

  // 5. Create service managers from plugin-provided configs
  const managers: Record<string, ServiceManager> = Object.fromEntries(
    Object.entries(serviceConfigs).map(([serviceId, config]) => [
      serviceId,
      new WebappServiceController(connectionStatus, serviceManagerCtx, config),
    ]),
  );

  const browserController = new BrowserController();

  // ============================================================================
  // Message Handlers
  // ============================================================================

  chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
    // Offscreen document messages
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
        handleMcpMessage(message.data as Record<string, unknown>, {
          managers,
          browserController,
          sendViaWebSocket,
          updateBadge: boundUpdateBadge,
          connectionStatus,
        });
      }
      return;
    }

    // Content script: tab ready
    if (message.type === MessageTypes.TAB_READY && 'serviceId' in message && sender.tab?.id) {
      const manager = managers[message.serviceId];
      if (manager) {
        manager.handleTabReady(sender.tab.id, sender.tab?.url ?? '');
      } else {
        console.log('[OpenTabs] Unknown service in tab_ready:', message.serviceId);
      }
      return false;
    }

    // Status request
    if (message.type === MessageTypes.GET_STATUS) {
      sendResponse(connectionStatus);
      return true;
    }

    // Port change
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

    // Focus tab
    if (message.type === MessageTypes.FOCUS_TAB && 'serviceId' in message) {
      const manager = managers[message.serviceId];
      if (manager) {
        manager.focusTab().then(sendResponse);
      } else {
        sendResponse({ success: false, error: 'Unknown service' });
      }
      return true;
    }

    // Open server folder
    if (message.type === MessageTypes.OPEN_SERVER_FOLDER) {
      sendViaWebSocket({ type: MessageTypes.OPEN_SERVER_FOLDER });
      sendResponse({ success: true });
      return true;
    }

    // Side panel lifecycle
    if (message.type === MessageTypes.SIDE_PANEL_OPENED && 'windowId' in message) {
      markOpened(message.windowId);
      return false;
    }

    if (message.type === MessageTypes.SIDE_PANEL_CLOSED && 'windowId' in message) {
      markClosed(message.windowId);
      return false;
    }

    return false;
  });

  // ============================================================================
  // Tab Event Listeners
  // ============================================================================

  chrome.tabs.onRemoved.addListener(tabId => {
    for (const [serviceId, manager] of Object.entries(managers)) {
      if (tabId === manager.getTabId()) {
        console.log(`[OpenTabs] ${serviceId} tab closed`);
        manager.handleDisconnect(tabId);
      }
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    for (const manager of Object.values(managers)) {
      manager.handleTabLoadComplete(tabId, tab.url);
    }
  });

  // ============================================================================
  // Startup Sequence
  // ============================================================================

  await restoreConnectionState(connectionStatus);
  await initializeWebSocket();

  try {
    await registerAdapters();
    console.log('[OpenTabs] Adapters registered successfully');
  } catch (err) {
    console.error('[OpenTabs] Failed to register adapters:', err);
  }

  await setupSidePanel();
  await setupAlarms(connectionStatus, managers);
  await checkAndRefreshStaleTabs();

  await Promise.all(Object.values(managers).map(manager => manager.findTabs()));

  await boundUpdateBadge();
  console.log('[OpenTabs] Initialization complete');
};

// ============================================================================
// Exports
//
// The background script exports `initialize` so that the build system can
// generate a thin entry point that imports the build-time plugin data and
// calls initialize() with it.
//
// Example generated entry point:
//
//   import { initialize } from '@opentabs/browser-extension';
//   import { serviceDefinitions, serviceConfigs } from './__generated__/plugin-config.js';
//   initialize(serviceDefinitions, serviceConfigs);
//
// For development/testing, you can call initialize() directly with inline data.
// ============================================================================

export { initialize };
export type { WebappServiceConfig };
