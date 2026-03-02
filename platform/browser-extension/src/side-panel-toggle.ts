// Side panel toggle — manages per-window open state and toggles the side panel
// via the action click handler. The onOpened/onClosed events and close() method
// require Chrome 141+. On older versions (114–140), the toggle-to-close behavior
// is unavailable and the action click always opens the side panel.

import { SIDE_PANEL_OPEN_WINDOWS_KEY } from './constants.js';

const openWindows = new Set<number>();

/** Persist openWindows to chrome.storage.session (best-effort) */
const persistOpenWindows = (): void => {
  chrome.storage.session.set({ [SIDE_PANEL_OPEN_WINDOWS_KEY]: Array.from(openWindows) }).catch(() => {});
};

/**
 * Restore openWindows from chrome.storage.session on service worker wake.
 * Follows the same pattern as restoreWsConnectedState in background-message-handlers.ts.
 */
const restoreOpenWindows = (): void => {
  chrome.storage.session
    .get(SIDE_PANEL_OPEN_WINDOWS_KEY)
    .then(data => {
      const stored = data[SIDE_PANEL_OPEN_WINDOWS_KEY];
      if (Array.isArray(stored)) {
        for (const id of stored) {
          if (typeof id === 'number') {
            openWindows.add(id);
          }
        }
      }
    })
    .catch(() => {
      // storage.session may not be available in all contexts
    });
};

/**
 * Whether the side panel is open in any Chrome window. Returns true when at
 * least one window has the side panel visible (Chrome 141+ only — on older
 * Chrome, always returns false since onOpened/onClosed are unavailable).
 */
export const isSidePanelOpen = (): boolean => openWindows.size > 0;

/** Initialize side panel toggle behavior and register Chrome event listeners */
export const initSidePanelToggle = (): void => {
  // Take manual control of the side panel so we can open/close it on action click.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

  // Chrome 141+ — track open/close state per window for toggle behavior.
  // On older Chrome (114–140), these APIs are undefined; openWindows stays
  // empty and the action click always opens the side panel.
  const canToggle = 'onOpened' in chrome.sidePanel;

  if (canToggle) {
    // Restore persisted open-window state so the toggle works correctly after
    // the MV3 service worker suspends and wakes (module state is wiped on wake).
    restoreOpenWindows();

    chrome.sidePanel.onOpened.addListener(({ windowId }) => {
      openWindows.add(windowId);
      persistOpenWindows();
    });

    chrome.sidePanel.onClosed.addListener(({ windowId }) => {
      openWindows.delete(windowId);
      persistOpenWindows();
    });

    chrome.windows.onRemoved.addListener(windowId => {
      openWindows.delete(windowId);
      persistOpenWindows();
    });
  }

  chrome.action.onClicked.addListener(({ windowId }) => {
    void (async () => {
      if (canToggle && openWindows.has(windowId)) {
        // Validate the window still exists — MV3 service workers can be suspended
        // and miss chrome.windows.onRemoved, leaving stale IDs in openWindows.
        try {
          await chrome.windows.get(windowId);
        } catch {
          openWindows.delete(windowId);
          persistOpenWindows();
          await chrome.sidePanel.open({ windowId }).catch(() => {});
          return;
        }
        chrome.sidePanel.close({ windowId }).catch(() => {});
      } else {
        chrome.sidePanel.open({ windowId }).catch(() => {});
      }
    })();
  });
};
