import {
  requireStringParam,
  requireTabId,
  sendErrorResult,
  sendSuccessResult,
  sendValidationError,
} from './helpers.js';
import { bgLogCollector } from '../background-log-state.js';
import {
  buildWsUrl,
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
import { getActiveCapturesSummary } from '../network-capture.js';
import { getAllPluginMeta, getPluginMeta } from '../plugin-storage.js';
import { findAllMatchingTabs } from '../tab-matching.js';
import { getAggregateState, getLastKnownStates } from '../tab-state.js';
import type { BgForceReconnectMessage, OffscreenGetLogsMessage, SpGetStateMessage } from '../extension-messages.js';
import type { LogEntry, LogFilterOptions, LogStats } from '../log-collector.js';
import type { PluginTabInfo, TabState } from '@opentabs-dev/shared';

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
    const mcpServerUrl = buildWsUrl(port);

    // Plugin metadata with tab states
    const pluginIndex = await getAllPluginMeta();
    const lastKnownStates = getLastKnownStates();
    const plugins = Object.values(pluginIndex).map(meta => {
      const cached = lastKnownStates.get(meta.name);
      let tabState: TabState = 'closed';
      let tabs: PluginTabInfo[] = [];
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as { state: TabState; tabs: PluginTabInfo[] };
          tabState = parsed.state;
          tabs = parsed.tabs;
        } catch {
          tabState = getAggregateState(cached);
        }
      }
      return {
        name: meta.name,
        version: meta.version,
        displayName: meta.displayName,
        urlPatterns: meta.urlPatterns,
        toolCount: meta.tools.length,
        tabState,
        tabs,
      };
    });

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
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let sidePanelResult: unknown;
    try {
      sidePanelResult = await Promise.race([
        chrome.runtime.sendMessage({ type: 'sp:getState' } satisfies SpGetStateMessage).then((raw: unknown) => raw),
        new Promise<null>(resolve => {
          timeoutId = setTimeout(() => resolve(null), SIDE_PANEL_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!sidePanelResult || typeof sidePanelResult !== 'object') {
      sendSuccessResult(id, { open: false });
      return;
    }

    const response = sidePanelResult as { state?: unknown; html?: string };
    sendSuccessResult(id, { open: true, state: response.state, html: response.html });
  } catch {
    // Side panel not open or message failed — return { open: false }
    sendSuccessResult(id, { open: false });
  }
};

export const handleExtensionCheckAdapter = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const pluginName = requireStringParam(params, 'plugin', id);
    if (pluginName === null) return;

    const meta = await getPluginMeta(pluginName);
    if (!meta) {
      sendValidationError(id, `Plugin not found: "${pluginName}"`);
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
            // Property name must match ADAPTER_HASH_PROP ('__adapterHash') from constants.ts.
            // Cannot reference the constant here — executeScript func is a serialized closure.
            return {
              adapterPresent: true,
              adapterHash: typeof adapter.__adapterHash === 'string' ? adapter.__adapterHash : null,
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
          let isReadyTimeoutId: ReturnType<typeof setTimeout> | undefined;
          let readyResults: unknown;
          try {
            readyResults = await Promise.race([
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
              new Promise<null>(resolve => {
                isReadyTimeoutId = setTimeout(() => resolve(null), IS_READY_TIMEOUT_MS);
              }),
            ]);
          } finally {
            clearTimeout(isReadyTimeoutId);
          }
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
    sendSuccessResult(id, { reconnecting: true });

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
 * Each execution uses namespaced keys (`__execResult_<uuid>`, `__execAsync_<uuid>`) on
 * `globalThis.__openTabs` so concurrent executions on the same tab do not collide.
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
    const execFile = requireStringParam(params, 'execFile', id);
    if (execFile === null) return;
    if (!/^__exec-[a-f0-9-]+\.js$/.test(execFile)) {
      sendValidationError(id, 'Invalid execFile format');
      return;
    }

    // Extract the UUID from the filename for namespaced result keys
    const execUuid = execFile.replace(/^__exec-/, '').replace(/\.js$/, '');
    const resultKey = `__execResult_${execUuid}`;
    const asyncKey = `__execAsync_${execUuid}`;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cancelled = { value: false };

    // Step 1: Inject the exec file into the tab's MAIN world (bypasses page CSP)
    const injectPromise = (async () => {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: [`adapters/${execFile}`],
      });

      // Step 2: Read the result. For sync code, the namespaced result key is set
      // immediately by the wrapper. For async code (Promises), the wrapper
      // sets the namespaced async flag and resolves the result key when the
      // Promise settles. Poll until the result is available.
      let elapsed = 0;

      try {
        while (elapsed <= EXEC_MAX_ASYNC_WAIT_MS) {
          if (cancelled.value) return;
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (truncLimit: number, rKey: string, aKey: string) => {
              const ot = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
              if (!ot) return { pending: false, result: { error: '__openTabs not found' } };

              const result = ot[rKey] as { value?: unknown; error?: string } | undefined;
              const isAsync = ot[aKey] === true;

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
                // Clean up namespaced globals for this execution
                Reflect.deleteProperty(ot, rKey);
                Reflect.deleteProperty(ot, aKey);
                return { pending: false, result: captured };
              }

              // Async code hasn't resolved yet — keep polling
              if (isAsync) return { pending: true };

              // Sync code produced no result (should not happen)
              return { pending: false, result: { error: 'No result captured' } };
            },
            args: [EXEC_RESULT_TRUNCATION_LIMIT, resultKey, asyncKey],
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

        return { value: { error: `Async code did not resolve within ${EXEC_MAX_ASYNC_WAIT_MS}ms` } };
      } finally {
        // Clean up namespaced globals. Runs unconditionally — whether the polling
        // loop found a result, hit the inner timeout, or was cancelled by the outer
        // SCRIPT_TIMEOUT_MS. On the success path the inline cleanup already ran, so
        // this is a no-op. Fire-and-forget: the tab may have navigated away.
        chrome.scripting
          .executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (rKey: string, aKey: string) => {
              const ot = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
              if (ot) {
                Reflect.deleteProperty(ot, rKey);
                Reflect.deleteProperty(ot, aKey);
              }
            },
            args: [resultKey, asyncKey],
          })
          .catch(() => {});
      }
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
      cancelled.value = true;
    }

    sendSuccessResult(id, result);
  } catch (err) {
    sendErrorResult(id, err);
  }
};
