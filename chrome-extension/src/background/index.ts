import 'webextension-polyfill';
import { registerAdapters } from './adapter-manager';
import { BrowserController } from './browser-controller';
import { handleMcpMessage } from './mcp-router';
import {
  hasOffscreenDocument,
  sendToOffscreen,
  initializeWebSocket,
  sendViaWebSocket,
  updateWebSocketUrl,
} from './offscreen-manager';
import {
  WebappServiceController,
  SLACK_CONFIG,
  LOGROCKET_CONFIG,
  SNOWFLAKE_CONFIG,
  createDatadogConfig,
  createSqlpadConfig,
  createRetoolConfig,
} from './service-controllers';
import { Defaults, MessageTypes, SERVICE_IDS, SERVICE_URL_PATTERNS } from '@extension/shared';
import type { ServiceManagerContext, ServiceManager, ServiceId } from './service-managers/types';
import type { ConnectionStatus, ServiceConnection } from '@extension/shared';

console.log('[OpenTabs] Background script loaded');

// Constants
const KEEPALIVE_ALARM = 'keepalive';
const SESSION_HEALTH_CHECK_ALARM = 'session_health_check';

// Status indicator colors (Slack brand colors)
const STATUS_COLORS = {
  connected: '#2EB67D', // Slack Green
  disconnected: '#E01E5A', // Slack Red
} as const;

// Default connection state
const DEFAULT_CONNECTION: ServiceConnection = { connected: false };

// Connection status tracking - using Record<ServiceId, ServiceConnection>
const connectionStatus: ConnectionStatus = {
  mcpConnected: false,
  port: Defaults.WS_PORT,
  serverPath: undefined,
  services: Object.fromEntries(SERVICE_IDS.map(id => [id, { ...DEFAULT_CONNECTION }])) as Record<
    ServiceId,
    ServiceConnection
  >,
};

// ============================================================================
// Icon Status Indicator
// ============================================================================

const ICON_SIZES = [16, 32, 48, 128] as const;

let baseIconImageData: ImageData | null = null;
let lastConnectionState: boolean | null = null;

const loadBaseIcon = async (): Promise<ImageData> => {
  if (baseIconImageData) return baseIconImageData;

  const response = await fetch(chrome.runtime.getURL('icons/icon-128.png'));
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(128, 128);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, 128, 128);
  baseIconImageData = ctx.getImageData(0, 0, 128, 128);
  return baseIconImageData;
};

const createIconWithStatusDot = async (connected: boolean): Promise<Record<number, ImageData>> => {
  const baseImageData = await loadBaseIcon();
  const result: Record<number, ImageData> = {};
  const color = connected ? STATUS_COLORS.connected : STATUS_COLORS.disconnected;

  const baseCanvas = new OffscreenCanvas(128, 128);
  baseCanvas.getContext('2d')!.putImageData(baseImageData, 0, 0);

  for (const size of ICON_SIZES) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d')!;

    ctx.drawImage(baseCanvas, 0, 0, size, size);

    // Status dot in bottom-right corner
    const dotRadius = Math.max(size * 0.2, 3);
    const dotX = size - dotRadius - 1;
    const dotY = size - dotRadius - 1;

    // White border
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotRadius + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Colored dot
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    result[size] = ctx.getImageData(0, 0, size, size);
  }

  return result;
};

const updateBadge = async (): Promise<void> => {
  // Icon status depends purely on MCP server connection
  const isConnected = connectionStatus.mcpConnected;

  if (lastConnectionState !== isConnected) {
    lastConnectionState = isConnected;
    try {
      const iconData = await createIconWithStatusDot(isConnected);
      await chrome.action.setIcon({ imageData: iconData });
    } catch (err) {
      console.error('[OpenTabs] Error updating icon:', err);
    }
  }

  chrome.action.setBadgeText({ text: '' });
  chrome.runtime.sendMessage({ type: MessageTypes.STATUS_UPDATE, ...connectionStatus }).catch(() => {});
};

// ============================================================================
// State Persistence
// ============================================================================

const saveConnectionState = async (): Promise<void> => {
  const state: Record<string, unknown> = {};
  for (const serviceId of SERVICE_IDS) {
    state[`${serviceId}_tabId`] = managers[serviceId].getTabId();
    state[`${serviceId}_connected`] = connectionStatus.services[serviceId].connected;
  }
  await chrome.storage.session.set(state);
};

const restoreConnectionState = async (): Promise<void> => {
  try {
    const keys = SERVICE_IDS.map(id => `${id}_connected`);
    const stored = await chrome.storage.session.get(keys);

    // Restore connection status from storage (tabIds are re-discovered by findTabs)
    for (const serviceId of SERVICE_IDS) {
      const value = stored[`${serviceId}_connected`];
      if (value !== undefined) {
        connectionStatus.services[serviceId].connected = (value as boolean) ?? false;
      }
    }
  } catch {
    // Session storage may not be available in all contexts, safe to ignore
  }
};

