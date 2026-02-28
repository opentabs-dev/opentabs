import { CDP_VERSION } from './constants.js';
import { toErrorMessage } from '@opentabs-dev/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Maximum character length for request bodies before truncation. */
const MAX_BODY_LENGTH = 102_400;

/** How long a pending request entry lives before it is pruned as stale (ms). */
const PENDING_REQUEST_TTL_MS = 60_000;

/** How often the periodic pruning timer fires to remove stale entries during idle captures (ms). */
const PRUNE_INTERVAL_MS = 30_000;

/** How long a WebSocket entry lives in wsFramesByRequestId before being pruned as stale (ms).
 * WebSocket connections are typically long-lived, so a separate TTL longer than
 * PENDING_REQUEST_TTL_MS avoids pruning active connections. */
const WS_TTL_MS = 5 * 60_000;

/** Headers whose values are replaced with '[REDACTED]' before returning to MCP clients. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-xsrf-token',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-api-token',
  'www-authenticate',
]);

/**
 * Replace sensitive header values with '[REDACTED]', preserving keys.
 * For Authorization/Proxy-Authorization headers, the scheme prefix (e.g.,
 * "Basic", "Bearer") is preserved so downstream detection can distinguish
 * auth methods: "Bearer [REDACTED]" vs "Basic [REDACTED]".
 */
const scrubHeaders = (headers?: Record<string, string>): Record<string, string> | undefined => {
  if (!headers) return undefined;
  const scrubbed: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (!SENSITIVE_HEADERS.has(lower)) {
      scrubbed[k] = v;
    } else if (lower === 'authorization' || lower === 'proxy-authorization') {
      // Preserve the auth scheme (text before the first space) so that
      // detect-auth can tell Basic from Bearer without seeing credentials.
      const spaceIdx = v.indexOf(' ');
      scrubbed[k] = spaceIdx > 0 ? `${v.slice(0, spaceIdx)} [REDACTED]` : '[REDACTED]';
    } else {
      scrubbed[k] = '[REDACTED]';
    }
  }
  return scrubbed;
};

interface CapturedRequest {
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  mimeType?: string;
  timestamp: number;
}

interface ConsoleEntry {
  level: string;
  message: string;
  timestamp: number;
}

interface WsFrame {
  url: string;
  direction: 'sent' | 'received';
  data: string;
  opcode: number;
  timestamp: number;
}

interface CaptureState {
  requests: CapturedRequest[];
  consoleLogs: ConsoleEntry[];
  wsFrames: WsFrame[];
  maxRequests: number;
  maxConsoleLogs: number;
  maxWsFrames: number;
  urlFilter?: string;
  pendingRequests: Map<string, Partial<CapturedRequest>>;
  /** Maps requestId → CapturedRequest reference for attaching response bodies after loadingFinished */
  requestIdToRequest: Map<string, CapturedRequest>;
  /** Maps requestId → WebSocket URL from Network.webSocketCreated events */
  wsFramesByRequestId: Map<string, string>;
  /** Maps requestId → creation timestamp for WebSocket entries, used to prune stale wsFramesByRequestId entries */
  wsCreatedAt: Map<string, number>;
  /** Handle for the periodic stale-entry pruning interval; cleared in stopCapture */
  pruneIntervalId?: ReturnType<typeof setInterval>;
}

interface HeaderEntry {
  name: string;
  value?: string;
}

// ---------------------------------------------------------------------------
// Per-tab capture state
// ---------------------------------------------------------------------------

const captures = new Map<number, CaptureState>();

/** Tracks in-flight startCapture promises by tabId to serialize concurrent calls. */
const pendingCaptures = new Map<number, Promise<void>>();

// ---------------------------------------------------------------------------
// Chrome debugger event listener (registered once at module load)
// ---------------------------------------------------------------------------

/**
 * Convert Chrome DevTools Protocol headers (array of { name, value }) to a
 * plain Record. CDP sometimes sends headers as an object and sometimes as an
 * array depending on the event — handle both.
 */
