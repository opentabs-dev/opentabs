// =============================================================================
// Capture Handler — Extension-Side HTTP Request Capture
//
// Manages capture sessions for the AI-assisted plugin creation workflow.
// Each capture session is associated with a browser tab and records HTTP
// requests made by the page (via fetch and XMLHttpRequest interceptors
// injected into the page's MAIN world context).
//
// The MCP server's capture tools (capture_start, capture_stop, etc.) send
// browser controller requests that are dispatched to this handler. The handler
// manages session lifecycle and delegates page-level interception to injected
// scripts via chrome.scripting.executeScript.
//
// Architecture:
//   MCP tool → sendBrowserRequest('startCapture', { tabId })
//     → WebSocket → background script → BrowserController
//       → CaptureHandler.startCapture(tabId, options)
//         → chrome.scripting.executeScript (inject interceptors)
//
//   Captured requests flow back via:
//     Injected interceptor → window.postMessage → content script
//       → chrome.runtime.sendMessage → CaptureHandler.addRequest(tabId, req)
//
// This module is imported by the BrowserController and registered as action
// handlers alongside listTabs, openTab, etc.
// =============================================================================

// =============================================================================
// Types
// =============================================================================

/** A single captured HTTP request with its response metadata. */
interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly statusText: string;
  readonly requestHeaders: Record<string, string>;
  readonly responseHeaders: Record<string, string>;
  readonly requestBody?: string;
  readonly responseBody?: string;
  readonly contentType?: string;
  readonly timestamp: number;
  readonly duration: number;
  readonly initiator?: string;
}

/** Options for starting a capture session. */
interface CaptureOptions {
  /** Whether to capture response bodies (can be large). Default: false. */
  readonly includeResponseBodies: boolean;
  /** Maximum number of requests to store before auto-stopping. Default: 500. */
  readonly maxRequests: number;
}

/** Internal state for a per-tab capture session. */
interface CaptureSession {
  readonly tabId: number;
  readonly tabUrl: string;
  readonly options: CaptureOptions;
  readonly startedAt: number;
  capturing: boolean;
  requests: CapturedRequest[];
}

/** Summary returned when stopping or querying capture status. */
interface CaptureSummary {
  readonly tabId: number;
  readonly tabUrl: string;
  readonly totalRequests: number;
  readonly capturing: boolean;
  readonly startedAt: number;
  readonly duration: number;
}

// =============================================================================
// Capture Session Store
// =============================================================================

/** Active and completed capture sessions, keyed by tab ID. */
const sessions = new Map<number, CaptureSession>();

// =============================================================================
// Interceptor Injection Script
//
// This function is serialized and injected into the page's MAIN world via
// chrome.scripting.executeScript. It patches fetch() and XMLHttpRequest to
// capture request/response metadata, then posts captured data back to the
// content script via window.postMessage.
//
// The function must be self-contained — it cannot reference any variables
// from the outer scope.
// =============================================================================

/**
 * The interceptor function injected into the page. Parameters are passed
 * via the `args` array in chrome.scripting.executeScript.
 *
 * @param includeResponseBodies - Whether to capture response body text
 * @param maxRequests - Auto-stop threshold
 */
