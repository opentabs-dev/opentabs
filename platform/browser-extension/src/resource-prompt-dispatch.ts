import { SCRIPT_TIMEOUT_MS } from './constants.js';
import { sendToServer } from './messaging.js';
import { getPluginMeta } from './plugin-storage.js';
import { sanitizeErrorMessage } from './sanitize-error.js';
import { findAllMatchingTabs, urlMatchesPatterns } from './tab-matching.js';

type DispatchResult =
  | {
      type: 'error';
      code: number;
      message: string;
    }
  | { type: 'success'; output: unknown };

/**
 * Execute a resource read on a specific tab. Returns the structured result
 * from the adapter script, or throws if the tab is inaccessible.
 */
const executeResourceReadOnTab = async (
  tabId: number,
  pluginName: string,
  resourceUri: string,
): Promise<DispatchResult> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const scriptPromise = chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (pName: string, uri: string) => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as
        | {
            adapters?: Record<
              string,
              {
                isReady(): Promise<boolean>;
                resources?: Array<{
                  uri: string;
                  read(uri: string): Promise<unknown>;
                }>;
              }
            >;
          }
        | undefined;
      const adapter = ot?.adapters?.[pName];
      if (!adapter || typeof adapter !== 'object') {
        return { type: 'error' as const, code: -32002, message: `Adapter "${pName}" not injected or not ready` };
      }

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

      if (!Array.isArray(adapter.resources)) {
        return { type: 'error' as const, code: -32603, message: `Adapter "${pName}" has no resources array` };
      }

      const resource = adapter.resources.find((r: { uri: string }) => r.uri === uri);
      if (!resource || typeof resource.read !== 'function') {
        return { type: 'error' as const, code: -32603, message: `Resource "${uri}" not found in adapter "${pName}"` };
      }

      try {
        const output = await resource.read(uri);
        return { type: 'success' as const, output };
      } catch (err: unknown) {
        const caughtError = err as { message?: string };
        return {
          type: 'error' as const,
          code: -32603,
          message: caughtError.message ?? 'Resource read failed',
        };
      }
    },
    args: [pluginName, resourceUri],
  });

  let timeoutReject: ((err: Error) => void) | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutReject = reject;
    timeoutId = setTimeout(() => {
      reject(new Error(`Script execution timed out after ${SCRIPT_TIMEOUT_MS}ms`));
    }, SCRIPT_TIMEOUT_MS);
  });
  // Suppress "unhandled rejection" when the script completes before the timeout
  void timeoutReject;

  let results: Awaited<typeof scriptPromise>;
  try {
    results = await Promise.race([scriptPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }

  const firstResult = results[0] as { result?: unknown } | undefined;
  const result = firstResult?.result as DispatchResult | undefined;

  if (!result || typeof result !== 'object' || !('type' in result)) {
    return { type: 'error', code: -32603, message: 'No result from resource read' };
  }

  return result;
};

/**
 * Execute a prompt render on a specific tab. Returns the structured result
 * from the adapter script, or throws if the tab is inaccessible.
 */
const executePromptGetOnTab = async (
  tabId: number,
  pluginName: string,
  promptName: string,
  promptArgs: Record<string, string>,
): Promise<DispatchResult> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const scriptPromise = chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (pName: string, pPromptName: string, pArgs: Record<string, string>) => {
      const ot = (globalThis as Record<string, unknown>).__openTabs as
        | {
            adapters?: Record<
              string,
              {
                isReady(): Promise<boolean>;
                prompts?: Array<{
                  name: string;
                  render(args: Record<string, string>): Promise<unknown>;
                }>;
              }
            >;
          }
        | undefined;
      const adapter = ot?.adapters?.[pName];
      if (!adapter || typeof adapter !== 'object') {
        return { type: 'error' as const, code: -32002, message: `Adapter "${pName}" not injected or not ready` };
      }

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

      if (!Array.isArray(adapter.prompts)) {
        return { type: 'error' as const, code: -32603, message: `Adapter "${pName}" has no prompts array` };
      }

      const prompt = adapter.prompts.find((p: { name: string }) => p.name === pPromptName);
      if (!prompt || typeof prompt.render !== 'function') {
        return {
          type: 'error' as const,
          code: -32603,
          message: `Prompt "${pPromptName}" not found in adapter "${pName}"`,
        };
      }

      try {
        const output = await prompt.render(pArgs);
        return { type: 'success' as const, output };
      } catch (err: unknown) {
        const caughtError = err as { message?: string };
        return {
          type: 'error' as const,
          code: -32603,
          message: caughtError.message ?? 'Prompt render failed',
        };
      }
    },
    args: [pluginName, promptName, promptArgs],
  });

  let timeoutReject: ((err: Error) => void) | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutReject = reject;
    timeoutId = setTimeout(() => {
      reject(new Error(`Script execution timed out after ${SCRIPT_TIMEOUT_MS}ms`));
    }, SCRIPT_TIMEOUT_MS);
  });
  void timeoutReject;

  let results: Awaited<typeof scriptPromise>;
  try {
    results = await Promise.race([scriptPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }

  const firstResult = results[0] as { result?: unknown } | undefined;
  const result = firstResult?.result as DispatchResult | undefined;

  if (!result || typeof result !== 'object' || !('type' in result)) {
    return { type: 'error', code: -32603, message: 'No result from prompt render' };
  }

  return result;
};

/** Whether a DispatchResult is an adapter-not-ready error that should trigger fallback */
const isAdapterNotReady = (result: DispatchResult): boolean => result.type === 'error' && result.code === -32002;

/**
 * Handle resource.read request from MCP server.
 * Finds matching tabs, checks adapter readiness, executes the resource read,
 * and returns the result.
 */
const handleResourceRead = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  const pluginName = params.plugin;
  if (typeof pluginName !== 'string' || pluginName.length === 0) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Missing or invalid "plugin" param (expected non-empty string)' },
      id,
    });
    return;
  }

  const resourceUri = params.uri;
  if (typeof resourceUri !== 'string' || resourceUri.length === 0) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Missing or invalid "uri" param (expected non-empty string)' },
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

  let firstError: { code: number; message: string } | undefined;

  for (const tab of matchingTabs) {
    if (tab.id === undefined) continue;

    try {
      const currentTab = await chrome.tabs.get(tab.id);
      if (!currentTab.url || !urlMatchesPatterns(currentTab.url, plugin.urlPatterns)) {
        firstError ??= { code: -32001, message: 'Tab navigated away from matching URL' };
        continue;
      }
    } catch {
      firstError ??= { code: -32001, message: 'Tab closed before resource read' };
      continue;
    }

    try {
      const result = await executeResourceReadOnTab(tab.id, pluginName, resourceUri);

      if (result.type === 'success') {
        sendToServer({ jsonrpc: '2.0', result: { output: result.output }, id });
        return;
      }

      if (isAdapterNotReady(result) && matchingTabs.length > 1) {
        firstError ??= { code: result.code, message: result.message };
        continue;
      }

      sendToServer({
        jsonrpc: '2.0',
        error: { code: result.code, message: result.message },
        id,
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTabGone = msg.includes('No tab with id') || msg.includes('Cannot access');
      if (isTabGone && matchingTabs.length > 1) {
        firstError ??= { code: -32001, message: 'Tab closed before resource read' };
        continue;
      }
      sendToServer({
        jsonrpc: '2.0',
        error: {
          code: isTabGone ? -32001 : -32603,
          message: isTabGone
            ? 'Tab closed before resource read'
            : `Script execution failed: ${sanitizeErrorMessage(msg)}`,
        },
        id,
      });
      return;
    }
  }

  if (firstError) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: firstError.code, message: firstError.message },
      id,
    });
  } else {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'No usable tab found (all matching tabs have undefined IDs)' },
      id,
    });
  }
};

