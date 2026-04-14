import { toErrorMessage } from '@opentabs-dev/shared';
import { CDP_VERSION } from '../constants.js';
import { isCapturing } from '../network-capture.js';
import { sanitizeErrorMessage } from '../sanitize-error.js';
import { isEmulating } from './emulation-commands.js';
import { requireTabId, sendErrorResult, sendSuccessResult } from './helpers.js';
import { isIntercepting } from './interception-commands.js';

/** Preset network condition profiles matching Chrome DevTools defaults. */
const PRESETS: Record<
  string,
  { offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number }
> = {
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  'slow-3g': { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 },
  '3g': { offline: false, latency: 100, downloadThroughput: 750000, uploadThroughput: 250000 },
  '4g': { offline: false, latency: 20, downloadThroughput: 4000000, uploadThroughput: 3000000 },
  wifi: { offline: false, latency: 2, downloadThroughput: 30000000, uploadThroughput: 15000000 },
};

/** Per-tab throttle state tracking. Throttling persists while the debugger is attached. */
const throttlingTabs = new Set<number>();

/** Check whether throttling is active for a tab */
export const isThrottling = (tabId: number): boolean => throttlingTabs.has(tabId);

/** Clean up throttle state for a tab (called when tab is closed or debugger detaches) */
export const cleanupThrottle = (tabId: number): void => {
  throttlingTabs.delete(tabId);
};

/**
 * Attach the debugger for throttling if not already attached by another feature.
 * Keeps the debugger attached because throttling persists only while the debugger session is active.
 */
const ensureDebuggerAttached = async (tabId: number): Promise<void> => {
  const alreadyAttached = isCapturing(tabId) || isIntercepting(tabId) || isEmulating(tabId) || isThrottling(tabId);
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
};

export const handleBrowserThrottleNetwork = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;

    const presetName = typeof params.preset === 'string' ? params.preset : undefined;
    const preset = presetName ? PRESETS[presetName] : undefined;

    if (presetName && !preset) {
      sendErrorResult(
        id,
        new Error(`Unknown preset: ${presetName}. Valid presets: ${Object.keys(PRESETS).join(', ')}`),
      );
      return;
    }

    const conditions = preset ?? {
      offline: false,
      latency: typeof params.latency === 'number' ? params.latency : 0,
      downloadThroughput: typeof params.downloadThroughput === 'number' ? params.downloadThroughput : -1,
      uploadThroughput: typeof params.uploadThroughput === 'number' ? params.uploadThroughput : -1,
    };

    await ensureDebuggerAttached(tabId);
    throttlingTabs.add(tabId);

    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Network.emulateNetworkConditions', conditions);

    sendSuccessResult(id, {
      throttled: true,
      tabId,
      ...(presetName ? { preset: presetName } : {}),
      ...conditions,
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserClearNetworkThrottle = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;

    // Disable throttling by setting throughput to -1 (unlimited)
    await chrome.debugger
      .sendCommand({ tabId }, 'Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })
      .catch(() => {});

    throttlingTabs.delete(tabId);

    // Detach debugger if no other features are using it
    if (!isCapturing(tabId) && !isIntercepting(tabId) && !isEmulating(tabId)) {
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }

    sendSuccessResult(id, { cleared: true, tabId });
  } catch (err) {
    sendErrorResult(id, err);
  }
};