const interceptorScript = (includeResponseBodies: boolean, maxRequests: number): void => {
  // Guard against double-injection
  if ((window as unknown as Record<string, unknown>).__openTabsCaptureActive) {
    return;
  }
  (window as unknown as Record<string, unknown>).__openTabsCaptureActive = true;

  let capturedCount = 0;

  const postCapture = (data: Record<string, unknown>): void => {
    window.postMessage(
      {
        type: '__opentabs_capture__',
        data,
      },
      '*',
    );
  };

  // -----------------------------------------------------------------------
  // Patch fetch()
  // -----------------------------------------------------------------------

  const originalFetch = window.fetch;

  window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (capturedCount >= maxRequests) {
      return originalFetch.call(window, input, init);
    }

    const startTime = Date.now();

    // Extract request metadata
    let url: string;
    let method: string;
    const requestHeaders: Record<string, string> = {};
    let requestBody: string | undefined;

    if (input instanceof Request) {
      url = input.url;
      method = init?.method ?? input.method ?? 'GET';
      input.headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });
    } else {
      url = typeof input === 'string' ? input : input.toString();
      method = init?.method ?? 'GET';
    }

    // Merge init headers
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        requestHeaders[key] = value;
      });
    }

    // Capture request body (truncated for safety)
    if (init?.body) {
      try {
        if (typeof init.body === 'string') {
          requestBody = init.body.slice(0, 10000);
        } else if (init.body instanceof URLSearchParams) {
          requestBody = init.body.toString().slice(0, 10000);
        }
      } catch {
        // Body types like ReadableStream can't be easily serialized
      }
    }

    try {
      const response = await originalFetch.call(window, input, init);
      const duration = Date.now() - startTime;

      // Extract response metadata
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let responseBody: string | undefined;
      const contentType = response.headers.get('content-type') ?? '';

      // Clone the response to read the body without consuming the original
      if (includeResponseBodies && contentType.includes('application/json')) {
        try {
          const clone = response.clone();
          const text = await clone.text();
          responseBody = text.slice(0, 50000); // Limit body size
        } catch {
          // Response body may not be readable
        }
      }

      capturedCount++;

      postCapture({
        url,
        method: method.toUpperCase(),
        status: response.status,
        statusText: response.statusText,
        requestHeaders,
        responseHeaders,
        requestBody,
        responseBody,
        contentType,
        timestamp: startTime,
        duration,
        initiator: 'fetch',
      });

      return response;
    } catch (err) {
      const duration = Date.now() - startTime;
      capturedCount++;

      postCapture({
        url,
        method: method.toUpperCase(),
        status: 0,
        statusText: err instanceof Error ? err.message : 'Network error',
        requestHeaders,
        responseHeaders: {},
        requestBody,
        contentType: '',
        timestamp: startTime,
        duration,
        initiator: 'fetch',
      });

      throw err;
    }
  };

  // -----------------------------------------------------------------------
  // Patch XMLHttpRequest
  // -----------------------------------------------------------------------

  const OriginalXHR = window.XMLHttpRequest;
  const originalOpen = OriginalXHR.prototype.open;
  const originalSend = OriginalXHR.prototype.send;
  const originalSetRequestHeader = OriginalXHR.prototype.setRequestHeader;

  OriginalXHR.prototype.open = function (
    this: XMLHttpRequest & { __capture?: Record<string, unknown> },
    method: string,
    url: string | URL,
  ): void {
    this.__capture = {
      method: method.toUpperCase(),
      url: typeof url === 'string' ? url : url.toString(),
      requestHeaders: {} as Record<string, string>,
      startTime: 0,
    };
    return originalOpen.call(this, method, url);
  };

  OriginalXHR.prototype.setRequestHeader = function (
    this: XMLHttpRequest & { __capture?: Record<string, unknown> },
    name: string,
    value: string,
  ): void {
    if (this.__capture) {
      const headers = this.__capture.requestHeaders as Record<string, string>;
      headers[name] = value;
    }
    return originalSetRequestHeader.call(this, name, value);
  };

  OriginalXHR.prototype.send = function (
    this: XMLHttpRequest & { __capture?: Record<string, unknown> },
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    if (!this.__capture || capturedCount >= maxRequests) {
      return originalSend.call(this, body);
    }

    this.__capture.startTime = Date.now();

    let requestBody: string | undefined;
    if (body) {
      try {
        if (typeof body === 'string') {
          requestBody = body.slice(0, 10000);
        } else if (body instanceof URLSearchParams) {
          requestBody = body.toString().slice(0, 10000);
        }
      } catch {
        // Skip non-serializable bodies
      }
    }

    const capture = this.__capture;

    this.addEventListener('loadend', () => {
      const duration = Date.now() - (capture.startTime as number);

      const responseHeaders: Record<string, string> = {};
      const rawHeaders = this.getAllResponseHeaders();
      for (const line of rawHeaders.split('\r\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          const val = line.slice(colonIdx + 1).trim();
          responseHeaders[key] = val;
        }
      }

      const contentType = this.getResponseHeader('content-type') ?? '';

      let responseBody: string | undefined;
      if (includeResponseBodies && contentType.includes('application/json')) {
        try {
          responseBody = typeof this.response === 'string' ? this.response.slice(0, 50000) : undefined;
        } catch {
          // Skip
        }
      }

      capturedCount++;

      postCapture({
        url: capture.url as string,
        method: capture.method as string,
        status: this.status,
        statusText: this.statusText,
        requestHeaders: capture.requestHeaders as Record<string, string>,
        responseHeaders,
        requestBody,
        responseBody,
        contentType,
        timestamp: capture.startTime as number,
        duration,
        initiator: 'xhr',
      });
    });

    return originalSend.call(this, body);
  };

  // -----------------------------------------------------------------------
  // Notify that capture is active
  // -----------------------------------------------------------------------

  console.log(
    `[OpenTabs] Request capture started (includeResponseBodies: ${includeResponseBodies}, maxRequests: ${maxRequests})`,
  );
};

