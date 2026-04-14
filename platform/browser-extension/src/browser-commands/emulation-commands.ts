import { toErrorMessage } from '@opentabs-dev/shared';
import { CDP_VERSION } from '../constants.js';
import { isCapturing } from '../network-capture.js';
import { sanitizeErrorMessage } from '../sanitize-error.js';
import { requireTabId, sendErrorResult, sendSuccessResult } from './helpers.js';
import { isIntercepting } from './interception-commands.js';
import { isThrottling } from './throttle-commands.js';

/** Per-tab emulation state tracking. Emulation persists while the debugger is attached. */
const emulatingTabs = new Set<number>();

/** Check whether emulation is active for a tab */
export const isEmulating = (tabId: number): boolean => emulatingTabs.has(tabId);

/** Clean up emulation state for a tab (called when tab is closed or debugger detaches) */
export const cleanupEmulation = (tabId: number): void => {
  emulatingTabs.delete(tabId);
};

/**
 * Attach the debugger for emulation if not already attached by another feature.
 * Unlike withDebugger (which detaches in finally), this keeps the debugger attached
 * because emulation state persists only while the debugger session is active.
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

export const handleBrowserEmulateDevice = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;

    await ensureDebuggerAttached(tabId);
    emulatingTabs.add(tabId);

    const width = typeof params.width === 'number' ? params.width : 375;
    const height = typeof params.height === 'number' ? params.height : 812;
    const deviceScaleFactor = typeof params.deviceScaleFactor === 'number' ? params.deviceScaleFactor : 1;
    const mobile = typeof params.mobile === 'boolean' ? params.mobile : false;

    await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile,
    });

    if (typeof params.userAgent === 'string') {
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.setUserAgentOverride', {
        userAgent: params.userAgent,
      });
    }

    sendSuccessResult(id, { emulated: true, tabId, width, height, mobile });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserSetGeolocation = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;

    await ensureDebuggerAttached(tabId);
    emulatingTabs.add(tabId);

    const latitude = typeof params.latitude === 'number' ? params.latitude : 0;
    const longitude = typeof params.longitude === 'number' ? params.longitude : 0;
    const accuracy = typeof params.accuracy === 'number' ? params.accuracy : 1;

    await chrome.debugger.sendCommand({ tabId }, 'Emulation.setGeolocationOverride', {
      latitude,
      longitude,
      accuracy,
    });

    sendSuccessResult(id, { geolocationSet: true, tabId, latitude, longitude, accuracy });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserSetMediaFeatures = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;

    const rawFeatures = Array.isArray(params.features) ? params.features : [];
    const features = rawFeatures
      .filter(
        (f): f is { name: string; value: string } =>
          typeof f === 'object' &&
          f !== null &&
          typeof (f as Record<string, unknown>).name === 'string' &&
          typeof (f as Record<string, unknown>).value === 'string',
      )
      .map(f => ({ name: f.name, value: f.value }));

    if (features.length === 0) {
      sendErrorResult(id, new Error('At least one valid media feature is required'));
      return;
    }

    await ensureDebuggerAttached(tabId);
    emulatingTabs.add(tabId);

    await chrome.debugger.sendCommand({ tabId }, 'Emulation.setEmulatedMedia', {
      features,
    });

    sendSuccessResult(id, { mediaFeaturesSet: true, tabId, features });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserEmulateVisionDeficiency = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;

    const validTypes = new Set(['none', 'blurredVision', 'deuteranopia', 'protanopia', 'tritanopia', 'achromatopsia']);
    const type = typeof params.type === 'string' && validTypes.has(params.type) ? params.type : 'none';

    await ensureDebuggerAttached(tabId);
    emulatingTabs.add(tabId);

    await chrome.debugger.sendCommand({ tabId }, 'Emulation.setEmulatedVisionDeficiency', {
      type,
    });

    sendSuccessResult(id, { visionDeficiencySet: true, tabId, type });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserClearEmulation = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;

    // Clear all emulation overrides — best-effort for each, so one failure
    // doesn't prevent clearing the others
    const clearOps = [
      chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride').catch(() => {}),
      chrome.debugger.sendCommand({ tabId }, 'Emulation.clearGeolocationOverride').catch(() => {}),
      chrome.debugger.sendCommand({ tabId }, 'Emulation.setEmulatedMedia', { features: [] }).catch(() => {}),
      chrome.debugger.sendCommand({ tabId }, 'Emulation.setEmulatedVisionDeficiency', { type: 'none' }).catch(() => {}),
      chrome.debugger.sendCommand({ tabId }, 'Emulation.setUserAgentOverride', { userAgent: '' }).catch(() => {}),
    ];

    await Promise.all(clearOps);

    emulatingTabs.delete(tabId);

    // Detach debugger if no other features are using it
    if (!isCapturing(tabId) && !isIntercepting(tabId) && !isThrottling(tabId)) {
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }

    sendSuccessResult(id, { cleared: true, tabId });
  } catch (err) {
    sendErrorResult(id, err);
  }
};
