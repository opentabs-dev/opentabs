import { requireTabId, sendErrorResult, sendSuccessResult } from './helpers.js';
import { bgLogCollector } from '../background-log-state.js';
import {
  DEFAULT_LOG_LIMIT,
  DEFAULT_SERVER_PORT,
  EXEC_MAX_ASYNC_WAIT_MS,
  EXEC_POLL_INTERVAL_MS,
  EXEC_RESULT_TRUNCATION_LIMIT,
  IS_READY_TIMEOUT_MS,
  SCRIPT_TIMEOUT_MS,
  SERVER_PORT_KEY,
  SIDE_PANEL_TIMEOUT_MS,
  WS_CONNECTED_KEY,
  WS_FLUSH_DELAY_MS,
} from '../constants.js';
import { JSONRPC_INVALID_PARAMS } from '../json-rpc-errors.js';
import { sendToServer } from '../messaging.js';
import { getActiveCapturesSummary } from '../network-capture.js';
import { getAllPluginMeta, getPluginMeta } from '../plugin-storage.js';
import { findAllMatchingTabs } from '../tab-matching.js';
import { getLastKnownStates } from '../tab-state.js';
import type { BgForceReconnectMessage, OffscreenGetLogsMessage, SpGetStateMessage } from '../extension-messages.js';
import type { LogEntry, LogFilterOptions, LogStats } from '../log-collector.js';