/**
 * Script injected to stop capture mode — restores original fetch/XHR.
 * A full restore is complex (patched prototypes), so we just set the flag
 * to false and let the interceptors pass through on the next page load.
 * In practice, capture sessions end when the user is done navigating.
 */
const stopInterceptorScript = (): void => {
  (window as unknown as Record<string, unknown>).__openTabsCaptureActive = false;
  console.log('[OpenTabs] Request capture stopped');
};

/**
 * Script to list all <script> elements and dynamic script resources on the page.
 */
const getPageScriptsScript = (filterPattern?: string): string[] => {
  const scripts: string[] = [];

  // Static <script> elements
  for (const el of document.querySelectorAll('script[src]')) {
    const src = el.getAttribute('src');
    if (src) {
      const absolute = new URL(src, document.baseURI).href;
      scripts.push(absolute);
    }
  }

  // Performance API entries (catches dynamically loaded scripts)
  if (typeof performance !== 'undefined' && performance.getEntriesByType) {
    for (const entry of performance.getEntriesByType('resource')) {
      if ((entry as PerformanceResourceTiming).initiatorType === 'script') {
        if (!scripts.includes(entry.name)) {
          scripts.push(entry.name);
        }
      }
    }
  }

  // Apply filter if provided
  if (filterPattern) {
    const lower = filterPattern.toLowerCase();
    return scripts.filter(s => s.toLowerCase().includes(lower));
  }

  return scripts;
};

/**
 * Script to fetch a JS source file from the page context (same-origin).
 */
const fetchScriptScript = async (
  url: string,
  maxLength: number,
): Promise<{
  url: string;
  content: string;
  truncated: boolean;
  totalLength: number;
}> => {
  const response = await fetch(url);
  const text = await response.text();
  return {
    url,
    content: text.slice(0, maxLength),
    truncated: text.length > maxLength,
    totalLength: text.length,
  };
};

/**
 * Script to inspect authentication state on the page.
 */
