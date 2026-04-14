import { sendErrorResult, sendSuccessResult } from './helpers.js';

/** Map from notification ID to the URL to open on click */
const notificationUrls = new Map<string, string>();

/** Handle browser.showNotification: create a Chrome desktop notification */
export const handleBrowserShowNotification = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const title = typeof params.title === 'string' ? params.title : '';
    const message = typeof params.message === 'string' ? params.message : '';
    const iconUrl = typeof params.iconUrl === 'string' ? params.iconUrl : chrome.runtime.getURL('icons/icon-128.png');
    const requireInteraction = typeof params.requireInteraction === 'boolean' ? params.requireInteraction : false;
    const contextMessage = typeof params.contextMessage === 'string' ? params.contextMessage : undefined;
    const url = typeof params.url === 'string' ? params.url : undefined;

    const notificationId = `opentabs-notify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl,
      title,
      message,
      ...(contextMessage !== undefined ? { contextMessage } : {}),
      priority: 1,
      requireInteraction,
    });

    if (url) {
      notificationUrls.set(notificationId, url);
    }

    sendSuccessResult(id, { notificationId });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Register a chrome.notifications.onClicked listener for notifications created
 * by handleBrowserShowNotification. Only handles notifications with the
 * 'opentabs-notify-' prefix so the confirmation-badge listener is unaffected.
 * Call once at startup from background.ts.
 */
export const initNotificationClickHandler = (): void => {
  chrome.notifications.onClicked.addListener(notificationId => {
    if (!notificationId.startsWith('opentabs-notify-')) return;

    const url = notificationUrls.get(notificationId);
    notificationUrls.delete(notificationId);

    if (url) {
      chrome.tabs.create({ url }).catch(() => {});
    } else {
      chrome.windows
        .getCurrent()
        .then(w => {
          if (w.id !== undefined) {
            chrome.sidePanel.open({ windowId: w.id }).catch(() => {});
          }
        })
        .catch(() => {});
    }

    chrome.notifications.clear(notificationId).catch(() => {});
  });
};

export { notificationUrls as _notificationUrlsForTesting };