/**
 * Handle prompt.get request from MCP server.
 * Finds matching tabs, checks adapter readiness, executes the prompt render,
 * and returns the result.
 */
const handlePromptGet = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  const pluginName = params.plugin;
  if (typeof pluginName !== 'string' || pluginName.length === 0) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Missing or invalid "plugin" param (expected non-empty string)' },
      id,
    });
    return;
  }

  const promptName = params.prompt;
  if (typeof promptName !== 'string' || promptName.length === 0) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Missing or invalid "prompt" param (expected non-empty string)' },
      id,
    });
    return;
  }

  const rawArgs = params.arguments;
  if (rawArgs !== undefined && rawArgs !== null && (typeof rawArgs !== 'object' || Array.isArray(rawArgs))) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Invalid "arguments" param (expected object)' },
      id,
    });
    return;
  }
  const promptArgs = (rawArgs ?? {}) as Record<string, string>;

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

  let firstError: { code: number; message: string } | undefined;

  for (const tab of matchingTabs) {
    if (tab.id === undefined) continue;

    try {
      const currentTab = await chrome.tabs.get(tab.id);
      if (!currentTab.url || !urlMatchesPatterns(currentTab.url, plugin.urlPatterns)) {
        firstError ??= { code: -32001, message: 'Tab navigated away from matching URL' };
        continue;
      }
    } catch {
      firstError ??= { code: -32001, message: 'Tab closed before prompt get' };
      continue;
    }

    try {
      const result = await executePromptGetOnTab(tab.id, pluginName, promptName, promptArgs);

      if (result.type === 'success') {
        sendToServer({ jsonrpc: '2.0', result: { output: result.output }, id });
        return;
      }

      if (isAdapterNotReady(result) && matchingTabs.length > 1) {
        firstError ??= { code: result.code, message: result.message };
        continue;
      }

      sendToServer({
        jsonrpc: '2.0',
        error: { code: result.code, message: result.message },
        id,
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTabGone = msg.includes('No tab with id') || msg.includes('Cannot access');
      if (isTabGone && matchingTabs.length > 1) {
        firstError ??= { code: -32001, message: 'Tab closed before prompt get' };
        continue;
      }
      sendToServer({
        jsonrpc: '2.0',
        error: {
          code: isTabGone ? -32001 : -32603,
          message: isTabGone ? 'Tab closed before prompt get' : `Script execution failed: ${sanitizeErrorMessage(msg)}`,
        },
        id,
      });
      return;
    }
  }

  if (firstError) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: firstError.code, message: firstError.message },
      id,
    });
  } else {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'No usable tab found (all matching tabs have undefined IDs)' },
      id,
    });
  }
};

export { handleResourceRead, handlePromptGet };
