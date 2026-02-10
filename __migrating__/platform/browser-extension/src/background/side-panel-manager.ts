/**
 * Side Panel Manager
 *
 * Tracks side panel open/close state per window and toggles the side panel
 * when the extension icon is clicked.
 *
 * Ported from chrome-extension/src/background/side-panel-manager.ts.
 * Key change: imports from @opentabs/core instead of @extension/shared.
 */

import { MessageTypes } from '@opentabs/core';

// Open state per window ID
const sidePanelOpenState = new Map<number, boolean>();

/**
 * Record that the side panel opened in a window.
 */
const markOpened = (windowId: number): void => {
  sidePanelOpenState.set(windowId, true);
};

/**
 * Record that the side panel closed in a window.
 */
const markClosed = (windowId: number): void => {
  sidePanelOpenState.set(windowId, false);
};

/**
 * Register the extension icon click handler that toggles the side panel,
 * and configure side panel behavior.
 */
const setupSidePanel = async (): Promise<void> => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

  chrome.action.onClicked.addListener(async tab => {
    if (!tab.windowId) return;

    const windowId = tab.windowId;
    const isCurrentlyOpen = sidePanelOpenState.get(windowId) ?? false;

    if (isCurrentlyOpen) {
      chrome.runtime.sendMessage({ type: MessageTypes.CLOSE_SIDE_PANEL }).catch(() => {
        // Side panel might already be closed
      });
      sidePanelOpenState.set(windowId, false);
    } else {
      try {
        await chrome.sidePanel.open({ windowId });
        sidePanelOpenState.set(windowId, true);
      } catch (err) {
        console.error('[OpenTabs] Failed to open side panel:', err);
      }
    }
  });
};

export { setupSidePanel, markOpened, markClosed };
