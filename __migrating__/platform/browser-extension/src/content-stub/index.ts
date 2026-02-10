/**
 * Content Stub - Minimal ISOLATED world script for chrome API access
 *
 * This script handles only the chrome-specific functionality that requires
 * the ISOLATED world (chrome.runtime access). All actual API logic is in
 * the MAIN world adapters (injected dynamically by the adapter manager).
 *
 * Responsibilities:
 * - Respond to PING health checks from background
 * - Send TAB_READY notification when the page loads
 * - Handle visibility changes to re-announce ready state
 *
 * Service Type Resolution:
 * The content stub needs to know which service (plugin) this tab belongs
 * to so it can include the serviceId in TAB_READY messages. It uses two
 * strategies:
 *
 * 1. **Registry lookup** — If the service registry is populated (e.g.
 *    build-time plugins or registry already initialized), use
 *    getServiceTypeFromHostname() for an instant local match.
 *
 * 2. **Background query** — If the registry is empty (the common case
 *    with fully dynamic plugins), ask the background script to match
 *    the hostname against the plugin store. The background script has
 *    the full plugin manifest data in chrome.storage.local.
 *
 * This dual strategy ensures the content stub works both with the legacy
 * build-time approach and the new dynamic plugin installation flow.
 */

import { MessageTypes, getServiceTypeFromHostname, getServiceRegistry } from '@opentabs/core';

// Track if the extension context has been invalidated
let extensionContextValid = true;

// The resolved service type for this tab (may be set asynchronously)
let serviceType: string | undefined;

// Whether we've finished resolving the service type
let serviceTypeResolved = false;

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
 * Resolve the service type for this tab.
 *
 * First tries the local service registry (fast path for build-time plugins
 * or when the registry has already been populated). If the registry is
 * empty or has no match, queries the background script, which matches
 * the hostname against plugin data stored in chrome.storage.local.
 */
const resolveServiceType = async (): Promise<string | undefined> => {
  const hostname = window.location.hostname;

  // Strategy 1: Local registry lookup (instant, no async)
  const registry = getServiceRegistry();
  if (registry.length > 0) {
    const localMatch = getServiceTypeFromHostname(hostname);
    if (localMatch) {
      return localMatch;
    }
  }

  // Strategy 2: Ask the background script to match against plugin store.
  // The background script has full access to chrome.storage.local where
  // dynamically installed plugin manifests and URL patterns are stored.
  if (!isChromeRuntimeAvailable()) return undefined;

  try {
    const response = await safeChromeCall(() =>
      chrome.runtime.sendMessage({
        type: 'resolve_service_type',
        hostname,
        url: window.location.href,
      }),
    );

    if (response && typeof response === 'object' && 'serviceType' in response) {
      return (response as { serviceType: string | undefined }).serviceType;
    }
  } catch {
    // Background script may not be ready yet or doesn't handle this message.
    // Fall through — the tab will retry via TAB_READY when the content stub
    // re-announces on visibility change.
  }

  // Strategy 3: If both failed, try deriving from the hostname directly.
  // Some pages may have loaded before the plugin was installed. The
  // background script's tab event handlers will inject the adapter and
  // send the service type when the plugin becomes available.
  return undefined;
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

    // Handle GET_TAB_STATUS for tab discovery.
    // Returns the resolved service type so the background script knows
    // which service controller should manage this tab.
    if (message.type === MessageTypes.GET_TAB_STATUS) {
      if (serviceTypeResolved && serviceType) {
        sendResponse({ serviceId: serviceType });
      } else {
        // Service type not resolved yet — resolve now and respond async
        resolveServiceType()
          .then(resolved => {
            serviceType = resolved;
            serviceTypeResolved = true;
            sendResponse({ serviceId: serviceType });
          })
          .catch(() => {
            sendResponse({ serviceId: undefined });
          });
        return true; // Indicate async response
      }
      return true;
    }

    return false;
  });
}

/**
 * Initialize the stub
 */
const initialize = async (): Promise<void> => {
  // Resolve service type (may be sync or async depending on registry state)
  serviceType = await resolveServiceType();
  serviceTypeResolved = true;

  if (!serviceType) {
    // No matching plugin for this hostname. This is normal for tabs that
    // don't correspond to any installed plugin. The content stub stays
    // loaded but inert — it still responds to PING for stale tab detection.
    return;
  }

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
      // Re-resolve service type in case a plugin was installed while the
      // tab was in the background
      if (!serviceType) {
        resolveServiceType()
          .then(resolved => {
            if (resolved) {
              serviceType = resolved;
              console.log('[OpenTabs Stub] Service type resolved on visibility change:', serviceType);
              sendTabReady();
            }
          })
          .catch(() => {
            // Ignore — will retry on next visibility change
          });
      } else {
        sendTabReady();
      }
    }
  });
};

initialize().catch(err => {
  if (!isExtensionContextInvalidated(err)) {
    console.error('[OpenTabs Stub] Initialization error:', err);
  }
});
