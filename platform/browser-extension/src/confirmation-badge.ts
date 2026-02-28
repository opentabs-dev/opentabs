/** Pending confirmation count for badge tracking */
let pendingConfirmationCount = 0;

/**
 * Background-side timeouts keyed by confirmation id. When the side panel is
 * closed, it never sends sp:confirmationResponse or sp:confirmationTimeout, so
 * the badge count would stay elevated permanently. These timeouts fire slightly
 * after the server-side confirmation expires to auto-clear the badge.
 */
const confirmationTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

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
 * Show badge and Chrome notification when a confirmation request arrives.
 * The badge count persists until confirmations are resolved via clearConfirmationBadge().
 * Sets a background timeout so the badge clears automatically if the side panel
 * is closed and never sends sp:confirmationResponse or sp:confirmationTimeout.
 */
const notifyConfirmationRequest = (params: Record<string, unknown>): void => {
  const tool = typeof params.tool === 'string' ? params.tool : 'unknown tool';
  const domain = typeof params.domain === 'string' ? params.domain : 'unknown domain';
  const id = typeof params.id === 'string' ? params.id : String(Date.now());
  const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : 0;

  // If this id already has a pending timeout, clear it and don't increment the
  // count — the count was already incremented when the first request arrived.
  const existingTimeoutId = confirmationTimeouts.get(id);
  if (existingTimeoutId !== undefined) {
    clearTimeout(existingTimeoutId);
  } else {
    pendingConfirmationCount++;
    updateConfirmationBadge();
  }

  // Set a background timeout slightly longer than the server-side timeout so
  // the badge clears automatically when the side panel is closed and cannot
  // send sp:confirmationResponse or sp:confirmationTimeout. Uses a fallback
  // when the server omits or sends timeoutMs=0.
  const effectiveTimeoutMs = timeoutMs > 0 ? timeoutMs : CONFIRMATION_FALLBACK_TIMEOUT_MS;
  const bgTimeoutId = setTimeout(() => {
    confirmationTimeouts.delete(id);
    clearConfirmationBadge(id);
  }, effectiveTimeoutMs + CONFIRMATION_BACKGROUND_TIMEOUT_BUFFER_MS);
  confirmationTimeouts.set(id, bgTimeoutId);

  chrome.notifications
    .create(`opentabs-confirm-${id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'OpenTabs: Approval Required',
      message: `${tool} on ${domain} — Click to open side panel`,
      priority: 2,
      requireInteraction: true,
    })
    .catch(() => {});
};

/**
 * Decrement pending confirmation count, update badge, and clear the Chrome
 * notification for the resolved confirmation.
 */
const clearConfirmationBadge = (id?: string): void => {
  if (id !== undefined) {
    chrome.notifications.clear(`opentabs-confirm-${id}`).catch(() => {});
  }
  pendingConfirmationCount = Math.max(0, pendingConfirmationCount - 1);
  updateConfirmationBadge();
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
  }
};

/** Reset all pending confirmation tracking and clear all Chrome notifications (e.g., on disconnect) */
const clearAllConfirmationBadges = (): void => {
  for (const [id, timeoutId] of confirmationTimeouts.entries()) {
    clearTimeout(timeoutId);
    chrome.notifications.clear(`opentabs-confirm-${id}`).catch(() => {});
  }
  confirmationTimeouts.clear();
  pendingConfirmationCount = 0;
  updateConfirmationBadge();
};

/**
 * Register the chrome.notifications.onClicked listener that opens the side
 * panel when the user clicks a confirmation notification. Call this once
 * at startup (e.g., from background.ts) to avoid side effects at import time.
 */
const initConfirmationBadge = (): void => {
  chrome.notifications.onClicked.addListener(notificationId => {
    if (notificationId.startsWith('opentabs-confirm-')) {
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
