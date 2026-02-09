/**
 * Background Script — Composition Root
 *
 * Wires together the extracted modules. Each concern lives in its own file;
 * this file handles initialization and the message router that dispatches to them.
 */

import 'webextension-polyfill';
import { registerAdapters } from './adapter-manager';
import { setupAlarms } from './alarm-handlers';
import { BrowserController } from './browser-controller';
import { updateBadge } from './icon-manager';
import { handleMcpMessage } from './mcp-router';
import { initializeWebSocket, sendViaWebSocket, updateWebSocketUrl } from './offscreen-manager';
import { WebappServiceController, buildServiceConfigs } from './service-controllers';
import { setupSidePanel, markOpened, markClosed } from './side-panel-manager';
import { checkAndRefreshStaleTabs } from './stale-tab-manager';
import { saveConnectionState, restoreConnectionState } from './state-persistence';
import { Defaults, MessageTypes, SERVICE_IDS } from '@extension/shared';
import type { ServiceManagerContext, ServiceManager, ServiceId } from './service-managers/types';
import type { ConnectionStatus, ServiceConnection, BackgroundMessage } from '@extension/shared';

console.log('[OpenTabs] Background script loaded');

// ============================================================================
// Connection Status
// ============================================================================

const DEFAULT_CONNECTION: ServiceConnection = { connected: false };

const connectionStatus: ConnectionStatus = {
  mcpConnected: false,
  port: Defaults.WS_PORT,
  serverPath: undefined,
  services: Object.fromEntries(SERVICE_IDS.map(id => [id, { ...DEFAULT_CONNECTION }])) as Record<
    ServiceId,
    ServiceConnection
  >,
};

// Bind convenience helpers that close over shared state
const boundUpdateBadge = (): Promise<void> => updateBadge(connectionStatus);

const boundSaveConnectionState = (): Promise<void> => saveConnectionState(managers, connectionStatus);

// ============================================================================
// Service Manager Context and Initialization
// ============================================================================

const serviceManagerCtx: ServiceManagerContext = {
  sendViaWebSocket,
  updateBadge: boundUpdateBadge,
  saveConnectionState: boundSaveConnectionState,
};

const serviceConfigs = buildServiceConfigs();
const managers: Record<string, ServiceManager> = Object.fromEntries(
  Object.entries(serviceConfigs).map(([serviceId, config]) => [
    serviceId,
    new WebappServiceController(connectionStatus, serviceManagerCtx, config),
  ]),
) as Record<ServiceId, ServiceManager>;

const browserController = new BrowserController();

// ============================================================================
// Message Handlers (typed)
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
  if (message.type === MessageTypes.TAB_READY && sender.tab?.id) {
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
  if (message.type === MessageTypes.SET_PORT) {
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
  if (message.type === MessageTypes.FOCUS_TAB) {
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
  if (message.type === MessageTypes.SIDE_PANEL_OPENED) {
    markOpened(message.windowId);
    return false;
  }

  if (message.type === MessageTypes.SIDE_PANEL_CLOSED) {
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
// Initialization
// ============================================================================

(async () => {
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
})();
