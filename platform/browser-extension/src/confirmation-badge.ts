import { isSidePanelOpen } from './side-panel-toggle.js';

/** Full params stored for each pending confirmation request */
interface PendingConfirmationParams {
  id: string;
  tool: string;
  plugin: string;
  params: Record<string, unknown>;
  /** Timestamp (Date.now()) when the background received the confirmation request */
  receivedAt: number;
}

/** Single notification ID for the consolidated confirmation notification */
const NOTIFICATION_ID = 'opentabs-confirmation';

/** Full confirmation params for each pending confirmation, keyed by confirmation id */
const pendingConfirmations = new Map<string, PendingConfirmationParams>();

/** Update the extension badge to show pending confirmation count */
const updateConfirmationBadge = (): void => {
  if (pendingConfirmations.size > 0) {
    chrome.action.setBadgeText({ text: String(pendingConfirmations.size) }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#ffdb33' }).catch(() => {});
  } else {
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
  }
};

/**
 * Sync the Chrome desktop notification with the current confirmation state.
 * Shows a single consolidated notification — tool info for 1 pending, count
 * for multiple. Clears the notification when no confirmations are pending or
 * the side panel is open (the dialog is already visible).
 */
const syncConfirmationNotification = (): void => {
  if (pendingConfirmations.size === 0 || isSidePanelOpen()) {
    chrome.notifications.clear(NOTIFICATION_ID).catch(() => {});
    return;
  }

  let message: string;
  if (pendingConfirmations.size === 1) {
    const info = pendingConfirmations.values().next().value as PendingConfirmationParams;
    message = `${info.plugin}: ${info.tool}`;
  } else {
    message = `${pendingConfirmations.size} tools awaiting approval`;
  }

  chrome.notifications
    .create(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'OpenTabs \u2014 Approval Required',
      message,
      priority: 2,
      requireInteraction: true,
    })
    .catch(() => {});
};

/**
 * Show badge and Chrome notification when a confirmation request arrives.
 * The badge count persists until confirmations are resolved via clearConfirmationBadge().
 */
const notifyConfirmationRequest = (params: Record<string, unknown>): void => {
  const tool = typeof params.tool === 'string' ? params.tool : 'unknown tool';
  const plugin = typeof params.plugin === 'string' ? params.plugin : 'unknown';
  const id = typeof params.id === 'string' ? params.id : String(Date.now());
  const rawParams =
    typeof params.params === 'object' && params.params !== null ? (params.params as Record<string, unknown>) : {};
  const receivedAt = Date.now();

  // Duplicate id — update the stored params but don't increment the count
  if (pendingConfirmations.has(id)) {
    pendingConfirmations.set(id, { id, tool, plugin, params: rawParams, receivedAt });
    syncConfirmationNotification();
    return;
  }

  pendingConfirmations.set(id, { id, tool, plugin, params: rawParams, receivedAt });
  updateConfirmationBadge();

  syncConfirmationNotification();
};

/**
 * Remove a pending confirmation by id, update badge, and sync the Chrome
 * notification. No-op when id is undefined or not found in the pending map.
 */
const clearConfirmationBadge = (id?: string): void => {
  if (id === undefined || !pendingConfirmations.has(id)) {
    return;
  }
  pendingConfirmations.delete(id);
  updateConfirmationBadge();
  syncConfirmationNotification();
};

/** Reset all pending confirmation tracking and clear the notification (e.g., on disconnect) */
const clearAllConfirmationBadges = (): void => {
  pendingConfirmations.clear();
  updateConfirmationBadge();
  chrome.notifications.clear(NOTIFICATION_ID).catch(() => {});
};

/**
 * Register the chrome.notifications.onClicked listener that opens the side
 * panel when the user clicks a confirmation notification. Call this once
 * at startup (e.g., from background.ts) to avoid side effects at import time.
 */
const initConfirmationBadge = (): void => {
  chrome.notifications.onClicked.addListener(notificationId => {
    if (notificationId === NOTIFICATION_ID) {
      chrome.windows
        .getCurrent()
        .then(w => {
          if (w.id !== undefined) {
            chrome.sidePanel.open({ windowId: w.id }).catch(() => {});
          }
        })
        .catch(() => {});
      chrome.notifications.clear(notificationId).catch(() => {});
    }
  });
};

/** Returns an array of all pending confirmation params */
const getPendingConfirmations = (): PendingConfirmationParams[] => [...pendingConfirmations.values()];

export type { PendingConfirmationParams };
export {
  clearAllConfirmationBadges,
  clearConfirmationBadge,
  getPendingConfirmations,
  initConfirmationBadge,
  notifyConfirmationRequest,
};
