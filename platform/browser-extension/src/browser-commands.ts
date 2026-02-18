import { SCRIPT_TIMEOUT_MS } from './constants.js';
import { sendToServer } from './messaging.js';
import { isBlockedUrlScheme } from '@opentabs-dev/shared';

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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      func: (sel: string, val: string | undefined, lbl: string | undefined) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };
        if (el.tagName.toLowerCase() !== 'select') return { error: `Element is not a <select>: ${sel}` };
        const select = el as HTMLSelectElement;
        const options = Array.from(select.options);
        let matchedIndex = -1;
        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          if (!opt) continue;
          const isMatch = val !== undefined ? opt.value === val : (opt.textContent || '').trim() === lbl;
          if (isMatch) {
            matchedIndex = i;
            break;
          }
        }
        if (matchedIndex === -1) {
          const criterion = val !== undefined ? `value="${val}"` : `label="${String(lbl)}"`;
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
      args: [selector, value, label],
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
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
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      id,
    });
  }
};
