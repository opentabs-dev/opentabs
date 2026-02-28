// Side panel toggle — manages per-window open state and toggles the side panel
// via the action click handler. The onOpened/onClosed events and close() method
// require Chrome 141+. On older versions (114–140), the toggle-to-close behavior
// is unavailable and the action click always opens the side panel.

const openWindows = new Set<number>();

/** Initialize side panel toggle behavior and register Chrome event listeners */
export const initSidePanelToggle = (): void => {
  // Take manual control of the side panel so we can open/close it on action click.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

  // Chrome 141+ — track open/close state per window for toggle behavior.
  // On older Chrome (114–140), these APIs are undefined; openWindows stays
  // empty and the action click always opens the side panel.
  const canToggle = 'onOpened' in chrome.sidePanel;

  if (canToggle) {
    chrome.sidePanel.onOpened.addListener(({ windowId }) => {
      openWindows.add(windowId);
    });

    chrome.sidePanel.onClosed.addListener(({ windowId }) => {
      openWindows.delete(windowId);
    });

    chrome.windows.onRemoved.addListener(windowId => {
      openWindows.delete(windowId);
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
