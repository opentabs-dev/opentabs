import {
  extractScriptResult,
  requireSelector,
  requireStringParam,
  requireTabId,
  sendErrorResult,
  sendSuccessResult,
} from './helpers.js';
import { withDebugger } from './resource-commands.js';
import {
  DEFAULT_QUERY_LIMIT,
  DEFAULT_WAIT_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  TEXT_PREVIEW_MAX_LENGTH,
} from '../constants.js';
import { JSONRPC_INTERNAL_ERROR, JSONRPC_INVALID_PARAMS } from '../json-rpc-errors.js';
import { sendToServer } from '../messaging.js';
import { sanitizeErrorMessage } from '../sanitize-error.js';
import { toErrorMessage } from '@opentabs-dev/shared';

/**
 * Clicks a DOM element matched by a CSS selector in a tab's page context.
 * @param params - Expects `{ tabId: number, selector: string }`.
 * @returns `{ clicked, tagName, text }` describing the clicked element.
 */
export const handleBrowserClickElement = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const selector = requireSelector(params, id);
    if (selector === null) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel: string, maxPreview: number) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };
        (el as HTMLElement).click();
        return {
          clicked: true,
          tagName: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, maxPreview),
        };
      },
      args: [selector, TEXT_PREVIEW_MAX_LENGTH],
    });

    const result = extractScriptResult(results, id);
    if (!result) return;
    sendSuccessResult(id, { clicked: result.clicked, tagName: result.tagName, text: result.text });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Types text into an input, textarea, or contentEditable element, dispatching input and change events.
 * @param params - Expects `{ tabId: number, selector: string, text: string, clear?: boolean }`. Defaults to clearing existing value before typing.
 * @returns `{ typed, tagName, value }` with the element's resulting value.
 */
export const handleBrowserTypeText = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const selector = requireSelector(params, id);
    if (selector === null) return;
    const text = requireStringParam(params, 'text', id);
    if (text === null) return;
    const clear = typeof params.clear === 'boolean' ? params.clear : true;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel: string, txt: string, clr: boolean) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };
        const tag = el.tagName.toLowerCase();
        const isEditable = tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
        if (!isEditable) return { error: `Element is not a text input (found <${tag}>)` };
        if (tag === 'input' || tag === 'textarea') {
          const input = el as HTMLInputElement | HTMLTextAreaElement;
          input.focus();
          input.value = clr ? txt : input.value + txt;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return { typed: true, tagName: tag, value: input.value };
        }
        // contentEditable element — insert via Selection/Range API
        const htmlEl = el as HTMLElement;
        htmlEl.focus();
        if (clr) htmlEl.textContent = '';
        const selection = window.getSelection();
        if (selection) {
          if (selection.rangeCount === 0) {
            const range = document.createRange();
            range.selectNodeContents(htmlEl);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          }
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(txt));
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        htmlEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: txt }));
        return { typed: true, tagName: tag, value: htmlEl.textContent || '' };
      },
      args: [selector, text, clear],
    });

    const result = extractScriptResult(results, id);
    if (!result) return;
    sendSuccessResult(id, { typed: result.typed, tagName: result.tagName, value: result.value });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserSelectOption = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const selector = requireSelector(params, id);
    if (selector === null) return;
    const value = typeof params.value === 'string' ? params.value : undefined;
    const label = typeof params.label === 'string' ? params.label : undefined;

    if (value === undefined && label === undefined) {
      sendToServer({
        jsonrpc: '2.0',
        error: { code: JSONRPC_INVALID_PARAMS, message: 'At least one of value or label must be provided' },
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

    const result = extractScriptResult(results, id);
    if (!result) return;
    sendSuccessResult(id, { selected: result.selected, value: result.value, label: result.label });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserWaitForElement = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const selector = requireSelector(params, id);
    if (selector === null) return;
    const timeout = typeof params.timeout === 'number' ? params.timeout : DEFAULT_WAIT_TIMEOUT_MS;
    const visible = typeof params.visible === 'boolean' ? params.visible : false;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel: string, tmo: number, vis: boolean, maxPreview: number, pollMs: number) =>
        new Promise<{ found?: boolean; tagName?: string; text?: string; error?: string }>(resolve => {
          let elapsed = 0;
          const poll = setInterval(() => {
            const el = document.querySelector(sel);
            if (el) {
              const htmlEl = el as HTMLElement;
              const isVisible = !vis || (htmlEl.offsetParent !== null && getComputedStyle(htmlEl).display !== 'none');
              if (isVisible) {
                clearInterval(poll);
                resolve({
                  found: true,
                  tagName: el.tagName.toLowerCase(),
                  text: (el.textContent || '').trim().slice(0, maxPreview),
                });
                return;
              }
            }
            elapsed += pollMs;
            if (elapsed >= tmo) {
              clearInterval(poll);
              resolve({ error: `Timeout waiting for element: ${sel} (${tmo}ms)` });
            }
          }, pollMs);
        }),
      args: [selector, timeout, visible, TEXT_PREVIEW_MAX_LENGTH, POLL_INTERVAL_MS],
    });

    const result = extractScriptResult(results, id);
    if (!result) return;
    sendSuccessResult(id, { found: result.found, tagName: result.tagName, text: result.text });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Queries DOM elements matching a CSS selector and returns their tag names, text content, and specified attributes.
 * @param params - Expects `{ tabId: number, selector: string, limit?: number, attributes?: string[] }`. Defaults to 100 element limit and standard attribute set.
 * @returns `{ count, elements }` where count is the total matches and elements is the (possibly limited) result array.
 */
