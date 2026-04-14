import { toErrorMessage } from '@opentabs-dev/shared';
import { CDP_VERSION } from '../constants.js';
import { isCapturing } from '../network-capture.js';
import { sanitizeErrorMessage } from '../sanitize-error.js';
import { requireStringParam, requireTabId, sendErrorResult, sendSuccessResult } from './helpers.js';

/** Auto-continue timeout for paused requests (ms). Prevents page hangs. */
const AUTO_CONTINUE_TIMEOUT_MS = 30_000;

interface PausedRequest {
  requestId: string;
  url: string;
  method: string;
  timer: ReturnType<typeof setTimeout>;
}

/** Per-tab interception state: paused requests map and event listener reference */
interface InterceptionState {
  pausedRequests: Map<string, PausedRequest>;
}

/** Module-level map of active interception sessions, keyed by tabId */
const interceptions = new Map<number, InterceptionState>();

/** Check whether interception is active for a tab */
export const isIntercepting = (tabId: number): boolean => interceptions.has(tabId);

/** Clean up interception state for a tab (called when tab is closed or debugger detaches) */
export const cleanupInterception = (tabId: number): void => {
  const state = interceptions.get(tabId);
  if (state) {
    for (const paused of state.pausedRequests.values()) {
      clearTimeout(paused.timer);
    }
    state.pausedRequests.clear();
    interceptions.delete(tabId);
  }
};

/** Auto-continue a paused request that has not been handled within the timeout */
const autoContinueRequest = (tabId: number, requestId: string): void => {
  chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId }).catch(() => {});
  const state = interceptions.get(tabId);
  if (state) {
    state.pausedRequests.delete(requestId);
  }
};

export const handleBrowserInterceptRequests = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;

    if (interceptions.has(tabId)) {
      sendErrorResult(id, new Error('Interception already active for this tab. Call browser_stop_intercepting first.'));
      return;
    }

    const rawPatterns = Array.isArray(params.urlPatterns)
      ? (params.urlPatterns as unknown[]).filter((p): p is string => typeof p === 'string')
      : ['*'];

    const fetchPatterns = rawPatterns.map(p => ({ urlPattern: p, requestStage: 'Request' }));

    // Attach debugger if not already attached (e.g., by network capture)
    const alreadyAttached = isCapturing(tabId);
    if (!alreadyAttached) {
      try {
        await chrome.debugger.attach({ tabId }, CDP_VERSION);
      } catch (err) {
        const msg = toErrorMessage(err);
        throw new Error(
          msg.includes('Another debugger')
            ? 'Failed to attach debugger — another debugger (e.g., DevTools) is already attached. ' +
                'Close DevTools or enable network capture first (browser_enable_network_capture) ' +
                'so this tool can reuse the existing debugger session.'
            : `Failed to attach debugger: ${sanitizeErrorMessage(msg)}`,
        );
      }
    }

    const state: InterceptionState = {
      pausedRequests: new Map(),
    };
    interceptions.set(tabId, state);

    await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', { patterns: fetchPatterns });

    sendSuccessResult(id, { enabled: true, tabId });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserFulfillRequest = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const requestId = requireStringParam(params, 'requestId', id);
    if (requestId === null) return;

    const state = interceptions.get(tabId);
    if (!state) {
      sendErrorResult(id, new Error('No active interception for this tab. Call browser_intercept_requests first.'));
      return;
    }

    const status = typeof params.status === 'number' ? params.status : 200;
    const headers =
      typeof params.headers === 'object' && params.headers !== null && !Array.isArray(params.headers)
        ? Object.entries(params.headers as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([name, value]) => ({ name, value }))
        : undefined;
    const body = typeof params.body === 'string' ? btoa(params.body) : undefined;

    // Clear safety timeout for this request
    const paused = state.pausedRequests.get(requestId);
    if (paused) {
      clearTimeout(paused.timer);
      state.pausedRequests.delete(requestId);
    }

    await chrome.debugger.sendCommand({ tabId }, 'Fetch.fulfillRequest', {
      requestId,
      responseCode: status,
      ...(headers ? { responseHeaders: headers } : {}),
      ...(body !== undefined ? { body } : {}),
    });

    sendSuccessResult(id, { fulfilled: true, requestId });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserFailRequest = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const requestId = requireStringParam(params, 'requestId', id);
    if (requestId === null) return;

    const state = interceptions.get(tabId);
    if (!state) {
      sendErrorResult(id, new Error('No active interception for this tab. Call browser_intercept_requests first.'));
      return;
    }

    const errorReason = typeof params.errorReason === 'string' ? params.errorReason : 'Failed';

    // Clear safety timeout for this request
    const paused = state.pausedRequests.get(requestId);
    if (paused) {
      clearTimeout(paused.timer);
      state.pausedRequests.delete(requestId);
    }

    await chrome.debugger.sendCommand({ tabId }, 'Fetch.failRequest', {
      requestId,
      errorReason,
    });

    sendSuccessResult(id, { failed: true, requestId, errorReason });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserStopIntercepting = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;

    const state = interceptions.get(tabId);
    if (state) {
      // Clear all safety timeout timers
      for (const paused of state.pausedRequests.values()) {
        clearTimeout(paused.timer);
      }
      state.pausedRequests.clear();
      interceptions.delete(tabId);
    }

    // Disable Fetch domain — automatically continues any remaining paused requests
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Fetch.disable');
    } catch {
      // Debugger may already be detached
    }

    // Detach debugger if network capture is not active
    if (!isCapturing(tabId)) {
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }

    sendSuccessResult(id, { stopped: true, tabId });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Handle Fetch.requestPaused CDP events. Called from the chrome.debugger.onEvent
 * listener in background.ts (or wherever the global CDP event listener is registered).
 */
export const handleFetchRequestPaused = (
  source: chrome.debugger.Debuggee,
  eventParams: Record<string, unknown>,
): void => {
  const tabId = source.tabId;
  if (tabId === undefined) return;

  const state = interceptions.get(tabId);
  if (!state) return;

  const requestId = eventParams.requestId as string;
  const request = eventParams.request as { url: string; method: string } | undefined;

  const timer = setTimeout(() => autoContinueRequest(tabId, requestId), AUTO_CONTINUE_TIMEOUT_MS);

  state.pausedRequests.set(requestId, {
    requestId,
    url: request?.url ?? '',
    method: request?.method ?? 'GET',
    timer,
  });
};