const headersToRecord = (raw: unknown): Record<string, string> | undefined => {
  if (!raw) return undefined;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, string>;
  }
  if (Array.isArray(raw)) {
    const record: Record<string, string> = {};
    for (const entry of raw as HeaderEntry[]) {
      if (typeof entry.name === 'string') {
        record[entry.name] = entry.value !== undefined ? entry.value : '';
      }
    }
    return record;
  }
  return undefined;
};

/** Extract a string property from a Record<string, unknown>, defaulting to fallback. */
const stringProp = (obj: Record<string, unknown>, key: string, fallback: string): string => {
  const propertyValue = obj[key];
  return typeof propertyValue === 'string' ? propertyValue : fallback;
};

/** Truncate a string to MAX_BODY_LENGTH, appending a suffix if truncated. */
const truncateBody = (body: string): string =>
  body.length > MAX_BODY_LENGTH ? body.slice(0, MAX_BODY_LENGTH) + '... (truncated)' : body;

/**
 * Remove the oldest request from the buffer when at capacity, and clean up
 * any stale `requestIdToRequest` entry that referenced the evicted request.
 */
const evictOldestRequest = (state: CaptureState): void => {
  const shifted = state.requests.shift();
  if (shifted) {
    for (const [key, value] of state.requestIdToRequest) {
      if (value === shifted) {
        state.requestIdToRequest.delete(key);
        break;
      }
    }
  }
};

/** MIME type prefixes for binary content whose response bodies should not be captured. */
const BINARY_MIME_PREFIXES = ['image/', 'font/', 'video/', 'audio/'];
const BINARY_MIME_EXACT = new Set(['application/octet-stream', 'application/wasm']);

/** Returns true if the MIME type represents binary content that should be skipped. */
const isBinaryMime = (mimeType: string | undefined): boolean => {
  if (!mimeType) return false;
  const lower = mimeType.toLowerCase();
  if (BINARY_MIME_EXACT.has(lower)) return true;
  return BINARY_MIME_PREFIXES.some(prefix => lower.startsWith(prefix));
};

