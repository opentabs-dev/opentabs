import { SCRIPT_TIMEOUT_MS } from './constants.js';
import { sendToServer } from './messaging.js';
import {
  isCapturing,
  startCapture,
  stopCapture,
  getRequests,
  getConsoleLogs,
  clearConsoleLogs,
} from './network-capture.js';
import { sanitizeErrorMessage } from './sanitize-error.js';
import { isBlockedUrlScheme } from '@opentabs-dev/shared';

interface CdpFrame {
  id: string;
  url: string;
  securityOrigin: string;
}

interface CdpResource {
  url: string;
  type: string;
  mimeType: string;
  contentLength?: number;
}

interface CdpFrameResourceTree {
  frame: CdpFrame;
  childFrames?: CdpFrameResourceTree[];
  resources: CdpResource[];
}

/** MIME types that represent text content and should be decoded from base64 */
const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = new Set([
  'application/javascript',
  'application/json',
  'application/xml',
  'application/xhtml+xml',
  'application/x-javascript',
  'application/ecmascript',
]);

const isTextMimeType = (mimeType: string): boolean => {
  if (TEXT_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))) return true;
  return TEXT_MIME_EXACT.has(mimeType);
};

/**
 * Find the frameId that owns a resource URL by walking the CDP resource tree.
 * Returns the frame ID or null if the resource is not found in any frame.
 */
const findFrameForResource = (
  tree: CdpFrameResourceTree,
  targetUrl: string,
): { frameId: string; mimeType: string } | null => {
  for (const r of tree.resources) {
    if (r.url === targetUrl) {
      return { frameId: tree.frame.id, mimeType: r.mimeType };
    }
  }
  if (tree.childFrames) {
    for (const child of tree.childFrames) {
      const found = findFrameForResource(child, targetUrl);
      if (found) return found;
    }
  }
  return null;
};

