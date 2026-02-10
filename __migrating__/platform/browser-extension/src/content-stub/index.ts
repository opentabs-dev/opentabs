/**
 * Content Stub - Minimal ISOLATED world script for chrome API access
 *
 * This script handles only the chrome-specific functionality that requires
 * the ISOLATED world (chrome.runtime access). All actual API logic is in
 * the MAIN world adapters.
 *
 * Responsibilities:
 * - Respond to PING health checks from background
 * - Send TAB_READY notification when the page loads
 * - Handle visibility changes to re-announce ready state
 */

import { MessageTypes, getServiceTypeFromHostname } from '@opentabs/core';

// Detect which service this tab is for
const serviceType = getServiceTypeFromHostname(window.location.hostname);
if (!serviceType) {
  console.warn('[OpenTabs Stub] Unknown service for hostname:', window.location.hostname);
}

// Track if the extension context has been invalidated
let extensionContextValid = true;

/**
 * Check if chrome.runtime is available
 */
const isChromeRuntimeAvailable = (): boolean => {
  try {
    return typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined' && !!chrome.runtime.id;
  } catch {
    return false;
  }
};

/**
 * Check if error is due to extension context invalidation
 */
const isExtensionContextInvalidated = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return (
    msg.includes('Extension context invalidated') ||
    msg.includes('Receiving end does not exist') ||
    msg.includes('message port closed')
  );
};

/**
 * Safely call chrome APIs that might fail if context is invalidated
 */
const safeChromeCall = async <T>(fn: () => Promise<T>): Promise<T | null> => {
  if (!extensionContextValid || !isChromeRuntimeAvailable()) return null;
  try {
    return await fn();
  } catch (err) {
    if (isExtensionContextInvalidated(err)) {
      extensionContextValid = false;
      return null;
    }
    if (err instanceof TypeError && String(err).includes('Cannot read properties of undefined')) {
      extensionContextValid = false;
      return null;
    }
    throw err;
  }
};

/**
 * Send TAB_READY notification to background
 */
const sendTabReady = (): void => {
  if (!extensionContextValid || !isChromeRuntimeAvailable() || !serviceType) return;

  safeChromeCall(() =>
    chrome.runtime.sendMessage({
      type: MessageTypes.TAB_READY,
      serviceId: serviceType,
    }),
  ).catch(() => {
    // Ignore errors - extension might be reloading
  });
};

/**
 * Handle messages from background script
 */
if (isChromeRuntimeAvailable()) {
  chrome.runtime.onMessage.addListener((message: { type: string }, _sender, sendResponse) => {
    // Handle health check ping
    if (message.type === MessageTypes.PING) {
      sendResponse({ type: MessageTypes.PONG });
      return true;
    }

    // Handle GET_TAB_STATUS for tab discovery
    if (message.type === MessageTypes.GET_TAB_STATUS) {
      sendResponse({ serviceId: serviceType });
      return true;
    }

    return false;
  });
}

/**
 * Initialize the stub
 */
const initialize = async (): Promise<void> => {
  console.log('[OpenTabs Stub] Content stub loaded for:', serviceType);

  // Wait for page to be ready
  if (document.readyState !== 'complete') {
    await new Promise<void>(resolve => {
      window.addEventListener('load', () => resolve(), { once: true });
    });
  }

  // Send initial TAB_READY
  sendTabReady();

  // Re-send TAB_READY when tab becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('[OpenTabs Stub] Tab became visible, re-sending TAB_READY');
      sendTabReady();
    }
  });
};

initialize().catch(err => {
  if (!isExtensionContextInvalidated(err)) {
    console.error('[OpenTabs Stub] Initialization error:', err);
  }
});