// ============================================================================
// Service Manager Context and Initialization
// ============================================================================

// Create service manager context
const serviceManagerCtx: ServiceManagerContext = {
  sendViaWebSocket,
  updateBadge,
  saveConnectionState,
};

// Initialize all service controllers (flat structure)
const managers: Record<ServiceId, ServiceManager> = {
  slack: new WebappServiceController(connectionStatus, serviceManagerCtx, SLACK_CONFIG),
  datadog_production: new WebappServiceController(
    connectionStatus,
    serviceManagerCtx,
    createDatadogConfig('production'),
  ),
  datadog_staging: new WebappServiceController(connectionStatus, serviceManagerCtx, createDatadogConfig('staging')),
  sqlpad_production: new WebappServiceController(connectionStatus, serviceManagerCtx, createSqlpadConfig('production')),
  sqlpad_staging: new WebappServiceController(connectionStatus, serviceManagerCtx, createSqlpadConfig('staging')),
  logrocket: new WebappServiceController(connectionStatus, serviceManagerCtx, LOGROCKET_CONFIG),
  retool_production: new WebappServiceController(connectionStatus, serviceManagerCtx, createRetoolConfig('production')),
  retool_staging: new WebappServiceController(connectionStatus, serviceManagerCtx, createRetoolConfig('staging')),
  snowflake: new WebappServiceController(connectionStatus, serviceManagerCtx, SNOWFLAKE_CONFIG),
};

// Browser controller handles chrome.tabs/windows APIs directly (no webapp tab needed)
const browserController = new BrowserController();

// ============================================================================
// Message Handlers
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Messages from offscreen document
  if (message.source === 'offscreen') {
    if (message.type === MessageTypes.CONNECTED) {
      console.log('[OpenTabs] WebSocket connected');
      connectionStatus.mcpConnected = true;
      updateBadge();
    } else if (message.type === MessageTypes.DISCONNECTED) {
      console.log('[OpenTabs] WebSocket disconnected');
      connectionStatus.mcpConnected = false;
      connectionStatus.serverPath = undefined;
      updateBadge();
    } else if (message.type === MessageTypes.MESSAGE) {
      handleMcpMessage(message.data, {
        managers,
        browserController,
        sendViaWebSocket,
        updateBadge,
        connectionStatus,
      });
    }
    return;
  }

  // Unified tab ready notification from content scripts
  if (message.type === MessageTypes.TAB_READY && sender.tab?.id) {
    const serviceId = message.serviceId as ServiceId;
    const manager = managers[serviceId];
    if (manager) {
      manager.handleTabReady(sender.tab.id, sender.tab?.url ?? '');
    } else {
      console.log('[OpenTabs] Unknown service in tab_ready:', serviceId);
    }
    return false;
  }

  // Status request from popup
  if (message.type === MessageTypes.GET_STATUS) {
    sendResponse(connectionStatus);
    return true;
  }

  // Port change from popup
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

  // Unified focus tab request
  if (message.type === MessageTypes.FOCUS_TAB) {
    const serviceId = message.serviceId as ServiceId;
    const manager = managers[serviceId];
    if (manager) {
      manager.focusTab().then(sendResponse);
    } else {
      sendResponse({ success: false, error: 'Unknown service' });
    }
    return true;
  }

  // Open server folder request from popup
  if (message.type === MessageTypes.OPEN_SERVER_FOLDER) {
    sendViaWebSocket({ type: MessageTypes.OPEN_SERVER_FOLDER });
    sendResponse({ success: true });
    return true;
  }

  // Side panel opened notification
  if (message.type === MessageTypes.SIDE_PANEL_OPENED) {
    const windowId = message.windowId as number | undefined;
    if (windowId) {
      sidePanelOpenState.set(windowId, true);
    }
    return false;
  }

  // Side panel closed notification
  if (message.type === MessageTypes.SIDE_PANEL_CLOSED) {
    const windowId = message.windowId as number | undefined;
    if (windowId) {
      sidePanelOpenState.set(windowId, false);
    }
    return false;
  }

  return false;
});

// ============================================================================
// Tab Event Listeners
// ============================================================================

chrome.tabs.onRemoved.addListener(tabId => {
  // Check all managers to see if this tab belongs to any service
  for (const [serviceId, manager] of Object.entries(managers)) {
    if (tabId === manager.getTabId()) {
      console.log(`[OpenTabs] ${serviceId} tab closed`);
      manager.handleDisconnect(tabId);
    }
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only act when tab finishes loading
  if (changeInfo.status !== 'complete' || !tab.url) return;

  // Notify all managers about the tab load
  for (const manager of Object.values(managers)) {
    manager.handleTabLoadComplete(tabId, tab.url);
  }
});

// ============================================================================
// Keepalive Alarm
// ============================================================================

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === SESSION_HEALTH_CHECK_ALARM) {
    await performSessionHealthChecks();
    return;
  }

  if (alarm.name !== KEEPALIVE_ALARM) return;

  // Ensure offscreen document exists and WebSocket is connected
  const hasDoc = await hasOffscreenDocument();
  if (!hasDoc) {
    await initializeWebSocket();
    return;
  }

  try {
    const response = (await sendToOffscreen({ type: MessageTypes.STATUS })) as { connected: boolean };
    if (!response?.connected) {
      await sendToOffscreen({
        type: MessageTypes.CONNECT,
        url: `ws://127.0.0.1:${connectionStatus.port}`,
      });
    }
  } catch {
    // Communication with offscreen document failed, reinitialize
    await initializeWebSocket();
  }

  // Restore connections if needed
  await restoreConnectionState();

  // Find tabs for any disconnected services
  for (const manager of Object.values(managers)) {
    if (!manager.isConnected()) {
      await manager.findTabs();
    }
  }
});