export const handleBrowserListTabs = async (id: string | number): Promise<void> => {
  try {
    const tabs = await chrome.tabs.query({});
    const result = tabs.map(tab => ({
      id: tab.id,
      title: tab.title ?? '',
      url: tab.url ?? '',
      active: tab.active,
      windowId: tab.windowId,
    }));
    sendToServer({ jsonrpc: '2.0', result, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserOpenTab = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const url = params.url;
    if (typeof url !== 'string') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid url parameter' }, id });
      return;
    }
    if (isBlockedUrlScheme(url)) {
      sendToServer({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'URL scheme not allowed (javascript:, data:, file:, chrome:, blob: are blocked)',
        },
        id,
      });
      return;
    }
    const tab = await chrome.tabs.create({ url });
    sendToServer({
      jsonrpc: '2.0',
      result: { id: tab.id, title: tab.title ?? '', url: tab.url ?? url, windowId: tab.windowId },
      id,
    });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserCloseTab = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    await chrome.tabs.remove(tabId);
    sendToServer({ jsonrpc: '2.0', result: { ok: true }, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserNavigateTab = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = params.tabId;
    const url = params.url;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    if (typeof url !== 'string') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid url parameter' }, id });
      return;
    }
    if (isBlockedUrlScheme(url)) {
      sendToServer({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'URL scheme not allowed (javascript:, data:, file:, chrome:, blob: are blocked)',
        },
        id,
      });
      return;
    }
    const tab = await chrome.tabs.update(tabId, { url });
    sendToServer({
      jsonrpc: '2.0',
      result: { id: tab?.id ?? tabId, title: tab?.title ?? '', url: tab?.url ?? url },
      id,
    });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserFocusTab = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (!tab) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: `Tab ${tabId} not found` }, id });
      return;
    }
    await chrome.windows.update(tab.windowId, { focused: true });
    sendToServer({
      jsonrpc: '2.0',
      result: { id: tab.id, title: tab.title ?? '', url: tab.url ?? '', active: true },
      id,
    });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserGetTabInfo = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const tab = await chrome.tabs.get(tabId);
    sendToServer({
      jsonrpc: '2.0',
      result: {
        id: tab.id,
        title: tab.title ?? '',
        url: tab.url ?? '',
        status: tab.status ?? '',
        active: tab.active,
        windowId: tab.windowId,
        favIconUrl: tab.favIconUrl ?? '',
        incognito: tab.incognito,
      },
      id,
    });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserScreenshotTab = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (!tab) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: `Tab ${tabId} not found` }, id });
      return;
    }
    await chrome.windows.update(tab.windowId, { focused: true });
    // Small delay for the tab to render after focus
    await new Promise(resolve => setTimeout(resolve, 100));
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    sendToServer({ jsonrpc: '2.0', result: { image: base64 }, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserGetTabContent = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const selector = typeof params.selector === 'string' ? params.selector : 'body';
    const maxLength = typeof params.maxLength === 'number' ? params.maxLength : 50000;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel: string, max: number) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };
        return {
          title: document.title,
          url: document.URL,
          content: ((el as HTMLElement).innerText || '').trim().slice(0, max),
        };
      },
      args: [selector, maxLength],
    });

    const result = results[0]?.result as { error?: string; title?: string; url?: string; content?: string } | undefined;
    if (!result) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32603, message: 'No result from script execution' }, id });
      return;
    }
    if (result.error) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: result.error }, id });
      return;
    }
    sendToServer({ jsonrpc: '2.0', result: { title: result.title, url: result.url, content: result.content }, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserGetPageHtml = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const selector = typeof params.selector === 'string' ? params.selector : 'html';
    const maxLength = typeof params.maxLength === 'number' ? params.maxLength : 200000;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel: string, max: number) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };
        const html = el.outerHTML;
        return {
          title: document.title,
          url: document.URL,
          html: html.length > max ? html.slice(0, max) + '... (truncated)' : html,
        };
      },
      args: [selector, maxLength],
    });

    const result = results[0]?.result as { error?: string; title?: string; url?: string; html?: string } | undefined;
    if (!result) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32603, message: 'No result from script execution' }, id });
      return;
    }
    if (result.error) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: result.error }, id });
      return;
    }
    sendToServer({ jsonrpc: '2.0', result: { title: result.title, url: result.url, html: result.html }, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserGetStorage = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const storageType = typeof params.storageType === 'string' ? params.storageType : 'local';
    if (storageType !== 'local' && storageType !== 'session') {
      sendToServer({
        jsonrpc: '2.0',
        error: { code: -32602, message: "storageType must be 'local' or 'session'" },
        id,
      });
      return;
    }
    const key = typeof params.key === 'string' ? params.key : undefined;

    const MAX_VALUE_LENGTH = 10000;
    const MAX_RESPONSE_LENGTH = 500_000;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (type: string, k: string | null, maxVal: number, maxResp: number) => {
        const storage = type === 'session' ? window.sessionStorage : window.localStorage;

        if (k !== null) {
          const value = storage.getItem(k);
          return {
            mode: 'single' as const,
            key: k,
            value: value !== null && value.length > maxVal ? value.slice(0, maxVal) + '... (truncated)' : value,
          };
        }

        const entries: Array<{ key: string; value: string }> = [];
        let totalLength = 0;
        const keys = Object.keys(storage);
        for (const entryKey of keys) {
          const raw = storage.getItem(entryKey);
          if (raw === null) continue;
          const value = raw.length > maxVal ? raw.slice(0, maxVal) + '... (truncated)' : raw;
          const entryLength = entryKey.length + value.length;
          if (totalLength + entryLength > maxResp) break;
          entries.push({ key: entryKey, value });
          totalLength += entryLength;
        }
        return { mode: 'all' as const, entries, count: keys.length };
      },
      args: [storageType, key ?? null, MAX_VALUE_LENGTH, MAX_RESPONSE_LENGTH],
    });

    const result = results[0]?.result as
      | { mode: 'single'; key: string; value: string | null }
      | { mode: 'all'; entries: Array<{ key: string; value: string }>; count: number }
      | undefined;

    if (!result) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32603, message: 'No result from script execution' }, id });
      return;
    }

    if (result.mode === 'single') {
      sendToServer({ jsonrpc: '2.0', result: { key: result.key, value: result.value }, id });
    } else {
      sendToServer({ jsonrpc: '2.0', result: { entries: result.entries, count: result.count }, id });
    }
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserClickElement = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const selector = params.selector;
    if (typeof selector !== 'string' || selector.length === 0) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid selector parameter' }, id });
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };
        (el as HTMLElement).click();
        return {
          clicked: true,
          tagName: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 200),
        };
      },
      args: [selector],
    });

    const result = results[0]?.result as
      | { error?: string; clicked?: boolean; tagName?: string; text?: string }
      | undefined;
    if (!result) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32603, message: 'No result from script execution' }, id });
      return;
    }
    if (result.error) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: result.error }, id });
      return;
    }
    sendToServer({
      jsonrpc: '2.0',
      result: { clicked: result.clicked, tagName: result.tagName, text: result.text },
      id,
    });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserTypeText = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const selector = params.selector;
    if (typeof selector !== 'string' || selector.length === 0) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid selector parameter' }, id });
      return;
    }
    const text = params.text;
    if (typeof text !== 'string') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid text parameter' }, id });
      return;
    }
    const clear = typeof params.clear === 'boolean' ? params.clear : true;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel: string, txt: string, clr: boolean) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        input.focus();
        if (clr) {
          input.value = '';
        }
        input.value = clr ? txt : input.value + txt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          typed: true,
          tagName: el.tagName.toLowerCase(),
          value: input.value,
        };
      },
      args: [selector, text, clear],
    });

    const result = results[0]?.result as
      | { error?: string; typed?: boolean; tagName?: string; value?: string }
      | undefined;
    if (!result) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32603, message: 'No result from script execution' }, id });
      return;
    }
    if (result.error) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: result.error }, id });
      return;
    }
    sendToServer({ jsonrpc: '2.0', result: { typed: result.typed, tagName: result.tagName, value: result.value }, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserSelectOption = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const selector = params.selector;
    if (typeof selector !== 'string' || selector.length === 0) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid selector parameter' }, id });
      return;
    }
    const value = typeof params.value === 'string' ? params.value : undefined;
    const label = typeof params.label === 'string' ? params.label : undefined;

    if (value === undefined && label === undefined) {
      sendToServer({
        jsonrpc: '2.0',
        error: { code: -32602, message: 'Either value or label must be provided' },
        id,
      });
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel: string, val: string | null, lbl: string | null) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };
        if (el.tagName.toLowerCase() !== 'select') return { error: `Element is not a <select>: ${sel}` };
        const select = el as HTMLSelectElement;
        const options = Array.from(select.options);
        let matchedIndex = -1;
        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          if (!opt) continue;
          const isMatch = val !== null ? opt.value === val : (opt.textContent || '').trim() === lbl;
          if (isMatch) {
            matchedIndex = i;
            break;
          }
        }
        if (matchedIndex === -1) {
          const criterion = val !== null ? `value="${val}"` : `label="${String(lbl)}"`;
          return { error: `Option not found: ${criterion}` };
        }
        select.selectedIndex = matchedIndex;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const selectedOpt = options[matchedIndex];
        return {
          selected: true,
          value: selectedOpt ? selectedOpt.value : '',
          label: selectedOpt ? (selectedOpt.textContent || '').trim() : '',
        };
      },
      args: [selector, value ?? null, label ?? null],
    });

    const result = results[0]?.result as
      | { error?: string; selected?: boolean; value?: string; label?: string }
      | undefined;
    if (!result) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32603, message: 'No result from script execution' }, id });
      return;
    }
    if (result.error) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: result.error }, id });
      return;
    }
    sendToServer({
      jsonrpc: '2.0',
      result: { selected: result.selected, value: result.value, label: result.label },
      id,
    });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserWaitForElement = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const selector = params.selector;
    if (typeof selector !== 'string' || selector.length === 0) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid selector parameter' }, id });
      return;
    }
    const timeout = typeof params.timeout === 'number' ? params.timeout : 10000;
    const visible = typeof params.visible === 'boolean' ? params.visible : false;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel: string, tmo: number, vis: boolean) =>
        new Promise<{ found?: boolean; tagName?: string; text?: string; error?: string }>(resolve => {
          let elapsed = 0;
          const poll = setInterval(() => {
            const el = document.querySelector(sel);
            if (el) {
              const htmlEl = el as HTMLElement;
              const isVisible = !vis || htmlEl.offsetParent !== null || getComputedStyle(htmlEl).display !== 'none';
              if (isVisible) {
                clearInterval(poll);
                resolve({
                  found: true,
                  tagName: el.tagName.toLowerCase(),
                  text: (el.textContent || '').trim().slice(0, 200),
                });
                return;
              }
            }
            elapsed += 100;
            if (elapsed >= tmo) {
              clearInterval(poll);
              resolve({ error: `Timeout waiting for element: ${sel} (${tmo}ms)` });
            }
          }, 100);
        }),
      args: [selector, timeout, visible],
    });

    const result = results[0]?.result as
      | { error?: string; found?: boolean; tagName?: string; text?: string }
      | undefined;
    if (!result) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32603, message: 'No result from script execution' }, id });
      return;
    }
    if (result.error) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: result.error }, id });
      return;
    }
    sendToServer({
      jsonrpc: '2.0',
      result: { found: result.found, tagName: result.tagName, text: result.text },
      id,
    });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserQueryElements = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const selector = params.selector;
    if (typeof selector !== 'string' || selector.length === 0) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid selector parameter' }, id });
      return;
    }
    const limit = typeof params.limit === 'number' ? params.limit : 100;
    const attributes = Array.isArray(params.attributes)
      ? (params.attributes as unknown[]).filter((a): a is string => typeof a === 'string')
      : ['id', 'class', 'href', 'src', 'type', 'name', 'value', 'placeholder'];

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel: string, lim: number, attrs: string[]) => {
        const all = document.querySelectorAll(sel);
        const elements = Array.from(all)
          .slice(0, lim)
          .map(el => ({
            tagName: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().slice(0, 200),
            attributes: Object.fromEntries(attrs.filter(a => el.hasAttribute(a)).map(a => [a, el.getAttribute(a)])),
          }));
        return { count: all.length, elements };
      },
      args: [selector, limit, attributes],
    });

    const result = results[0]?.result as { count?: number; elements?: unknown[] } | undefined;
    if (!result) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32603, message: 'No result from script execution' }, id });
      return;
    }
    sendToServer({ jsonrpc: '2.0', result: { count: result.count, elements: result.elements }, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserGetCookies = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const url = params.url;
    if (typeof url !== 'string') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid url parameter' }, id });
      return;
    }
    if (isBlockedUrlScheme(url)) {
      sendToServer({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'URL scheme not allowed (javascript:, data:, file:, chrome:, blob: are blocked)',
        },
        id,
      });
      return;
    }
    const filter: chrome.cookies.GetAllDetails = { url };
    const name = params.name;
    if (typeof name === 'string') {
      filter.name = name;
    }
    const cookies = await chrome.cookies.getAll(filter);
    sendToServer({
      jsonrpc: '2.0',
      result: {
        cookies: cookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite,
          expirationDate: c.expirationDate,
        })),
      },
      id,
    });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserSetCookie = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const url = params.url;
    if (typeof url !== 'string') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid url parameter' }, id });
      return;
    }
    if (isBlockedUrlScheme(url)) {
      sendToServer({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'URL scheme not allowed (javascript:, data:, file:, chrome:, blob: are blocked)',
        },
        id,
      });
      return;
    }
    const name = params.name;
    if (typeof name !== 'string' || name.length === 0) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid name parameter' }, id });
      return;
    }
    const value = params.value;
    if (typeof value !== 'string') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid value parameter' }, id });
      return;
    }
    const details: chrome.cookies.SetDetails = { url, name, value };
    if (typeof params.domain === 'string') details.domain = params.domain;
    if (typeof params.path === 'string') details.path = params.path;
    if (typeof params.secure === 'boolean') details.secure = params.secure;
    if (typeof params.httpOnly === 'boolean') details.httpOnly = params.httpOnly;
    if (typeof params.expirationDate === 'number') details.expirationDate = params.expirationDate;
    const cookie = await chrome.cookies.set(details);
    if (!cookie) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32603, message: 'Failed to set cookie' }, id });
      return;
    }
    sendToServer({
      jsonrpc: '2.0',
      result: {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate: cookie.expirationDate,
      },
      id,
    });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserDeleteCookies = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const url = params.url;
    if (typeof url !== 'string') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid url parameter' }, id });
      return;
    }
    if (isBlockedUrlScheme(url)) {
      sendToServer({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'URL scheme not allowed (javascript:, data:, file:, chrome:, blob: are blocked)',
        },
        id,
      });
      return;
    }
    const name = params.name;
    if (typeof name !== 'string' || name.length === 0) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid name parameter' }, id });
      return;
    }
    await chrome.cookies.remove({ url, name });
    sendToServer({ jsonrpc: '2.0', result: { deleted: true, name, url }, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserExecuteScript = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const execFile = params.execFile;
    if (typeof execFile !== 'string' || execFile.length === 0) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid execFile parameter' }, id });
      return;
    }
    if (!/^[a-z0-9_-]+\.js$/.test(execFile)) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Invalid execFile format' }, id });
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
      const maxAsyncWait = 10_000;
      const pollInterval = 50;
      let elapsed = 0;

      while (elapsed <= maxAsyncWait) {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
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
                  captured.value = json.length > 50_000 ? json.slice(0, 50_000) + '... (truncated)' : JSON.parse(json);
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
        });

        const first = results[0] as { result?: { pending: boolean; result?: unknown } } | undefined;
        const data = first?.result;

        if (data && !data.pending) {
          return { value: data.result };
        }

        // Still pending — wait and retry
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        elapsed += pollInterval;
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

      return { value: { error: `Async code did not resolve within ${maxAsyncWait}ms` } };
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

    sendToServer({ jsonrpc: '2.0', result, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserEnableNetworkCapture = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const maxRequests = typeof params.maxRequests === 'number' ? params.maxRequests : 100;
    const urlFilter = typeof params.urlFilter === 'string' ? params.urlFilter : undefined;

    await startCapture(tabId, maxRequests, urlFilter);
    sendToServer({ jsonrpc: '2.0', result: { enabled: true, tabId }, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserGetNetworkRequests = (params: Record<string, unknown>, id: string | number): void => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const clear = typeof params.clear === 'boolean' ? params.clear : false;
    const requests = getRequests(tabId, clear);
    sendToServer({ jsonrpc: '2.0', result: { requests }, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserDisableNetworkCapture = (params: Record<string, unknown>, id: string | number): void => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    stopCapture(tabId);
    sendToServer({ jsonrpc: '2.0', result: { disabled: true, tabId }, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserGetConsoleLogs = (params: Record<string, unknown>, id: string | number): void => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const clear = typeof params.clear === 'boolean' ? params.clear : false;
    const level = typeof params.level === 'string' ? params.level : undefined;
    const logs = getConsoleLogs(tabId, clear, level);
    sendToServer({ jsonrpc: '2.0', result: { logs }, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserClearConsoleLogs = (params: Record<string, unknown>, id: string | number): void => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    clearConsoleLogs(tabId);
    sendToServer({ jsonrpc: '2.0', result: { cleared: true }, id });
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserListResources = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const typeFilter = typeof params.type === 'string' ? params.type : undefined;

    const alreadyAttached = isCapturing(tabId);
    if (!alreadyAttached) {
      try {
        await chrome.debugger.attach({ tabId }, '1.3');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendToServer({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: msg.includes('Another debugger')
              ? 'Failed to attach debugger — another debugger (e.g., DevTools) is already attached. ' +
                'Close DevTools or enable network capture first (browser_enable_network_capture) ' +
                'so this tool can reuse the existing debugger session.'
              : `Failed to attach debugger: ${sanitizeErrorMessage(msg)}`,
          },
          id,
        });
        return;
      }
    }

    try {
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
      const treeResult = (await chrome.debugger.sendCommand({ tabId }, 'Page.getResourceTree')) as {
        frameTree: CdpFrameResourceTree;
      };

      const frames: Array<{ url: string; securityOrigin: string }> = [];
      const resources: Array<{ url: string; type: string; mimeType: string; contentLength: number }> = [];

      const walk = (node: CdpFrameResourceTree): void => {
        frames.push({ url: node.frame.url, securityOrigin: node.frame.securityOrigin });
        for (const r of node.resources) {
          if (typeFilter && r.type !== typeFilter) continue;
          resources.push({
            url: r.url,
            type: r.type,
            mimeType: r.mimeType,
            contentLength: r.contentLength ?? -1,
          });
        }
        if (node.childFrames) {
          for (const child of node.childFrames) walk(child);
        }
      };

      walk(treeResult.frameTree);

      resources.sort((a, b) => a.type.localeCompare(b.type) || a.url.localeCompare(b.url));

      sendToServer({ jsonrpc: '2.0', result: { frames, resources }, id });
    } finally {
      if (!alreadyAttached) {
        await chrome.debugger.detach({ tabId }).catch(() => {});
      }
    }
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};

export const handleBrowserGetResourceContent = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = params.tabId;
    if (typeof tabId !== 'number') {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid tabId parameter' }, id });
      return;
    }
    const url = params.url;
    if (typeof url !== 'string' || url.length === 0) {
      sendToServer({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing or invalid url parameter' }, id });
      return;
    }
    const maxLength = typeof params.maxLength === 'number' ? params.maxLength : 500_000;

    const alreadyAttached = isCapturing(tabId);
    if (!alreadyAttached) {
      try {
        await chrome.debugger.attach({ tabId }, '1.3');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendToServer({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: msg.includes('Another debugger')
              ? 'Failed to attach debugger — another debugger (e.g., DevTools) is already attached. ' +
                'Close DevTools or enable network capture first (browser_enable_network_capture) ' +
                'so this tool can reuse the existing debugger session.'
              : `Failed to attach debugger: ${sanitizeErrorMessage(msg)}`,
          },
          id,
        });
        return;
      }
    }

    try {
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');

      // Get the resource tree to find which frame owns the requested resource
      const treeResult = (await chrome.debugger.sendCommand({ tabId }, 'Page.getResourceTree')) as {
        frameTree: CdpFrameResourceTree;
      };

      const match = findFrameForResource(treeResult.frameTree, url);
      if (!match) {
        sendToServer({
          jsonrpc: '2.0',
          error: {
            code: -32602,
            message: `Resource not found in page: ${url}. Use browser_list_resources to find valid resource URLs.`,
          },
          id,
        });
        return;
      }

      const contentResult = (await chrome.debugger.sendCommand({ tabId }, 'Page.getResourceContent', {
        frameId: match.frameId,
        url,
      })) as { content: string; base64Encoded: boolean };

      let content = contentResult.content;
      let base64Encoded = contentResult.base64Encoded;

      // Decode base64 text resources to UTF-8 strings
      if (base64Encoded && isTextMimeType(match.mimeType)) {
        try {
          content = atob(content);
          base64Encoded = false;
        } catch {
          // Decoding failed — return base64 as-is
        }
      }

      // Truncate text content that exceeds maxLength
      let truncated = false;
      if (!base64Encoded && content.length > maxLength) {
        content = content.slice(0, maxLength) + '... (truncated)';
        truncated = true;
      }

      sendToServer({
        jsonrpc: '2.0',
        result: { url, content, base64Encoded, mimeType: match.mimeType, truncated },
        id,
      });
    } finally {
      if (!alreadyAttached) {
        await chrome.debugger.detach({ tabId }).catch(() => {});
      }
    }
  } catch (err) {
    sendToServer({
      jsonrpc: '2.0',
      error: { code: -32603, message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      id,
    });
  }
};