const inspectAuthScript = (): {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  cookies: string[];
  metaTags: Record<string, string>;
  globals: Record<string, string>;
} => {
  const redact = (value: string, maxVisible: number = 8): string => {
    if (value.length <= maxVisible) return value;
    return value.slice(0, maxVisible) + '...[REDACTED]';
  };

  // localStorage — look for auth-related keys
  const authLocalStorage: Record<string, string> = {};
  const authKeyPatterns = [
    'token',
    'auth',
    'session',
    'key',
    'credential',
    'jwt',
    'access',
    'refresh',
    'csrf',
    'xsrf',
    'user',
    'account',
    'login',
    'config',
  ];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const lower = key.toLowerCase();
      if (authKeyPatterns.some(p => lower.includes(p))) {
        const value = localStorage.getItem(key) ?? '';
        authLocalStorage[key] = redact(value, 30);
      }
    }
  } catch {
    // localStorage may not be accessible
  }

  // sessionStorage — same pattern
  const authSessionStorage: Record<string, string> = {};
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      const lower = key.toLowerCase();
      if (authKeyPatterns.some(p => lower.includes(p))) {
        const value = sessionStorage.getItem(key) ?? '';
        authSessionStorage[key] = redact(value, 30);
      }
    }
  } catch {
    // sessionStorage may not be accessible
  }

  // Cookies (non-httpOnly ones visible to JS)
  const cookies: string[] = [];
  try {
    const cookieStr = document.cookie;
    for (const part of cookieStr.split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const name = trimmed.slice(0, eqIdx);
        const value = trimmed.slice(eqIdx + 1);
        cookies.push(`${name}=${redact(value)}`);
      }
    }
  } catch {
    // Cookies may not be accessible
  }

  // Meta tags with auth-related names
  const metaTags: Record<string, string> = {};
  try {
    for (const meta of document.querySelectorAll('meta[name], meta[property]')) {
      const name = meta.getAttribute('name') ?? meta.getAttribute('property') ?? '';
      const content = meta.getAttribute('content') ?? '';
      const lower = name.toLowerCase();
      if (authKeyPatterns.some(p => lower.includes(p))) {
        metaTags[name] = redact(content);
      }
    }
  } catch {
    // Meta tag access may fail
  }

  // Common JavaScript globals that might contain auth state
  const globals: Record<string, string> = {};
  const globalCandidates = [
    '__APP_STATE__',
    '__INITIAL_STATE__',
    '__NEXT_DATA__',
    '__NUXT__',
    '__APP_CONFIG__',
    '_env',
    'appConfig',
    'window.config',
  ];
  for (const candidate of globalCandidates) {
    try {
      const value = (window as unknown as Record<string, unknown>)[candidate];
      if (value !== undefined && value !== null) {
        globals[candidate] =
          typeof value === 'object'
            ? `[object with keys: ${Object.keys(value as Record<string, unknown>)
                .slice(0, 10)
                .join(', ')}]`
            : redact(String(value));
      }
    } catch {
      // Skip inaccessible globals
    }
  }

  return {
    localStorage: authLocalStorage,
    sessionStorage: authSessionStorage,
    cookies,
    metaTags,
    globals,
  };
};

// =============================================================================
// CaptureHandler — Action Handlers for BrowserController
// =============================================================================

type ActionHandler = (params: Record<string, unknown>) => Promise<unknown>;

class CaptureHandler {
  /**
   * Action handlers that the BrowserController dispatches to.
   * Keys match the action strings used in sendBrowserRequest() from capture tools.
   */
  readonly actions: Record<string, ActionHandler> = {
    startCapture: params => this.startCapture(params),
    stopCapture: params => this.stopCapture(params),
    captureStatus: params => this.captureStatus(params),
    getCapturedRequests: params => this.getCapturedRequests(params),
    clearCapture: params => this.clearCapture(params),
    getPageScripts: params => this.getPageScripts(params),
    fetchScript: params => this.fetchScript(params),
    inspectAuth: params => this.inspectAuth(params),
  };

  /**
   * Handle an incoming captured request from the content script message relay.
   * Called when the content script forwards a `__opentabs_capture__` message.
   */
  addRequest(tabId: number, data: CapturedRequest): void {
    const session = sessions.get(tabId);
    if (!session || !session.capturing) return;

    session.requests.push(data);

    // Auto-stop if max requests reached
    if (session.requests.length >= session.options.maxRequests) {
      session.capturing = false;
      console.error(`[OpenTabs] Capture auto-stopped on tab ${tabId}: reached ${session.options.maxRequests} requests`);
    }
  }

  // ===========================================================================
  // Capture Lifecycle
  // ===========================================================================

