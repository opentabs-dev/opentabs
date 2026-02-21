import { SCRIPT_TIMEOUT_MS, MAX_SCRIPT_TIMEOUT_MS } from './constants.js';
import { sendToServer } from './messaging.js';
import { getPluginMeta } from './plugin-storage.js';
import { sanitizeErrorMessage } from './sanitize-error.js';
import { findAllMatchingTabs, urlMatchesPatterns } from './tab-matching.js';
import type { PluginMeta } from './types.js';

/**
 * Per-dispatch progress callbacks — keyed by dispatchId, called by background.ts
 * when a tool:progress message arrives. Each callback resets the extension-side
 * script timeout for the corresponding dispatch.
 */
const progressCallbacks = new Map<string, () => void>();

/**
 * Notify the extension-side dispatch that a progress event arrived.
 * Called from the background message handler (tool:progress case).
 */
const notifyDispatchProgress = (dispatchId: string): void => {
  const cb = progressCallbacks.get(dispatchId);
  if (cb) cb();
};

/**
 * Get the link for console.warn logging: npm URL for published plugins, filesystem path for local.
 */
const getPluginLink = (plugin: PluginMeta): string => {
  if (plugin.trustTier === 'local' && plugin.sourcePath) {
    return plugin.sourcePath;
  }
  if (plugin.trustTier === 'official') {
    return `https://npmjs.com/package/@opentabs-dev/plugin-${plugin.name}`;
  }
  return `https://npmjs.com/package/opentabs-plugin-${plugin.name}`;
};

/**
 * Inject a console.warn into the target tab before tool execution for transparency.
 */
const injectToolInvocationLog = async (
  tabId: number,
  pluginName: string,
  toolName: string,
  link: string,
): Promise<void> => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (pName: string, tName: string, lnk: string) => {
        console.warn(`[opentabs] ${pName}.${tName} invoked — ${lnk}`);
      },
      args: [pluginName, toolName, link],
    });
  } catch {
    // Tab may not be injectable — logging is best-effort
  }
};

type ToolResult =
  | {
      type: 'error';
      code: number;
      message: string;
      data?: { code: string; retryable?: boolean; retryAfterMs?: number; category?: string };
    }
  | { type: 'success'; output: unknown };

/**
 * Inject an ISOLATED world content script that listens for opentabs:progress
 * CustomEvents from the MAIN world and relays them to the background service
 * worker via chrome.runtime.sendMessage. Returns after the listener is installed.
 *
 * CustomEvents fired in MAIN world are visible in ISOLATED world because they
 * share the same DOM — this is the correct, CSP-safe pattern for cross-world
 * communication in Chrome extensions.
 */
const injectProgressListener = async (tabId: number, dispatchId: string): Promise<void> => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: (dId: string) => {
        const eventName = `opentabs:progress:${dId}`;
        const handler = (e: Event) => {
          const detail = (e as CustomEvent).detail as {
            dispatchId: string;
            progress: number;
            total: number;
            message?: string;
          } | null;
          if (!detail) return;
          void chrome.runtime.sendMessage({
            type: 'tool:progress',
            dispatchId: detail.dispatchId,
            progress: detail.progress,
            total: detail.total,
            message: detail.message,
          });
        };
        document.addEventListener(eventName, handler);

        // Store a cleanup function on the document so we can remove the listener later
        const cleanupKey = `__opentabs_progress_cleanup_${dId}`;
        const doc = document as unknown as Record<string, unknown>;
        doc[cleanupKey] = () => {
          document.removeEventListener(eventName, handler);
          doc[cleanupKey] = undefined;
        };
      },
      args: [dispatchId],
    });
  } catch {
    // Tab may not be injectable — progress is best-effort
  }
};

/**
 * Remove the ISOLATED world progress listener installed by injectProgressListener.
 * Fire-and-forget — errors are silently ignored since the dispatch is already complete.
 */
const removeProgressListener = (tabId: number, dispatchId: string): void => {
  chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: (dId: string) => {
        const cleanupKey = `__opentabs_progress_cleanup_${dId}`;
        const cleanup = (document as unknown as Record<string, unknown>)[cleanupKey] as (() => void) | undefined;
        if (cleanup) cleanup();
      },
      args: [dispatchId],
    })
    .catch(() => {
      // Best-effort cleanup
    });
};

/**
 * Execute a tool on a specific tab. Returns the structured result from the
 * adapter script, or throws if the tab is inaccessible (e.g., closed).
 *
 * The extension-side timeout starts at SCRIPT_TIMEOUT_MS (25s). When the tool
 * reports progress, the timeout is reset via the progressCallbacks registry.
 * The absolute upper bound is MAX_SCRIPT_TIMEOUT_MS (295s).
 *
 * @param dispatchId - Correlation ID for progress reporting. The injected MAIN
 *   world function creates a ToolHandlerContext with a reportProgress callback
 *   that fires CustomEvents keyed by this ID.
 */
