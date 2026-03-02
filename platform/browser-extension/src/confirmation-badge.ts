import { isSidePanelOpen } from './side-panel-toggle.js';

/** Pending confirmation count for badge tracking */
let pendingConfirmationCount = 0;

/** Single notification ID for the consolidated confirmation notification */
const NOTIFICATION_ID = 'opentabs-confirmation';

/** Tool/domain info for each pending confirmation, used for notification content */
const pendingConfirmationInfo = new Map<string, { tool: string; domain: string | null }>();

/**
 * Background-side timeouts keyed by confirmation id. When the side panel is
 * closed, it never sends sp:confirmationResponse or sp:confirmationTimeout, so
 * the badge count would stay elevated permanently. These timeouts fire slightly
 * after the server-side confirmation expires to auto-clear the badge.
 */
const confirmationTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Set of confirmation ids that have already been cleared. Used to make
 * clearConfirmationBadge idempotent per id — when both the background timeout
 * and the side panel's sp:confirmationTimeout fire for the same id, the count
 * decrements only once.
 */
const clearedConfirmationIds = new Set<string>();

/**
 * Extra buffer (ms) added on top of the server-provided timeoutMs so the
 * background timeout fires after the server has already expired the
 * confirmation. The side panel adds +1000 ms; we add +2000 ms to ensure
 * the background fires after the side panel would have timed out.
 */
const CONFIRMATION_BACKGROUND_TIMEOUT_BUFFER_MS = 2000;

/**
 * Fallback timeout (ms) used when the server sends timeoutMs=0 or omits it.
 * Ensures the badge always self-clears even if no explicit timeout was provided.
 */
const CONFIRMATION_FALLBACK_TIMEOUT_MS = 30_000;

/** Update the extension badge to show pending confirmation count */
const updateConfirmationBadge = (): void => {
  if (pendingConfirmationCount > 0) {
    chrome.action.setBadgeText({ text: String(pendingConfirmationCount) }).catch(() => {});
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
  if (pendingConfirmationCount <= 0 || isSidePanelOpen()) {
    chrome.notifications.clear(NOTIFICATION_ID).catch(() => {});
    return;
  }

  let message: string;
  if (pendingConfirmationCount === 1 && pendingConfirmationInfo.size === 1) {
    const info = pendingConfirmationInfo.values().next().value as { tool: string; domain: string | null };
    message = info.domain ? `${info.tool} on ${info.domain}` : info.tool;
  } else if (pendingConfirmationCount > 1) {
    message = `${pendingConfirmationCount} tools awaiting approval`;
  } else {
    message = '1 tool awaiting approval';
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
 * Sets a background timeout so the badge clears automatically if the side panel
 * is closed and never sends sp:confirmationResponse or sp:confirmationTimeout.
 */
const notifyConfirmationRequest = (params: Record<string, unknown>): void => {
  const tool = typeof params.tool === 'string' ? params.tool : 'unknown tool';
  const domain = typeof params.domain === 'string' ? params.domain : null;
  const id = typeof params.id === 'string' ? params.id : String(Date.now());
  const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : 0;

  // If this id already has a pending timeout, clear it and don't increment the
  // count — the count was already incremented when the first request arrived.
  const existingTimeoutId = confirmationTimeouts.get(id);
  if (existingTimeoutId !== undefined) {
    clearTimeout(existingTimeoutId);
  } else {
    // New confirmation id (or a re-used id after a previous one timed out).
    // Remove from the cleared set so clearConfirmationBadge can decrement again.
    clearedConfirmationIds.delete(id);
    pendingConfirmationCount++;
    updateConfirmationBadge();
  }

  pendingConfirmationInfo.set(id, { tool, domain });

  // Set a background timeout slightly longer than the server-side timeout so
  // the badge clears automatically when the side panel is closed and cannot
  // send sp:confirmationResponse or sp:confirmationTimeout. Uses a fallback
  // when the server omits or sends timeoutMs=0.
  const effectiveTimeoutMs = timeoutMs > 0 ? timeoutMs : CONFIRMATION_FALLBACK_TIMEOUT_MS;
  const bgTimeoutId = setTimeout(() => {
    confirmationTimeouts.delete(id);
    clearConfirmationBadge(id);
    // Prune the id now that the timeout has fired — the entry is no longer
    // needed for idempotency because the background timeout can only fire once.
    clearedConfirmationIds.delete(id);
  }, effectiveTimeoutMs + CONFIRMATION_BACKGROUND_TIMEOUT_BUFFER_MS);
  confirmationTimeouts.set(id, bgTimeoutId);

  syncConfirmationNotification();
};

/**
 * Decrement pending confirmation count, update badge, and sync the Chrome
 * notification for the resolved confirmation.
 *
 * When an id is provided, this function is idempotent — calling it twice with
 * the same id decrements the count only once. This prevents double-decrements
 * when both the background timeout and the side panel's sp:confirmationTimeout
 * fire for the same confirmation id.
 *
 * After decrementing, the id is pruned from clearedConfirmationIds if no
 * background timeout is pending for it. Without a pending timeout, no timeout
 * callback can race against this call, so the entry is no longer needed for
 * idempotency and keeping it would cause unbounded growth during long sessions.
 */
const clearConfirmationBadge = (id?: string): void => {
  if (id !== undefined) {
    if (clearedConfirmationIds.has(id)) {
      return;
    }
    clearedConfirmationIds.add(id);
    pendingConfirmationInfo.delete(id);
  }
  pendingConfirmationCount = Math.max(0, pendingConfirmationCount - 1);
  updateConfirmationBadge();
  syncConfirmationNotification();
  // Prune the id when no background timeout is pending — without a pending
  // timeout, no timeout callback can race, so the entry is no longer needed.
  if (id !== undefined && !confirmationTimeouts.has(id)) {
    clearedConfirmationIds.delete(id);
  }
};

/**
 * Clear the background timeout for a specific confirmation id.
 * Called when the side panel handles the confirmation first (via
 * sp:confirmationResponse or sp:confirmationTimeout), so the background
 * timeout does not double-clear the badge.
 */
const clearConfirmationBackgroundTimeout = (id: string): void => {
  const timeoutId = confirmationTimeouts.get(id);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
    confirmationTimeouts.delete(id);
    // Prune the id now that the background timeout is cancelled — it can no
    // longer fire, so the clearedConfirmationIds entry serves no purpose.
    clearedConfirmationIds.delete(id);
  }
};

/** Reset all pending confirmation tracking and clear the notification (e.g., on disconnect) */
const clearAllConfirmationBadges = (): void => {
  for (const [, timeoutId] of confirmationTimeouts.entries()) {
    clearTimeout(timeoutId);
  }
  confirmationTimeouts.clear();
  clearedConfirmationIds.clear();
  pendingConfirmationInfo.clear();
  pendingConfirmationCount = 0;
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

export {
  notifyConfirmationRequest,
  clearConfirmationBadge,
  clearConfirmationBackgroundTimeout,
  clearAllConfirmationBadges,
  initConfirmationBadge,
};
