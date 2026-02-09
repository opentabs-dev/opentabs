/**
 * Browser controller — handles chrome.tabs.* and chrome.windows.* API calls
 * directly from the background script.
 *
 * Unlike webapp service controllers, this does not use WebappServiceController
 * or implement ServiceManager. It has no tab lifecycle, no adapters, no health
 * checks — it's always available when the extension is connected.
 */

import { createJsonRpcSuccess, createJsonRpcError, JsonRpcErrorCode } from '@extension/shared';
import type { JsonRpcRequest, JsonRpcResponse } from '@extension/shared';

/** Subset of chrome.tabs.Tab fields returned to MCP clients */
interface TabInfo {
  id: number;
  windowId: number;
  url?: string;
  title?: string;
  active: boolean;
  pinned: boolean;
  incognito: boolean;
  status?: string;
  favIconUrl?: string;
  index: number;
}

const formatTab = (tab: chrome.tabs.Tab): TabInfo => ({
  id: tab.id!,
  windowId: tab.windowId,
  url: tab.url,
  title: tab.title,
  active: tab.active,
  pinned: tab.pinned,
  incognito: tab.incognito,
  status: tab.status,
  favIconUrl: tab.favIconUrl,
  index: tab.index,
});

type ActionHandler = (params: Record<string, unknown>) => Promise<unknown>;

class BrowserController {
  private readonly actions: Record<string, ActionHandler> = {
    listTabs: params => this.listTabs(params),
    getTab: params => this.getTab(params),
    openTab: params => this.openTab(params),
    closeTab: params => this.closeTab(params),
    navigateTab: params => this.navigateTab(params),
    focusTab: params => this.focusTab(params),
    executeScript: params => this.executeScript(params),
  };

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { method, id, params } = request;
    const action = method.split('.')[1];

    if (!action) {
      return createJsonRpcError(id, JsonRpcErrorCode.METHOD_NOT_FOUND, `Invalid browser method: ${method}`);
    }

    const handler = this.actions[action];
    if (!handler) {
      return createJsonRpcError(id, JsonRpcErrorCode.METHOD_NOT_FOUND, `Unknown browser action: ${action}`);
    }

    try {
      const result = await handler(params ?? {});
      return createJsonRpcSuccess(id, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return createJsonRpcError(id, JsonRpcErrorCode.INTERNAL_ERROR, message);
    }
  }

  // ===========================================================================
  // Actions
  // ===========================================================================

  private async listTabs(params: Record<string, unknown>): Promise<{ tabs: TabInfo[] }> {
    const query: chrome.tabs.QueryInfo = {};

    if (typeof params.windowId === 'number') query.windowId = params.windowId;
    if (typeof params.active === 'boolean') query.active = params.active;
    if (typeof params.pinned === 'boolean') query.pinned = params.pinned;
    if (typeof params.url === 'string') query.url = params.url;
    if (typeof params.currentWindow === 'boolean') query.currentWindow = params.currentWindow;

    const tabs = await chrome.tabs.query(query);
    return { tabs: tabs.filter(t => t.id != null).map(formatTab) };
  }

  private async getTab(params: Record<string, unknown>): Promise<TabInfo> {
    const tabId = params.tabId as number | undefined;
    if (typeof tabId !== 'number') {
      throw new Error('tabId is required and must be a number');
    }
    const tab = await chrome.tabs.get(tabId);
    return formatTab(tab);
  }

  private async openTab(params: Record<string, unknown>): Promise<TabInfo> {
    const createProps: chrome.tabs.CreateProperties = {};

    if (typeof params.url === 'string') createProps.url = params.url;
    if (typeof params.active === 'boolean') createProps.active = params.active;
    if (typeof params.pinned === 'boolean') createProps.pinned = params.pinned;
    if (typeof params.windowId === 'number') createProps.windowId = params.windowId;

    const tab = await chrome.tabs.create(createProps);
    return formatTab(tab);
  }

  private async closeTab(params: Record<string, unknown>): Promise<{ closed: number[] }> {
    const tabIds = params.tabIds as number[] | undefined;
    const tabId = params.tabId as number | undefined;

    const ids = tabIds ?? (typeof tabId === 'number' ? [tabId] : undefined);
    if (!ids || ids.length === 0) {
      throw new Error('tabId or tabIds is required');
    }

    await chrome.tabs.remove(ids);
    return { closed: ids };
  }

  private async navigateTab(params: Record<string, unknown>): Promise<TabInfo> {
    const tabId = params.tabId as number | undefined;
    const url = params.url as string | undefined;

    if (typeof tabId !== 'number') throw new Error('tabId is required and must be a number');
    if (typeof url !== 'string') throw new Error('url is required and must be a string');

    const tab = await chrome.tabs.update(tabId, { url });
    if (!tab) throw new Error(`Tab ${tabId} not found`);
    return formatTab(tab);
  }

  private async focusTab(params: Record<string, unknown>): Promise<TabInfo> {
    const tabId = params.tabId as number | undefined;
    if (typeof tabId !== 'number') {
      throw new Error('tabId is required and must be a number');
    }

    const tab = await chrome.tabs.update(tabId, { active: true });
    if (!tab) throw new Error(`Tab ${tabId} not found`);
    await chrome.windows.update(tab.windowId, { focused: true });
    return formatTab(tab);
  }

  // ===========================================================================
  // Execute Script — run JS in any tab's MAIN world context
  // ===========================================================================

  private async executeScript(
    params: Record<string, unknown>,
  ): Promise<{ result?: unknown; error?: string; logs: string[] }> {
    const tabId = params.tabId as number | undefined;
    const script = params.script as string | undefined;

    if (typeof tabId !== 'number') throw new Error('tabId is required and must be a number');
    if (typeof script !== 'string' || !script) throw new Error('script is required and must be a non-empty string');

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (code: string) => {
        const logs: string[] = [];
        const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };

        const capture =
          (level: string) =>
          (...args: unknown[]) => {
            logs.push(`[${level}] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`);
            (orig as Record<string, (...a: unknown[]) => void>)[level]?.(...args);
          };

        console.log = capture('log');
        console.warn = capture('warn');
        console.error = capture('error');
        console.info = capture('info');

        const restore = () => Object.assign(console, orig);

        try {
          const fn = new Function(`return (async () => { ${code} })();`);
          const result = await fn();
          restore();
          return { result: result !== undefined ? result : null, logs };
        } catch (err) {
          restore();
          return { error: err instanceof Error ? err.message : String(err), logs };
        }
      },
      args: [script],
    });

    const result = results[0]?.result as { result?: unknown; error?: string; logs: string[] } | undefined;
    return result ?? { error: 'No result from script execution', logs: [] };
  }
}

export { BrowserController };