const executeToolOnTab = async (
  tabId: number,
  pluginName: string,
  toolName: string,
  input: Record<string, unknown>,
  dispatchId: string,
): Promise<ToolResult> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const startTs = Date.now();

  const scriptPromise = chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (pName: string, tName: string, tInput: Record<string, unknown>, dId: string) => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as
        | {
            adapters?: Record<
              string,
              {
                isReady(): Promise<boolean>;
                tools: Array<{
                  name: string;
                  handle(
                    params: unknown,
                    context?: { reportProgress(opts: { progress: number; total: number; message?: string }): void },
                  ): Promise<unknown>;
                }>;
              }
            >;
          }
        | undefined;
      const adapter = ot?.adapters?.[pName];
      if (!adapter || typeof adapter !== 'object') {
        return { type: 'error' as const, code: -32002, message: `Adapter "${pName}" not injected or not ready` };
      }

      if (typeof adapter.isReady !== 'function') {
        return { type: 'error' as const, code: -32002, message: `Adapter "${pName}" has no isReady function` };
      }

      if (!Array.isArray(adapter.tools)) {
        return { type: 'error' as const, code: -32002, message: `Adapter "${pName}" has no tools array` };
      }

      let ready: boolean;
      try {
        ready = await adapter.isReady();
      } catch {
        return { type: 'error' as const, code: -32002, message: `Adapter "${pName}" isReady() threw an error` };
      }

      if (!ready) {
        return {
          type: 'error' as const,
          code: -32002,
          message: `Plugin "${pName}" is not ready (state: unavailable)`,
        };
      }

      const tool = adapter.tools.find((t: { name: string }) => t.name === tName);
      if (!tool || typeof tool.handle !== 'function') {
        return { type: 'error' as const, code: -32603, message: `Tool "${tName}" not found in adapter "${pName}"` };
      }

      // Create ToolHandlerContext with reportProgress that fires a CustomEvent
      // on the document. The ISOLATED world content script listens for this event
      // and relays it to the background service worker. Missing progress/total
      // default to 0 for indeterminate progress reporting.
      const context = {
        reportProgress(opts: { progress?: number; total?: number; message?: string }) {
          try {
            document.dispatchEvent(
              new CustomEvent(`opentabs:progress:${dId}`, {
                detail: {
                  dispatchId: dId,
                  progress: opts.progress ?? 0,
                  total: opts.total ?? 0,
                  message: opts.message,
                },
              }),
            );
          } catch {
            // Fire-and-forget — progress reporting errors must not affect tool execution
          }
        },
      };

      try {
        const output = await tool.handle(tInput, context);
        return { type: 'success' as const, output };
      } catch (err: unknown) {
        const e = err as {
          message?: string;
          code?: string;
          retryable?: boolean;
          retryAfterMs?: number;
          category?: string;
        };
        if (typeof e.code !== 'string') {
          return {
            type: 'error' as const,
            code: -32603,
            message: e.message ?? 'Tool execution failed',
          };
        }
        const data: {
          code: string;
          retryable?: boolean;
          retryAfterMs?: number;
          category?: string;
        } = { code: e.code };
        if (typeof e.retryable === 'boolean') data.retryable = e.retryable;
        if (typeof e.retryAfterMs === 'number') data.retryAfterMs = e.retryAfterMs;
        if (typeof e.category === 'string') data.category = e.category;
        return {
          type: 'error' as const,
          code: -32603,
          message: e.message ?? 'Tool execution failed',
          data,
        };
      }
    },
    args: [pluginName, toolName, input, dispatchId],
  });

  let timeoutReject: ((err: Error) => void) | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutReject = reject;
    timeoutId = setTimeout(() => {
      reject(new Error(`Script execution timed out after ${SCRIPT_TIMEOUT_MS}ms`));
    }, SCRIPT_TIMEOUT_MS);
  });

  // Register a progress callback that resets the extension-side timeout.
  // Called by background.ts when a tool:progress message arrives.
  progressCallbacks.set(dispatchId, () => {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTs;
    const remainingMax = MAX_SCRIPT_TIMEOUT_MS - elapsed;
    if (remainingMax <= 0) {
      timeoutReject?.(new Error(`Script execution exceeded absolute max timeout of ${MAX_SCRIPT_TIMEOUT_MS}ms`));
      return;
    }
    const nextTimeout = Math.min(SCRIPT_TIMEOUT_MS, remainingMax);
    timeoutId = setTimeout(() => {
      timeoutReject?.(new Error(`Script execution timed out after ${SCRIPT_TIMEOUT_MS}ms`));
    }, nextTimeout);
  });

  let results: Awaited<typeof scriptPromise>;
  try {
    results = await Promise.race([scriptPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
    progressCallbacks.delete(dispatchId);
  }

  const firstResult = results[0] as { result?: unknown } | undefined;
  const result = firstResult?.result as ToolResult | undefined;

  if (!result || typeof result !== 'object' || !('type' in result)) {
    return { type: 'error', code: -32603, message: 'No result from tool execution' };
  }

  return result;
};

/**
 * Whether a ToolResult is an adapter-not-ready error that should trigger
 * fallback to the next matching tab.
 */
const isAdapterNotReady = (result: ToolResult): boolean => result.type === 'error' && result.code === -32002;

/**
 * Handle tool.dispatch request from MCP server.
 * Finds matching tabs, checks adapter readiness (with fallback to other
 * matching tabs when the best-ranked tab is not ready), executes the tool,
 * and returns the result.
 */
const handleToolDispatch = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  // dispatchId is the correlation key for progress reporting, injected by the MCP server
  const dispatchId = typeof params.dispatchId === 'string' ? params.dispatchId : String(id);

  const pluginName = params.plugin;
  if (typeof pluginName !== 'string' || pluginName.length === 0) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Missing or invalid "plugin" param (expected non-empty string)' },
      id,
    });
    return;
  }

  const toolName = params.tool;
  if (typeof toolName !== 'string' || toolName.length === 0) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Missing or invalid "tool" param (expected non-empty string)' },
      id,
    });
    return;
  }

  const rawInput = params.input;
  if (rawInput !== undefined && rawInput !== null && (typeof rawInput !== 'object' || Array.isArray(rawInput))) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Invalid "input" param (expected object)' },
      id,
    });
    return;
  }
  const input = (rawInput ?? {}) as Record<string, unknown>;

  const MAX_INPUT_SIZE = 10 * 1024 * 1024;
  const inputJson = JSON.stringify(input);
  if (inputJson.length > MAX_INPUT_SIZE) {
    sendToServer({
      jsonrpc: '2.0',
      error: {
        code: -32602,
        message: `Tool input too large: ${(inputJson.length / 1024 / 1024).toFixed(1)}MB (limit: 10MB)`,
      },
      id,
    });
    return;
  }

  const plugin = await getPluginMeta(pluginName);
  if (!plugin) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: `Plugin "${pluginName}" not found` },
      id,
    });
    return;
  }

  const matchingTabs = await findAllMatchingTabs(plugin);
  if (matchingTabs.length === 0) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32001, message: `No matching tab for plugin "${pluginName}" (state: closed)` },
      id,
    });
    return;
  }

  const link = getPluginLink(plugin);

  // Try matching tabs in ranked order. If the best tab's adapter is not ready
  // (code -32002), fall back to the next matching tab.
  let firstError:
    | {
        code: number;
        message: string;
        data?: { code: string; retryable?: boolean; retryAfterMs?: number; category?: string };
      }
    | undefined;

  for (const tab of matchingTabs) {
    if (tab.id === undefined) continue;

    // Re-validate tab URL to prevent TOCTOU race: the tab may have navigated
    // between findAllMatchingTabs() and now.
    try {
      const currentTab = await chrome.tabs.get(tab.id);
      if (!currentTab.url || !urlMatchesPatterns(currentTab.url, plugin.urlPatterns)) {
        firstError ??= { code: -32001, message: 'Tab navigated away from matching URL' };
        continue;
      }
    } catch {
      firstError ??= { code: -32001, message: 'Tab closed before tool execution' };
      continue;
    }

    try {
      await injectToolInvocationLog(tab.id, pluginName, toolName, link);
      await injectProgressListener(tab.id, dispatchId);
      try {
        const result = await executeToolOnTab(tab.id, pluginName, toolName, input, dispatchId);

        if (result.type === 'success') {
          sendToServer({ jsonrpc: '2.0', result: { output: result.output }, id });
          return;
        }

        // Adapter-not-ready errors trigger fallback to the next matching tab
        if (isAdapterNotReady(result) && matchingTabs.length > 1) {
          firstError ??= { code: result.code, message: result.message };
          continue;
        }

        sendToServer({
          jsonrpc: '2.0',
          error: { code: result.code, message: result.message, data: result.data },
          id,
        });
        return;
      } finally {
        removeProgressListener(tab.id, dispatchId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTabGone = msg.includes('No tab with id') || msg.includes('Cannot access');
      if (isTabGone && matchingTabs.length > 1) {
        firstError ??= { code: -32001, message: 'Tab closed before tool execution' };
        continue;
      }
      sendToServer({
        jsonrpc: '2.0',
        error: {
          code: isTabGone ? -32001 : -32603,
          message: isTabGone
            ? 'Tab closed before tool execution'
            : `Script execution failed: ${sanitizeErrorMessage(msg)}`,
        },
        id,
      });
      return;
    }
  }

  // All matching tabs failed — return the error from the best-ranked tab
  if (firstError) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: firstError.code, message: firstError.message, data: firstError.data },
      id,
    });
  }
};

export { handleToolDispatch, notifyDispatchProgress };
