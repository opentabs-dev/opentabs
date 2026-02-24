import { MAX_INPUT_SIZE, MAX_SCRIPT_TIMEOUT_MS, SCRIPT_TIMEOUT_MS } from './constants.js';
import { dispatchWithTabFallback, requireStringParam, resolvePlugin } from './dispatch-helpers.js';
import { JSONRPC_INTERNAL_ERROR, JSONRPC_INVALID_PARAMS } from './json-rpc-errors.js';
import { sendToServer } from './messaging.js';
import { toErrorMessage } from '@opentabs-dev/shared';
import type { DispatchResult } from './dispatch-helpers.js';
import type { PluginMeta } from './extension-messages.js';

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
): Promise<DispatchResult> => {
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

      // Defense-in-depth: reject adapters that are not frozen. Legitimate
      // adapters are always frozen by the hashAndFreeze snippet appended to
      // the IIFE. An unfrozen adapter indicates tampering by a page script.
      if (!Object.isFrozen(adapter)) {
        return {
          type: 'error' as const,
          code: -32002,
          message: `Adapter "${pName}" failed integrity check (not frozen)`,
        };
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
        const caughtError = err as {
          message?: string;
          code?: string;
          retryable?: boolean;
          retryAfterMs?: number;
          category?: string;
        };
        if (typeof caughtError.code !== 'string') {
          return {
            type: 'error' as const,
            code: -32603,
            message: caughtError.message ?? 'Tool execution failed',
          };
        }
        const data: {
          code: string;
          retryable?: boolean;
          retryAfterMs?: number;
          category?: string;
        } = { code: caughtError.code };
        if (typeof caughtError.retryable === 'boolean') data.retryable = caughtError.retryable;
        if (typeof caughtError.retryAfterMs === 'number') data.retryAfterMs = caughtError.retryAfterMs;
        if (typeof caughtError.category === 'string') data.category = caughtError.category;
        return {
          type: 'error' as const,
          code: -32603,
          message: caughtError.message ?? 'Tool execution failed',
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
  const result = firstResult?.result as DispatchResult | undefined;

  if (!result || typeof result !== 'object' || !('type' in result)) {
    return { type: 'error', code: JSONRPC_INTERNAL_ERROR, message: 'No result from tool execution' };
  }

  return result;
};

/**
 * Handle tool.dispatch request from MCP server.
 * Finds matching tabs, checks adapter readiness (with fallback to other
 * matching tabs when the best-ranked tab is not ready), executes the tool,
 * and returns the result.
 */
const handleToolDispatch = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  // dispatchId is the correlation key for progress reporting, injected by the MCP server
  const dispatchId = typeof params.dispatchId === 'string' ? params.dispatchId : String(id);

  const pluginName = requireStringParam(params, 'plugin', id);
  if (!pluginName) return;

  const toolName = requireStringParam(params, 'tool', id);
  if (!toolName) return;

  const rawInput = params.input;
  if (rawInput !== undefined && rawInput !== null && (typeof rawInput !== 'object' || Array.isArray(rawInput))) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: JSONRPC_INVALID_PARAMS, message: 'Invalid "input" param (expected object)' },
      id,
    });
    return;
  }
  const input = (rawInput ?? {}) as Record<string, unknown>;

  let inputJson: string;
  try {
    inputJson = JSON.stringify(input);
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: {
        code: JSONRPC_INVALID_PARAMS,
        message: `Failed to serialize tool input: ${toErrorMessage(err)}`,
      },
      id,
    });
    return;
  }
  if (inputJson.length > MAX_INPUT_SIZE) {
    sendToServer({
      jsonrpc: '2.0',
      error: {
        code: JSONRPC_INVALID_PARAMS,
        message: `Tool input too large: ${(inputJson.length / 1024 / 1024).toFixed(1)}MB (limit: 10MB)`,
      },
      id,
    });
    return;
  }

  const plugin = await resolvePlugin(pluginName, id);
  if (!plugin) return;

  const link = getPluginLink(plugin);

  await dispatchWithTabFallback({
    id,
    pluginName,
    plugin,
    operationName: 'tool execution',
    executeOnTab: async tabId => {
      await injectToolInvocationLog(tabId, pluginName, toolName, link);
      await injectProgressListener(tabId, dispatchId);
      try {
        return await executeToolOnTab(tabId, pluginName, toolName, input, dispatchId);
      } finally {
        removeProgressListener(tabId, dispatchId);
      }
    },
  });
};

export { handleToolDispatch, notifyDispatchProgress };
