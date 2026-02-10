/**
 * State Persistence
 *
 * Saves and restores per-service connection state to chrome.storage.session,
 * so connection status survives service worker restarts.
 */

import { getServiceIds } from '@opentabs/core';
import type { ServiceManager } from './service-managers/types.js';
import type { ConnectionStatus } from '@opentabs/core';

/**
 * Save current connection state (tab IDs and connected flags) to session storage.
 */
const saveConnectionState = async (
  managers: Record<string, ServiceManager>,
  connectionStatus: ConnectionStatus,
): Promise<void> => {
  const state: Record<string, unknown> = {};
  for (const serviceId of getServiceIds()) {
    const manager = managers[serviceId];
    if (manager) {
      state[`${serviceId}_tabId`] = manager.getTabId();
      state[`${serviceId}_connected`] = connectionStatus.services[serviceId]?.connected ?? false;
    }
  }
  await chrome.storage.session.set(state);
};

/**
 * Restore connection status flags from session storage.
 * Tab IDs are not restored — they are re-discovered by findTabs.
 */
const restoreConnectionState = async (connectionStatus: ConnectionStatus): Promise<void> => {
  try {
    const serviceIds = getServiceIds();
    const keys = serviceIds.map(id => `${id}_connected`);
    const stored = await chrome.storage.session.get(keys);

    for (const serviceId of serviceIds) {
      const value = stored[`${serviceId}_connected`];
      if (value !== undefined) {
        const status = connectionStatus.services[serviceId];
        if (status) {
          Object.assign(status, { connected: (value as boolean) ?? false });
        }
      }
    }
  } catch {
    // Session storage may not be available in all contexts
  }
};

export { saveConnectionState, restoreConnectionState };