// ============================================================================
// Session Health Checks
// ============================================================================

/**
 * Perform health checks on all connected webapp sessions.
 */
const performSessionHealthChecks = async (): Promise<void> => {
  const checks: Promise<boolean>[] = [];

  for (const manager of Object.values(managers)) {
    if (manager.isConnected() && manager.getTabId()) {
      checks.push(manager.checkSession());
    }
  }

  await Promise.allSettled(checks);
};

// ============================================================================
// Stale Tab Auto-Refresh
// ============================================================================

// Track which tabs we've already refreshed this session (prevents refresh loops)
const refreshedTabs = new Set<number>();

/**
 * Check if content scripts in service tabs are stale and refresh them if needed.
 */
const checkAndRefreshStaleTabs = async (): Promise<void> => {
  // Query all tabs that could have our content scripts (loop over SERVICE_IDS)
  const tabQueries = SERVICE_IDS.map(id => chrome.tabs.query({ url: SERVICE_URL_PATTERNS[id] }));
  const tabResults = await Promise.all(tabQueries);
  const allTabs = tabResults.flat();
  let refreshedCount = 0;

  for (const tab of allTabs) {
    if (!tab.id || refreshedTabs.has(tab.id)) continue;

    try {
      // Ping the content script to check if it's alive
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: MessageTypes.PING }),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)),
      ]);

      if (!response) {
        // No response - content script is likely stale or not injected
        refreshedTabs.add(tab.id);
        await chrome.tabs.reload(tab.id);
        refreshedCount++;
      }
    } catch {
      // Error communicating with tab - likely needs refresh
      refreshedTabs.add(tab.id);
      try {
        await chrome.tabs.reload(tab.id);
        refreshedCount++;
      } catch {
        // Tab might have been closed, ignore
      }
    }
  }

  if (refreshedCount > 0) {
    console.log(`[OpenTabs] Refreshed ${refreshedCount} stale tab(s)`);
  }
};

// ============================================================================
// Side Panel Management
// ============================================================================

// Track side panel open state per window
const sidePanelOpenState = new Map<number, boolean>();

/**
 * Toggle the side panel for the current window when the extension icon is clicked.
 */
chrome.action.onClicked.addListener(async tab => {
  if (!tab.windowId) return;

  const windowId = tab.windowId;
  const isCurrentlyOpen = sidePanelOpenState.get(windowId) ?? false;

  if (isCurrentlyOpen) {
    // Send message to side panel to close itself
    chrome.runtime.sendMessage({ type: MessageTypes.CLOSE_SIDE_PANEL }).catch(() => {
      // Side panel might already be closed
    });
    sidePanelOpenState.set(windowId, false);
  } else {
    // Open the side panel
    try {
      await chrome.sidePanel.open({ windowId });
      sidePanelOpenState.set(windowId, true);
    } catch (err) {
      console.error('[OpenTabs] Failed to open side panel:', err);
    }
  }
});

// ============================================================================
// Initialization
// ============================================================================

(async () => {
  await restoreConnectionState();
  await initializeWebSocket();

  // Register MAIN world adapters (for the new adapter-based architecture)
  try {
    await registerAdapters();
    console.log('[OpenTabs] Adapters registered successfully');
  } catch (err) {
    console.error('[OpenTabs] Failed to register adapters:', err);
  }

  // Configure side panel behavior
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

  // Keepalive alarm to maintain WebSocket connection
  await chrome.alarms.clear(KEEPALIVE_ALARM);
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: Defaults.KEEPALIVE_INTERVAL_MINUTES });

  // Session health check alarm
  await chrome.alarms.clear(SESSION_HEALTH_CHECK_ALARM);
  await chrome.alarms.create(SESSION_HEALTH_CHECK_ALARM, {
    periodInMinutes: Defaults.SESSION_HEALTH_CHECK_INTERVAL_MS / 60000,
  });

  // Check for stale tabs and refresh them
  await checkAndRefreshStaleTabs();

  // Find tabs for all services
  await Promise.all(Object.values(managers).map(manager => manager.findTabs()));

  await updateBadge();
  console.log('[OpenTabs] Initialization complete');
})();