chrome.debugger.onEvent.addListener((source: chrome.debugger.Debuggee, method: string, params?: object) => {
  const paramsRecord = params as Record<string, unknown> | undefined;
  const tabId = source.tabId;
  if (tabId === undefined) return;
  const state = captures.get(tabId);
  if (!state) return;

  if (method === 'Network.requestWillBeSent') {
    const requestId = paramsRecord?.requestId as string | undefined;
    const request = paramsRecord?.request as Record<string, unknown> | undefined;
    if (!requestId || !request) return;

    // Prune stale entries to prevent unbounded growth from requests that never complete
    const now = Date.now();
    for (const [id, pending] of state.pendingRequests) {
      if (pending.timestamp !== undefined && now - pending.timestamp > PENDING_REQUEST_TTL_MS) {
        state.pendingRequests.delete(id);
      }
    }
    for (const [id, req] of state.requestIdToRequest) {
      if (now - req.timestamp > PENDING_REQUEST_TTL_MS) {
        state.requestIdToRequest.delete(id);
      }
    }
    for (const [id, createdAt] of state.wsCreatedAt) {
      if (now - createdAt > WS_TTL_MS) {
        state.wsFramesByRequestId.delete(id);
        state.wsCreatedAt.delete(id);
      }
    }

    const url = stringProp(request, 'url', '');

    // Apply URL filter — skip requests that don't match
    if (state.urlFilter && !url.includes(state.urlFilter)) return;

    const postData = typeof request.postData === 'string' ? request.postData : undefined;

    state.pendingRequests.set(requestId, {
      url,
      method: stringProp(request, 'method', 'GET'),
      requestHeaders: headersToRecord(request.headers),
      requestBody: postData ? truncateBody(postData) : undefined,
      timestamp: Date.now(),
    });
  } else if (method === 'Network.responseReceived') {
    const requestId = paramsRecord?.requestId as string | undefined;
    const response = paramsRecord?.response as Record<string, unknown> | undefined;
    if (!requestId || !response) return;

    const pending = state.pendingRequests.get(requestId);
    if (!pending) return;

    const completed: CapturedRequest = {
      url: pending.url ?? stringProp(response, 'url', ''),
      method: pending.method ?? 'GET',
      status: typeof response.status === 'number' ? response.status : undefined,
      statusText: typeof response.statusText === 'string' ? response.statusText : undefined,
      requestHeaders: pending.requestHeaders,
      responseHeaders: headersToRecord(response.headers),
      requestBody: pending.requestBody,
      mimeType: typeof response.mimeType === 'string' ? response.mimeType : undefined,
      timestamp: pending.timestamp ?? Date.now(),
    };

    state.pendingRequests.delete(requestId);

    // Add to buffer, dropping oldest if at capacity
    if (state.requests.length >= state.maxRequests) {
      evictOldestRequest(state);
    }
    state.requests.push(completed);
    state.requestIdToRequest.set(requestId, completed);
  } else if (method === 'Network.loadingFailed') {
    const requestId = paramsRecord?.requestId as string | undefined;
    if (!requestId) return;

    const pending = state.pendingRequests.get(requestId);
    if (!pending) return;
    state.pendingRequests.delete(requestId);
    state.requestIdToRequest.delete(requestId);

    const errorText = typeof paramsRecord?.errorText === 'string' ? paramsRecord.errorText : 'Unknown error';

    const completed: CapturedRequest = {
      url: pending.url ?? '',
      method: pending.method ?? 'GET',
      status: 0,
      statusText: errorText,
      requestHeaders: pending.requestHeaders,
      requestBody: pending.requestBody,
      timestamp: pending.timestamp ?? Date.now(),
    };

    if (state.requests.length >= state.maxRequests) {
      evictOldestRequest(state);
    }
    state.requests.push(completed);
  } else if (method === 'Network.loadingFinished') {
    const requestId = paramsRecord?.requestId as string | undefined;
    if (!requestId) return;

    const request = state.requestIdToRequest.get(requestId);
    if (!request) return;
    state.requestIdToRequest.delete(requestId);

    // Skip binary MIME types — response body would not be useful text
    if (isBinaryMime(request.mimeType)) return;

    // Fetch the response body via CDP
    chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId }, (result: unknown) => {
      // Graceful handling: if the request was aborted or the body is unavailable,
      // chrome.runtime.lastError is set and result is undefined
      if (chrome.runtime.lastError || !result) return;
      const responseData = result as { body?: string; base64Encoded?: boolean };
      if (typeof responseData.body !== 'string') return;
      // Guard: skip if the request was evicted from the buffer between the
      // loadingFinished event and the async body fetch completing.
      if (!state.requests.includes(request)) return;
      // For text content, store directly; for base64-encoded text, decode from
      // base64 to UTF-8 via Uint8Array + TextDecoder (bare atob returns Latin1,
      // which corrupts non-ASCII characters like Chinese text or emoji).
      const body = responseData.base64Encoded
        ? new TextDecoder().decode(Uint8Array.from(atob(responseData.body), c => c.charCodeAt(0)))
        : responseData.body;
      request.responseBody = truncateBody(body);
    });
  } else if (method === 'Network.webSocketCreated') {
    // WebSocket connections use separate CDP events (not requestWillBeSent).
    // Capture the creation event as a synthetic request so that the
    // analyze-site API detection module can classify it as websocket.
    const url = paramsRecord?.url as string | undefined;
    const requestId = paramsRecord?.requestId as string | undefined;
    if (!url) return;

    // Apply URL filter
    if (state.urlFilter && !url.includes(state.urlFilter)) return;

    // Store requestId → url mapping for frame capture, and track creation time for pruning
    if (requestId) {
      state.wsFramesByRequestId.set(requestId, url);
      state.wsCreatedAt.set(requestId, Date.now());
    }

    const completed: CapturedRequest = {
      url,
      method: 'GET',
      status: 101,
      statusText: 'Switching Protocols',
      requestHeaders: { Upgrade: 'websocket', Connection: 'Upgrade' },
      timestamp: Date.now(),
    };

    if (state.requests.length >= state.maxRequests) {
      evictOldestRequest(state);
    }
    state.requests.push(completed);
  } else if (method === 'Network.webSocketFrameSent' || method === 'Network.webSocketFrameReceived') {
    const requestId = paramsRecord?.requestId as string | undefined;
    const response = paramsRecord?.response as Record<string, unknown> | undefined;
    if (!requestId || !response) return;

    const url = state.wsFramesByRequestId.get(requestId);
    if (!url) return;

    const opcode = typeof response.opcode === 'number' ? response.opcode : 1;
    const payloadData = typeof response.payloadData === 'string' ? response.payloadData : '';
    const direction: 'sent' | 'received' = method === 'Network.webSocketFrameSent' ? 'sent' : 'received';

    // Binary frames (opcode 2) store a truncated base64 preview;
    // text frames (opcode 1) store the payload directly.
    const data = truncateBody(payloadData);

    if (state.wsFrames.length >= state.maxWsFrames) {
      state.wsFrames.shift();
    }
    state.wsFrames.push({ url, direction, data, opcode, timestamp: Date.now() });
  } else if (method === 'Network.webSocketClosed') {
    const requestId = paramsRecord?.requestId as string | undefined;
    if (requestId) {
      state.wsFramesByRequestId.delete(requestId);
      state.wsCreatedAt.delete(requestId);
    }
  } else if (method === 'Runtime.consoleAPICalled') {
    const type = paramsRecord?.type as string | undefined;
    const args = paramsRecord?.args as Array<{ type?: string; value?: unknown; description?: string }> | undefined;
    if (!type || !args) return;

    const messageParts: string[] = [];
    for (const arg of args) {
      if (arg.value !== undefined) {
        messageParts.push(typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value));
      } else if (arg.description) {
        messageParts.push(arg.description);
      } else {
        messageParts.push(arg.type ?? 'undefined');
      }
    }

    if (state.consoleLogs.length >= state.maxConsoleLogs) {
      state.consoleLogs.shift();
    }
    state.consoleLogs.push({
      level: type,
      message: messageParts.join(' '),
      timestamp: Date.now(),
    });
  }
});

