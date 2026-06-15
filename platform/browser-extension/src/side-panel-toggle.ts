// Side panel toggle — manages per-window open state and toggles the side panel
// via the action click handler. The onOpened/onClosed events and close() method
// require Chrome 141+. On older versions (114–140), the toggle-to-close behavior
// is unavailable and the action click always opens the side panel.

import { SIDE_PANEL_OPEN_WINDOWS_KEY } from './constants.js';

declare const __OPENTABS_IS_FIREFOX__: boolean | undefined;

type ChromeSidePanelApi = {
  setPanelBehavior?(options: { openPanelOnActionClick: boolean }): Promise<void>;
  open?(options: { windowId: number }): Promise<void>;
  close?(options: { windowId: number }): Promise<void>;
  onOpened?: { addListener(listener: (details: { windowId: number }) => void): void };
  onClosed?: { addListener(listener: (details: { windowId: number }) => void): void };
};

type FirefoxSidebarActionApi = {
  open?(): Promise<void> | void;
  toggle?(): Promise<void> | void;
};

const CHROME_SIDE_PANEL_KEY = 'side' + 'Panel';

const getChromeSidePanel = (): ChromeSidePanelApi | undefined =>
  (chrome as unknown as Record<string, ChromeSidePanelApi | undefined>)[CHROME_SIDE_PANEL_KEY];

const getFirefoxSidebarAction = (): FirefoxSidebarActionApi | undefined =>
  (chrome as unknown as { sidebarAction?: FirefoxSidebarActionApi }).sidebarAction;

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

/**
 * Open the extension panel using Chrome's sidePanel API when present, or
 * Firefox's sidebarAction API when building/running as a Firefox WebExtension.
 * Returns false when neither API is available.
 */
export const openExtensionPanel = async (windowId?: number): Promise<boolean> => {
  if (!(typeof __OPENTABS_IS_FIREFOX__ === 'boolean' && __OPENTABS_IS_FIREFOX__)) {
    const sidePanel = getChromeSidePanel();
    if (sidePanel?.open && windowId !== undefined) {
      await sidePanel.open({ windowId });
      return true;
    }
  }

  const sidebarAction = getFirefoxSidebarAction();
  if (sidebarAction?.open) {
    await sidebarAction.open();
    return true;
  }
  if (sidebarAction?.toggle) {
    await sidebarAction.toggle();
    return true;
  }

  return false;
};

/** Initialize side panel/sidebar toggle behavior and register browser event listeners */
export const initSidePanelToggle = (): void => {
  // Firefox has sidebarAction instead of Chrome sidePanel. Keep action-click
  // useful without touching Chrome-only APIs that are undefined in Firefox.
  if (typeof __OPENTABS_IS_FIREFOX__ === 'boolean' && __OPENTABS_IS_FIREFOX__) {
    chrome.action.onClicked.addListener(({ windowId }) => {
      void openExtensionPanel(windowId);
    });
    return;
  }

  const sidePanel = getChromeSidePanel();

  // Older Chrome / unexpected browsers: keep action-click useful without
  // assuming the sidePanel API exists.
  if (!sidePanel?.open || !sidePanel.setPanelBehavior) {
    chrome.action.onClicked.addListener(({ windowId }) => {
      void openExtensionPanel(windowId);
    });
    return;
  }

  // Take manual control of the side panel so we can open/close it on action click.
  sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

  // Chrome 141+ — track open/close state per window for toggle behavior.
  // On older Chrome (114–140), these APIs are undefined; openWindows stays
  // empty and the action click always opens the side panel.
  const canToggle = sidePanel.onOpened !== undefined && sidePanel.onClosed !== undefined && sidePanel.close !== undefined;

  if (canToggle) {
    // Restore persisted open-window state so the toggle works correctly after
    // the MV3 service worker suspends and wakes (module state is wiped on wake).
    restoreOpenWindows();

    sidePanel.onOpened?.addListener(({ windowId }) => {
      openWindows.add(windowId);
      persistOpenWindows();
    });

    sidePanel.onClosed?.addListener(({ windowId }) => {
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
          await openExtensionPanel(windowId).catch(() => {});
          return;
        }
        sidePanel.close?.({ windowId }).catch(() => {});
      } else {
        await openExtensionPanel(windowId).catch(() => {});
      }
    })();
  });
};