  private async startCapture(params: Record<string, unknown>): Promise<{
    capturing: boolean;
    tabId: number;
    message: string;
  }> {
    const tabId = params.tabId as number | undefined;
    if (typeof tabId !== 'number') {
      throw new Error('tabId is required and must be a number');
    }

    const includeResponseBodies = (params.includeResponseBodies as boolean) ?? false;
    const maxRequests = (params.maxRequests as number) ?? 500;

    // Get tab URL for session metadata
    const tab = await chrome.tabs.get(tabId);
    const tabUrl = tab.url ?? '';

    // Create or reset the capture session
    sessions.set(tabId, {
      tabId,
      tabUrl,
      options: { includeResponseBodies, maxRequests },
      startedAt: Date.now(),
      capturing: true,
      requests: [],
    });

    // Inject the interceptor script into the page's MAIN world
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: interceptorScript,
        args: [includeResponseBodies, maxRequests],
      });
    } catch (err) {
      sessions.delete(tabId);
      throw new Error(
        `Failed to inject capture interceptors into tab ${tabId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      capturing: true,
      tabId,
      message: `Capture started on tab ${tabId} (${tabUrl}). Navigate the application to exercise API endpoints.`,
    };
  }

  private async stopCapture(params: Record<string, unknown>): Promise<CaptureSummary> {
    const tabId = params.tabId as number | undefined;
    if (typeof tabId !== 'number') {
      throw new Error('tabId is required and must be a number');
    }

    const session = sessions.get(tabId);
    if (!session) {
      throw new Error(`No capture session found for tab ${tabId}. Call capture_start first.`);
    }

    session.capturing = false;

    // Attempt to stop the interceptors on the page
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: stopInterceptorScript,
      });
    } catch {
      // Tab may have navigated away or closed — that's OK
    }

    return this.buildSummary(session);
  }

  private async captureStatus(params: Record<string, unknown>): Promise<CaptureSummary> {
    const tabId = params.tabId as number | undefined;
    if (typeof tabId !== 'number') {
      throw new Error('tabId is required and must be a number');
    }

    const session = sessions.get(tabId);
    if (!session) {
      return {
        tabId,
        tabUrl: '',
        totalRequests: 0,
        capturing: false,
        startedAt: 0,
        duration: 0,
      };
    }

    return this.buildSummary(session);
  }

  // ===========================================================================
  // Data Retrieval
  // ===========================================================================

  private async getCapturedRequests(params: Record<string, unknown>): Promise<{
    requests: CapturedRequest[];
    total: number;
    filtered: number;
    tabUrl: string;
  }> {
    const tabId = params.tabId as number | undefined;
    if (typeof tabId !== 'number') {
      throw new Error('tabId is required and must be a number');
    }

    const session = sessions.get(tabId);
    if (!session) {
      return { requests: [], total: 0, filtered: 0, tabUrl: '' };
    }

    let requests = [...session.requests];

    // Apply filters
    const methodFilter = params.methodFilter as string | undefined;
    const domainFilter = params.domainFilter as string | undefined;
    const pathFilter = params.pathFilter as string | undefined;
    const contentTypeFilter = params.contentTypeFilter as string | undefined;
    const excludeStaticAssets = (params.excludeStaticAssets as boolean) ?? true;

    if (excludeStaticAssets) {
      requests = requests.filter(r => {
        const ct = r.contentType ?? '';
        const url = r.url.toLowerCase();
        if (ct.includes('text/css') || ct.includes('text/html')) return false;
        if (ct.includes('image/') || ct.includes('font/')) return false;
        if (ct.includes('javascript') && !url.includes('/api/')) return false;
        if (url.match(/\.(css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map)(\?|$)/)) return false;
        return true;
      });
    }

    if (methodFilter) {
      const upper = methodFilter.toUpperCase();
      requests = requests.filter(r => r.method === upper);
    }

    if (domainFilter) {
      const lower = domainFilter.toLowerCase();
      requests = requests.filter(r => {
        try {
          return new URL(r.url).hostname.toLowerCase().includes(lower);
        } catch {
          return false;
        }
      });
    }

    if (pathFilter) {
      const lower = pathFilter.toLowerCase();
      requests = requests.filter(r => r.url.toLowerCase().includes(lower));
    }

    if (contentTypeFilter) {
      const lower = contentTypeFilter.toLowerCase();
      requests = requests.filter(r => (r.contentType ?? '').toLowerCase().includes(lower));
    }

    const total = session.requests.length;
    const filtered = requests.length;

    // Apply pagination
    const limit = (params.limit as number) ?? 50;
    const offset = (params.offset as number) ?? 0;
    requests = requests.slice(offset, offset + limit);

    return { requests, total, filtered, tabUrl: session.tabUrl };
  }

  private async clearCapture(params: Record<string, unknown>): Promise<{ cleared: number }> {
    const tabId = params.tabId as number | undefined;
    if (typeof tabId !== 'number') {
      throw new Error('tabId is required and must be a number');
    }

    const session = sessions.get(tabId);
    if (!session) {
      return { cleared: 0 };
    }

    const cleared = session.requests.length;
    session.requests = [];
    return { cleared };
  }

  // ===========================================================================
  // Page Inspection
  // ===========================================================================

  private async getPageScripts(params: Record<string, unknown>): Promise<{ scripts: string[] }> {
    const tabId = params.tabId as number | undefined;
    if (typeof tabId !== 'number') {
      throw new Error('tabId is required and must be a number');
    }

    const filterPattern = params.filterPattern as string | undefined;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: getPageScriptsScript,
      args: [filterPattern],
    });

    const scripts = (results[0]?.result as string[] | undefined) ?? [];
    return { scripts };
  }

  private async fetchScript(params: Record<string, unknown>): Promise<{
    url: string;
    content: string;
    truncated: boolean;
    totalLength: number;
  }> {
    const tabId = params.tabId as number | undefined;
    const url = params.url as string | undefined;
    const maxLength = (params.maxLength as number) ?? 100000;

    if (typeof tabId !== 'number') throw new Error('tabId is required and must be a number');
    if (typeof url !== 'string' || !url) throw new Error('url is required and must be a non-empty string');

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: fetchScriptScript,
      args: [url, maxLength],
    });

    const result = results[0]?.result as
      | {
          url: string;
          content: string;
          truncated: boolean;
          totalLength: number;
        }
      | undefined;

    if (!result) {
      throw new Error(`Failed to fetch script: no result returned from tab ${tabId}`);
    }

    return result;
  }

  private async inspectAuth(params: Record<string, unknown>): Promise<{
    localStorage: Record<string, string>;
    sessionStorage: Record<string, string>;
    cookies: string[];
    metaTags: Record<string, string>;
    globals: Record<string, string>;
  }> {
    const tabId = params.tabId as number | undefined;
    if (typeof tabId !== 'number') {
      throw new Error('tabId is required and must be a number');
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: inspectAuthScript,
    });

    const result = results[0]?.result as
      | {
          localStorage: Record<string, string>;
          sessionStorage: Record<string, string>;
          cookies: string[];
          metaTags: Record<string, string>;
          globals: Record<string, string>;
        }
      | undefined;

    if (!result) {
      throw new Error(`Failed to inspect auth: no result returned from tab ${tabId}`);
    }

    return result;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private buildSummary(session: CaptureSession): CaptureSummary {
    return {
      tabId: session.tabId,
      tabUrl: session.tabUrl,
      totalRequests: session.requests.length,
      capturing: session.capturing,
      startedAt: session.startedAt,
      duration: Date.now() - session.startedAt,
    };
  }

  /**
   * Clean up capture sessions for a tab that has been closed or navigated away.
   * Called by the tab lifecycle manager when a tab is removed.
   */
  cleanupTab(tabId: number): void {
    sessions.delete(tabId);
  }

  /**
   * Get all active capture session tab IDs. Useful for diagnostics.
   */
  getActiveSessions(): number[] {
    return [...sessions.entries()].filter(([, session]) => session.capturing).map(([tabId]) => tabId);
  }
}

// =============================================================================
// Singleton Export
//
// The BrowserController imports this and registers the action handlers.
// The content script message listener calls addRequest() when it receives
// captured request data from the page.
// =============================================================================

const captureHandler = new CaptureHandler();

export { captureHandler, CaptureHandler };
export type { CapturedRequest, CaptureOptions, CaptureSession, CaptureSummary };