export const handleExtensionGetState = async (id: string | number): Promise<void> => {
  try {
    // Connection state from chrome.storage.session
    const sessionData: Record<string, unknown> = await chrome.storage.session
      .get(WS_CONNECTED_KEY)
      .catch(() => ({}) as Record<string, unknown>);
    const wsConnected = typeof sessionData[WS_CONNECTED_KEY] === 'boolean' ? sessionData[WS_CONNECTED_KEY] : false;

    // MCP server URL derived from port in chrome.storage.local
    const localData: Record<string, unknown> = await chrome.storage.local
      .get(SERVER_PORT_KEY)
      .catch(() => ({}) as Record<string, unknown>);
    const port =
      typeof localData[SERVER_PORT_KEY] === 'number' && localData[SERVER_PORT_KEY] > 0
        ? localData[SERVER_PORT_KEY]
        : DEFAULT_SERVER_PORT;
    const mcpServerUrl = `ws://localhost:${port}/ws`;

    // Plugin metadata with tab states
    const pluginIndex = await getAllPluginMeta();
    const lastKnownStates = getLastKnownStates();
    const plugins = Object.values(pluginIndex).map(meta => ({
      name: meta.name,
      version: meta.version,
      displayName: meta.displayName,
      urlPatterns: meta.urlPatterns,
      toolCount: meta.tools.length,
      tabState: lastKnownStates.get(meta.name) ?? 'closed',
    }));

    // Active network captures
    const networkCaptures = getActiveCapturesSummary();

    // Offscreen document existence
    let offscreenExists = false;
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
      });
      offscreenExists = contexts.length > 0;
    } catch {
      // chrome.runtime.getContexts may not be available in all Chrome versions
    }

    sendSuccessResult(id, {
      connection: { wsConnected, mcpServerUrl },
      plugins,
      networkCaptures,
      offscreen: { exists: offscreenExists },
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleExtensionGetLogs = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const filterOptions: LogFilterOptions = {};
    if (typeof params.level === 'string' && params.level !== 'all') {
      filterOptions.level = params.level as LogFilterOptions['level'];
    }
    if (typeof params.source === 'string' && params.source !== 'all') {
      filterOptions.source = params.source as LogFilterOptions['source'];
    }
    if (typeof params.limit === 'number') {
      filterOptions.limit = params.limit;
    }
    if (typeof params.since === 'number') {
      filterOptions.since = params.since;
    }

    // Get background logs directly from the local collector
    const bgEntries = bgLogCollector.getEntries(filterOptions);
    const bgStats = bgLogCollector.getStats();

    // Get offscreen logs via internal message
    let offscreenEntries: LogEntry[] = [];
    let offscreenStats: LogStats = {
      totalCaptured: 0,
      bufferSize: 0,
      oldestTimestamp: null,
      newestTimestamp: null,
    };
    try {
      const raw: unknown = await chrome.runtime.sendMessage({
        type: 'offscreen:getLogs',
        options: Object.keys(filterOptions).length > 0 ? filterOptions : undefined,
      } satisfies OffscreenGetLogsMessage);
      const response = raw as { entries?: LogEntry[]; stats?: LogStats } | undefined;
      if (response && Array.isArray(response.entries)) {
        offscreenEntries = response.entries;
      }
      if (response?.stats) {
        offscreenStats = response.stats;
      }
    } catch {
      // Offscreen document may not be running
    }

    // Merge entries by timestamp (newest first — both arrays are already newest-first)
    const merged = [...bgEntries, ...offscreenEntries].sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit to the merged result
    const limit = filterOptions.limit ?? DEFAULT_LOG_LIMIT;
    const entries = merged.slice(0, limit);

    sendSuccessResult(id, {
      entries,
      stats: {
        totalBackground: bgStats.totalCaptured,
        totalOffscreen: offscreenStats.totalCaptured,
        bufferSize: bgStats.bufferSize + offscreenStats.bufferSize,
      },
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleExtensionGetSidePanel = async (id: string | number): Promise<void> => {
  try {
    const sidePanelResult = await Promise.race([
      chrome.runtime.sendMessage({ type: 'sp:getState' } satisfies SpGetStateMessage).then((raw: unknown) => raw),
      new Promise<null>(resolve => setTimeout(() => resolve(null), SIDE_PANEL_TIMEOUT_MS)),
    ]);

    if (!sidePanelResult || typeof sidePanelResult !== 'object') {
      sendToServer({ jsonrpc: '2.0', result: { open: false }, id });
      return;
    }

    const response = sidePanelResult as { state?: unknown; html?: string };
    sendToServer({
      jsonrpc: '2.0',
      result: { open: true, state: response.state, html: response.html },
      id,
    });
  } catch {
    // Side panel not open or message failed — return { open: false }
    sendToServer({ jsonrpc: '2.0', result: { open: false }, id });
  }
};

export const handleExtensionCheckAdapter = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const pluginName = params.plugin;
    if (typeof pluginName !== 'string' || pluginName.length === 0) {
      sendToServer({
        jsonrpc: '2.0',
        error: { code: JSONRPC_INVALID_PARAMS, message: 'Missing or invalid plugin parameter' },
        id,
      });
      return;
    }

    const meta = await getPluginMeta(pluginName);
    if (!meta) {
      sendToServer({
        jsonrpc: '2.0',
        error: { code: JSONRPC_INVALID_PARAMS, message: `Plugin not found: "${pluginName}"` },
        id,
      });
      return;
    }

    const matchingTabs = await findAllMatchingTabs(meta);

    const tabResults = await Promise.allSettled(
      matchingTabs.map(async tab => {
        const tabId = tab.id;
        if (tabId === undefined) return null;

        // Inspect the adapter in the tab's MAIN world
        const inspectResults = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (pName: string) => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | { adapters?: Record<string, Record<string, unknown>> }
              | undefined;
            const adapter = ot?.adapters?.[pName];
            if (!adapter || typeof adapter !== 'object') {
              return { adapterPresent: false };
            }
            const toolNames: string[] = [];
            if (Array.isArray(adapter.tools)) {
              for (const tool of adapter.tools as unknown[]) {
                if (tool && typeof tool === 'object' && typeof (tool as Record<string, unknown>).name === 'string') {
                  toolNames.push((tool as Record<string, unknown>).name as string);
                }
              }
            }
            return {
              adapterPresent: true,
              adapterHash: typeof adapter.__hash === 'string' ? adapter.__hash : null,
              toolCount: toolNames.length,
              toolNames,
            };
          },
          args: [pluginName],
        });

        const inspectResult = inspectResults[0]?.result as
          | {
              adapterPresent: boolean;
              adapterHash?: string | null;
              toolCount?: number;
              toolNames?: string[];
            }
          | undefined;

        if (!inspectResult) {
          return {
            tabId,
            tabUrl: tab.url ?? '',
            adapterPresent: false,
            adapterHash: null,
            hashMatch: false,
            isReady: false,
            toolCount: 0,
            toolNames: [],
          };
        }

        if (!inspectResult.adapterPresent) {
          return {
            tabId,
            tabUrl: tab.url ?? '',
            adapterPresent: false,
            adapterHash: null,
            hashMatch: false,
            isReady: false,
            toolCount: 0,
            toolNames: [],
          };
        }

        // Probe isReady() with timeout
        let isReady = false;
        try {
          const readyResults = await Promise.race([
            chrome.scripting.executeScript({
              target: { tabId },
              world: 'MAIN',
              func: async (pName: string) => {
                const ot = (globalThis as Record<string, unknown>).__openTabs as
                  | { adapters?: Record<string, { isReady?: unknown }> }
                  | undefined;
                const adapter = ot?.adapters?.[pName];
                if (!adapter || typeof adapter.isReady !== 'function') return false;
                return await (adapter.isReady as () => Promise<boolean>)();
              },
              args: [pluginName],
            }),
            new Promise<null>(resolve => setTimeout(() => resolve(null), IS_READY_TIMEOUT_MS)),
          ]);
          if (readyResults !== null) {
            const readyResult = (readyResults as Array<{ result?: unknown }>)[0];
            isReady = readyResult?.result === true;
          }
        } catch {
          // isReady probe failed — leave as false
        }

        return {
          tabId,
          tabUrl: tab.url ?? '',
          adapterPresent: true,
          adapterHash: inspectResult.adapterHash ?? null,
          hashMatch: meta.adapterHash ? inspectResult.adapterHash === meta.adapterHash : false,
          isReady,
          toolCount: inspectResult.toolCount ?? 0,
          toolNames: inspectResult.toolNames ?? [],
        };
      }),
    );

    const matchingTabResults: unknown[] = [];
    for (const result of tabResults) {
      if (result.status === 'fulfilled' && result.value !== null) {
        matchingTabResults.push(result.value);
      }
    }

    sendSuccessResult(id, {
      plugin: pluginName,
      expectedHash: meta.adapterHash ?? null,
      matchingTabs: matchingTabResults,
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleExtensionForceReconnect = async (id: string | number): Promise<void> => {
  try {
    // Send the success response FIRST, before the WebSocket is torn down.
    // The response travels over the current WebSocket connection; if we
    // close it first, the response would never reach the MCP server.
    sendToServer({ jsonrpc: '2.0', result: { reconnecting: true }, id });

    await new Promise(resolve => setTimeout(resolve, WS_FLUSH_DELAY_MS));

    await chrome.runtime.sendMessage({
      type: 'bg:forceReconnect',
    } satisfies BgForceReconnectMessage);
  } catch (err) {
    // The response was already sent above, so this catch is best-effort.
    // If sendToServer itself failed, there's nothing more we can do.
    console.warn('[opentabs] extension.forceReconnect failed:', err);
  }
};

/**
 * Executes a pre-written JavaScript file in a tab's MAIN world, supporting both sync and async code.
 * @param params - Expects `{ tabId: number, execFile: string }` where execFile matches the `__exec-<uuid>.js` pattern.
 * @returns The script's return value, serialized as JSON. Async scripts are polled until resolved or timed out.
 */
export const handleBrowserExecuteScript = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const execFile = params.execFile;
    if (typeof execFile !== 'string' || execFile.length === 0) {
      sendToServer({
        jsonrpc: '2.0',
        error: { code: JSONRPC_INVALID_PARAMS, message: 'Missing or invalid execFile parameter' },
        id,
      });
      return;
    }
    if (!/^__exec-[a-f0-9-]+\.js$/.test(execFile)) {
      sendToServer({ jsonrpc: '2.0', error: { code: JSONRPC_INVALID_PARAMS, message: 'Invalid execFile format' }, id });
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Step 1: Inject the exec file into the tab's MAIN world (bypasses page CSP)
    const injectPromise = (async () => {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: [`adapters/${execFile}`],
      });

      // Step 2: Read the result. For sync code, __lastExecResult is set
      // immediately by the wrapper. For async code (Promises), the wrapper
      // sets __lastExecAsync=true and resolves __lastExecResult when the
      // Promise settles. Poll until the result is available.
      let elapsed = 0;

      while (elapsed <= EXEC_MAX_ASYNC_WAIT_MS) {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (truncLimit: number) => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as
              | {
                  __lastExecResult?: { value?: unknown; error?: string };
                  __lastExecAsync?: boolean;
                }
              | undefined;
            if (!ot) return { pending: false, result: { error: '__openTabs not found' } };

            const result = ot.__lastExecResult;
            const isAsync = ot.__lastExecAsync === true;

            // Result available (sync or async resolved) — read and clean up
            if (result && ('value' in result || 'error' in result)) {
              const captured = { ...result };
              // undefined is dropped by structured cloning — normalize to null
              if (captured.value === undefined) captured.value = null;
              // Serialize non-primitive values
              if (captured.value !== null && typeof captured.value === 'object') {
                try {
                  const json = JSON.stringify(captured.value);
                  captured.value =
                    json.length > truncLimit ? json.slice(0, truncLimit) + '... (truncated)' : JSON.parse(json);
                } catch {
                  captured.value = String(captured.value);
                }
              }
              // Clean up globals
              delete ot.__lastExecResult;
              delete ot.__lastExecAsync;
              return { pending: false, result: captured };
            }

            // Async code hasn't resolved yet — keep polling
            if (isAsync) return { pending: true };

            // Sync code produced no __lastExecResult (should not happen)
            return { pending: false, result: { error: 'No result captured' } };
          },
          args: [EXEC_RESULT_TRUNCATION_LIMIT],
        });

        const first = results[0] as { result?: { pending: boolean; result?: unknown } } | undefined;
        const data = first?.result;

        if (data && !data.pending) {
          return { value: data.result };
        }

        // Still pending — wait and retry
        await new Promise(resolve => setTimeout(resolve, EXEC_POLL_INTERVAL_MS));
        elapsed += EXEC_POLL_INTERVAL_MS;
      }

      // Async timed out — clean up and report error
      await chrome.scripting
        .executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            const ot = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
            if (ot) {
              delete ot.__lastExecResult;
              delete ot.__lastExecAsync;
            }
          },
        })
        .catch(() => {});

      return { value: { error: `Async code did not resolve within ${EXEC_MAX_ASYNC_WAIT_MS}ms` } };
    })();

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Script execution timed out after ${SCRIPT_TIMEOUT_MS}ms`));
      }, SCRIPT_TIMEOUT_MS);
    });

    let result: unknown;
    try {
      result = await Promise.race([injectPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }

    sendSuccessResult(id, result);
  } catch (err) {
    sendErrorResult(id, err);
  }
};
