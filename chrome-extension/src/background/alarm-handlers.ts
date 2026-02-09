/**
 * Alarm Handlers
 *
 * Manages Chrome alarm-based periodic tasks:
 * - Keepalive: ensures offscreen document and WebSocket stay alive
 * - Session health checks: verifies connected service sessions are still valid
 */

import { hasOffscreenDocument, sendToOffscreen, initializeWebSocket } from './offscreen-manager';
import { restoreConnectionState } from './state-persistence';
import { Defaults, MessageTypes } from '@extension/shared';
import type { ServiceManager } from './service-managers/types';
import type { ConnectionStatus } from '@extension/shared';

const KEEPALIVE_ALARM = 'keepalive';
const SESSION_HEALTH_CHECK_ALARM = 'session_health_check';

/**
 * Handle the keepalive alarm: ensure offscreen doc exists, WebSocket is connected,
 * and find tabs for any disconnected services.
 */
const handleKeepaliveAlarm = async (
  connectionStatus: ConnectionStatus,
  managers: Record<string, ServiceManager>,
): Promise<void> => {
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

  await restoreConnectionState(connectionStatus);

  for (const manager of Object.values(managers)) {
    if (!manager.isConnected()) {
      await manager.findTabs();
    }
  }
};

/**
 * Run health checks on all connected webapp sessions.
 */
const handleSessionHealthCheckAlarm = async (managers: Record<string, ServiceManager>): Promise<void> => {
  const checks: Promise<boolean>[] = [];

  for (const manager of Object.values(managers)) {
    if (manager.isConnected() && manager.getTabId()) {
      checks.push(manager.checkSession());
    }
  }

  await Promise.allSettled(checks);
};

/**
 * Register the alarm listener and create the periodic alarms.
 */
const setupAlarms = async (
  connectionStatus: ConnectionStatus,
  managers: Record<string, ServiceManager>,
): Promise<void> => {
  chrome.alarms.onAlarm.addListener(async alarm => {
    if (alarm.name === SESSION_HEALTH_CHECK_ALARM) {
      await handleSessionHealthCheckAlarm(managers);
      return;
    }

    if (alarm.name === KEEPALIVE_ALARM) {
      await handleKeepaliveAlarm(connectionStatus, managers);
    }
  });

  await chrome.alarms.clear(KEEPALIVE_ALARM);
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: Defaults.KEEPALIVE_INTERVAL_MINUTES });

  await chrome.alarms.clear(SESSION_HEALTH_CHECK_ALARM);
  await chrome.alarms.create(SESSION_HEALTH_CHECK_ALARM, {
    periodInMinutes: Defaults.SESSION_HEALTH_CHECK_INTERVAL_MS / 60000,
  });
};

export { setupAlarms, KEEPALIVE_ALARM, SESSION_HEALTH_CHECK_ALARM };