// Clean up capture state when a tab is closed
chrome.tabs.onRemoved.addListener((tabId: number) => {
  const state = captures.get(tabId);
  if (state) {
    clearInterval(state.pruneIntervalId);
    void chrome.debugger.detach({ tabId }).catch(() => {});
    captures.delete(tabId);
  }
});

// Clean up capture state when the debugger is externally detached
// (e.g. user opens DevTools, Chrome terminates the debugger under memory pressure).
// The debugger is already gone — do NOT call chrome.debugger.detach() here.
chrome.debugger.onDetach.addListener((source: chrome.debugger.Debuggee, _reason: string) => {
  const tabId = source.tabId;
  if (tabId !== undefined) {
    const state = captures.get(tabId);
    if (state) clearInterval(state.pruneIntervalId);
    captures.delete(tabId);
  }
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start capturing network requests and console logs for a tab.
 * Attaches the Chrome DevTools Protocol debugger and enables Network + Runtime domains.
 */
export const startCapture = async (
  tabId: number,
  maxRequests: number = 100,
  urlFilter?: string,
  maxConsoleLogs: number = 500,
  maxWsFrames: number = 200,
): Promise<void> => {
  // If a startCapture is already in flight for this tab, wait for it and return.
  // This serializes concurrent calls so the second caller does not attempt to
  // attach the debugger while the first is still attaching.
  const inFlightCapture = pendingCaptures.get(tabId);
  if (inFlightCapture) {
    return inFlightCapture;
  }

  if (captures.has(tabId)) {
    throw new Error(`Network capture already active for tab ${tabId}. Call stopCapture first.`);
  }

  const capturePromise = (async () => {
    try {
      await chrome.debugger.attach({ tabId }, CDP_VERSION);
    } catch (err) {
      throw new Error(
        `Failed to attach debugger to tab ${tabId}: ${toErrorMessage(err)}. ` +
          'Another debugger (e.g., DevTools) may already be attached.',
      );
    }

    try {
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    } catch (err) {
      await chrome.debugger.detach({ tabId }).catch(() => {});
      throw err;
    }

    const captureState: CaptureState = {
      requests: [],
      consoleLogs: [],
      wsFrames: [],
      maxRequests,
      maxConsoleLogs,
      maxWsFrames,
      urlFilter,
      pendingRequests: new Map(),
      requestIdToRequest: new Map(),
      wsFramesByRequestId: new Map(),
      wsCreatedAt: new Map(),
    };

    captureState.pruneIntervalId = setInterval(() => {
      const now = Date.now();
      for (const [id, pendingReq] of captureState.pendingRequests) {
        if (pendingReq.timestamp !== undefined && now - pendingReq.timestamp > PENDING_REQUEST_TTL_MS) {
          captureState.pendingRequests.delete(id);
        }
      }
      for (const [id, req] of captureState.requestIdToRequest) {
        if (now - req.timestamp > PENDING_REQUEST_TTL_MS) {
          captureState.requestIdToRequest.delete(id);
        }
      }
      for (const [id, createdAt] of captureState.wsCreatedAt) {
        if (now - createdAt > WS_TTL_MS) {
          captureState.wsFramesByRequestId.delete(id);
          captureState.wsCreatedAt.delete(id);
        }
      }
    }, PRUNE_INTERVAL_MS);

    captures.set(tabId, captureState);
  })();

  pendingCaptures.set(tabId, capturePromise);
  try {
    await capturePromise;
  } finally {
    pendingCaptures.delete(tabId);
  }
};

/**
 * Stop capturing network requests and console logs for a tab.
 * Detaches the debugger and clears all buffers.
 */
export const stopCapture = (tabId: number): void => {
  const state = captures.get(tabId);
  if (!state) return;

  clearInterval(state.pruneIntervalId);
  state.wsFramesByRequestId.clear();
  state.wsCreatedAt.clear();
  void chrome.debugger.detach({ tabId }).catch(() => {});
  captures.delete(tabId);
};

/**
 * Get captured network requests for a tab.
 * Optionally clears the buffer after reading.
 */
export const getRequests = (tabId: number, clear: boolean = false): CapturedRequest[] => {
  const state = captures.get(tabId);
  if (!state) return [];

  const requests = state.requests.map(req => ({
    ...req,
    requestHeaders: scrubHeaders(req.requestHeaders),
    responseHeaders: scrubHeaders(req.responseHeaders),
  }));
  if (clear) {
    state.requests = [];
    // requestIdToRequest tracks completed requests (post-responseReceived, pre-loadingFinished)
    // that were in state.requests. Clearing both together is safe; the body-fetch guard
    // (state.requests.includes check) handles any in-flight async callbacks.
    // pendingRequests is NOT cleared — in-flight requests that have not yet received
    // a response continue to be tracked and will appear in subsequent getRequests calls.
    state.requestIdToRequest.clear();
  }
  return requests;
};

/** Check whether network capture is active for a tab. */
export const isCapturing = (tabId: number): boolean => captures.has(tabId);

/**
 * Get captured console logs for a tab.
 * Optionally filter by level and/or clear the buffer after reading.
 */
export const getConsoleLogs = (tabId: number, clear: boolean = false, level?: string): ConsoleEntry[] => {
  const state = captures.get(tabId);
  if (!state) return [];

  let logs = [...state.consoleLogs];
  if (level && level !== 'all') {
    logs = logs.filter(entry => entry.level === level);
  }
  if (clear) {
    state.consoleLogs = [];
  }
  return logs;
};

/** Clear the console log buffer for a tab without stopping capture. */
export const clearConsoleLogs = (tabId: number): void => {
  const state = captures.get(tabId);
  if (state) {
    state.consoleLogs = [];
  }
};

/**
 * Get captured WebSocket frames for a tab.
 * Optionally clears the buffer after reading.
 */
export const getWsFrames = (tabId: number, clear: boolean = false): WsFrame[] => {
  const state = captures.get(tabId);
  if (!state) return [];

  const frames = [...state.wsFrames];
  if (clear) {
    state.wsFrames = [];
    // wsFramesByRequestId and wsCreatedAt are NOT cleared — they hold the
    // requestId→url mappings needed to capture frames from existing connections.
    // Entries are cleaned up by webSocketClosed events, the prune interval,
    // and stopCapture when the entire session ends.
  }
  return frames;
};

/** Return a summary of all active network captures for state inspection. */
export const getActiveCapturesSummary = (): Array<{ tabId: number; requestCount: number; isCapturing: boolean }> =>
  Array.from(captures.entries()).map(([tabId, state]) => ({
    tabId,
    requestCount: state.requests.length,
    isCapturing: true,
  }));

export { scrubHeaders };
export type { WsFrame };
