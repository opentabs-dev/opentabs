// =============================================================================
// Capture Content Script — Relay for MAIN World → Background (Static Variant)
//
// This content script runs in the ISOLATED world of tabs where capture mode
// is active. Its sole job is to listen for window.postMessage events from the
// MAIN world interceptor (injected by capture-handler.ts) and forward them
// to the background script via chrome.runtime.sendMessage.
//
// The MAIN world interceptor cannot call chrome.runtime.sendMessage directly
// because it runs in the page's JS context without access to Chrome extension
// APIs. This content script bridges that gap.
//
// Message flow:
//   Page MAIN world (interceptor patches fetch/XHR)
//     → window.postMessage({ type: '__opentabs_capture__', data: {...} })
//       → This content script (ISOLATED world, has chrome.runtime access)
//         → chrome.runtime.sendMessage({ type: 'capture_request', tabId, data })
//           → Background script → CaptureHandler.addRequest(tabId, data)
//
// NOTE: There are two ways to inject this relay:
//
// 1. **Inline injection (preferred)** — CaptureHandler.startCapture() injects
//    the `captureRelayScript` function via chrome.scripting.executeScript in
//    the ISOLATED world. This is self-contained in capture-handler.ts and
//    requires no separate file.
//
// 2. **Static file injection** — This file can be registered via
//    chrome.scripting.registerContentScripts with a file path. Useful if
//    the build system bundles content scripts as separate files rather than
//    inline functions.
//
// The inline approach (option 1) is currently used by CaptureHandler. This
// file is retained as the static variant for alternative build configurations
// or for registering via the manifest's content_scripts array.
// =============================================================================

// Listen for messages from the MAIN world interceptor
window.addEventListener('message', (event: MessageEvent) => {
  // Only accept messages from the same window (same frame origin)
  if (event.source !== window) return;

  // Only process our capture messages
  const message = event.data;
  if (typeof message !== 'object' || message === null || message.type !== '__opentabs_capture__') {
    return;
  }

  const data = message.data;
  if (typeof data !== 'object' || data === null) return;

  // Forward to the background script
  // The background script's message listener routes this to CaptureHandler.addRequest()
  try {
    chrome.runtime.sendMessage({
      type: 'capture_request',
      data,
    });
  } catch {
    // Extension context may be invalidated if the extension was reloaded
    // while capture was active. Silently ignore — the capture session
    // will be cleaned up when the tab lifecycle detects the stale state.
  }
});

// Signal that the relay is ready (useful for debugging in DevTools)
console.log('[OpenTabs] Capture relay content script loaded');
