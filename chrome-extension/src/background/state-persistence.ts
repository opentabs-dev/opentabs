/**
 * State Persistence
 *
 * Saves and restores per-service connection state to chrome.storage.session,
 * so connection status survives service worker restarts.
 */

import { SERVICE_IDS } from '@extension/shared';
import type { ServiceManager } from './service-managers/types';
import type { ConnectionStatus, ServiceId } from '@extension/shared';

/**
 * Save current connection state (tab IDs and connected flags) to session storage.
 */
const saveConnectionState = async (
  managers: Record<ServiceId, ServiceManager>,
  connectionStatus: ConnectionStatus,
): Promise<void> => {
  const state: Record<string, unknown> = {};
  for (const serviceId of SERVICE_IDS) {
    state[`${serviceId}_tabId`] = managers[serviceId].getTabId();
    state[`${serviceId}_connected`] = connectionStatus.services[serviceId].connected;
  }
  await chrome.storage.session.set(state);
};

/**
 * Restore connection status flags from session storage.
 * Tab IDs are not restored — they are re-discovered by findTabs.
 */
const restoreConnectionState = async (connectionStatus: ConnectionStatus): Promise<void> => {
  try {
    const keys = SERVICE_IDS.map(id => `${id}_connected`);
    const stored = await chrome.storage.session.get(keys);

    for (const serviceId of SERVICE_IDS) {
      const value = stored[`${serviceId}_connected`];
      if (value !== undefined) {
        connectionStatus.services[serviceId].connected = (value as boolean) ?? false;
      }
    }
  } catch {
    // Session storage may not be available in all contexts
  }
};

export { saveConnectionState, restoreConnectionState };