export const handleBrowserQueryElements = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const selector = requireSelector(params, id);
    if (selector === null) return;
    const limit = typeof params.limit === 'number' ? params.limit : DEFAULT_QUERY_LIMIT;
    const attributes = Array.isArray(params.attributes)
      ? (params.attributes as unknown[]).filter((a): a is string => typeof a === 'string')
      : ['id', 'class', 'href', 'src', 'type', 'name', 'value', 'placeholder'];

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel: string, lim: number, attrs: string[], maxPreview: number) => {
        const all = document.querySelectorAll(sel);
        const elements = Array.from(all)
          .slice(0, lim)
          .map(el => ({
            tagName: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().slice(0, maxPreview),
            attributes: Object.fromEntries(attrs.filter(a => el.hasAttribute(a)).map(a => [a, el.getAttribute(a)])),
          }));
        return { count: all.length, elements };
      },
      args: [selector, limit, attributes, TEXT_PREVIEW_MAX_LENGTH],
    });

    const result = extractScriptResult(results, id, 'No result from query');
    if (!result) return;
    sendSuccessResult(id, { count: result.count, elements: result.elements });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserHoverElement = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const selector = requireSelector(params, id);
    if (selector === null) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel: string, maxPreview: number) => {
        const el = document.querySelector(sel);
        if (!el) return { error: `Element not found: ${sel}` };

        const rect = (el as HTMLElement).getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;

        const pointerOpts = {
          clientX,
          clientY,
          pointerId: 1,
          pointerType: 'mouse' as const,
        };

        const mouseOpts = { clientX, clientY };

        // Full hover event sequence matching real browser behavior
        el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, ...pointerOpts }));
        el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, ...pointerOpts }));
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, ...mouseOpts }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, ...mouseOpts }));
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, ...pointerOpts }));
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...mouseOpts }));

        return {
          hovered: true,
          tagName: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, maxPreview),
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      },
      args: [selector, TEXT_PREVIEW_MAX_LENGTH],
    });

    const result = extractScriptResult(results, id);
    if (!result) return;
    sendSuccessResult(id, {
      hovered: result.hovered,
      tagName: result.tagName,
      text: result.text,
      bounds: result.bounds,
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

export const handleBrowserHandleDialog = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const action = requireStringParam(params, 'action', id);
    if (action === null) return;
    if (action !== 'accept' && action !== 'dismiss') {
      sendToServer({
        jsonrpc: '2.0',
        error: { code: JSONRPC_INVALID_PARAMS, message: "action must be 'accept' or 'dismiss'" },
        id,
      });
      return;
    }
    const accept = action === 'accept';
    const promptText = typeof params.promptText === 'string' ? params.promptText : undefined;

    await withDebugger(tabId, async () => {
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
      try {
        await chrome.debugger.sendCommand({ tabId }, 'Page.handleJavaScriptDialog', {
          accept,
          ...(promptText !== undefined ? { promptText } : {}),
        });
        sendSuccessResult(id, { handled: true, action });
      } catch (err) {
        const msg = toErrorMessage(err);
        const isNoDialog = msg.includes('No dialog is showing') || msg.includes('no dialog');
        sendToServer({
          jsonrpc: '2.0',
          error: {
            code: JSONRPC_INTERNAL_ERROR,
            message: isNoDialog ? 'No JavaScript dialog is currently open on this tab' : sanitizeErrorMessage(msg),
          },
          id,
        });
      }
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};
