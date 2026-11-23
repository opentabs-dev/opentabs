import {
  extractScriptResult,
  requireStringParam,
  requireTabId,
  sendErrorResult,
  sendSuccessResult,
} from './helpers.js';
import { withDebugger } from './resource-commands.js';

// Exported for testing — maps shifted punctuation characters to their physical key codes.
export const SHIFTED_PUNCTUATION_CODES: Record<string, string> = {
  '!': 'Digit1',
  '@': 'Digit2',
  '#': 'Digit3',
  $: 'Digit4',
  '%': 'Digit5',
  '^': 'Digit6',
  '&': 'Digit7',
  '*': 'Digit8',
  '(': 'Digit9',
  ')': 'Digit0',
  _: 'Minus',
  '+': 'Equal',
  '{': 'BracketLeft',
  '}': 'BracketRight',
  '|': 'Backslash',
  ':': 'Semicolon',
  '"': 'Quote',
  '<': 'Comma',
  '>': 'Period',
  '?': 'Slash',
  '~': 'Backquote',
};

// Exported for testing — maps unshifted punctuation characters to their physical key codes.
export const UNSHIFTED_PUNCTUATION_CODES: Record<string, string> = {
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '`': 'Backquote',
};

// Maps named keys to their Windows virtual key codes for CDP Input.dispatchKeyEvent.
const NAMED_KEY_CODES: Record<string, number> = {
  Enter: 13,
  Escape: 27,
  Tab: 9,
  Backspace: 8,
  Delete: 46,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  ' ': 32,
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  F10: 121,
  F11: 122,
  F12: 123,
  Insert: 45,
};

/** Derives the physical key code (KeyboardEvent.code) from a key value. */
const deriveCode = (key: string): string => {
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') return `Key${upper}`;
    if (key >= '0' && key <= '9') return `Digit${key}`;
    if (key === ' ') return 'Space';
    return SHIFTED_PUNCTUATION_CODES[key] ?? UNSHIFTED_PUNCTUATION_CODES[key] ?? key;
  }
  return key;
};

/** Returns the Windows virtual key code for CDP dispatch. */
const getVirtualKeyCode = (key: string): number => {
  if (NAMED_KEY_CODES[key] !== undefined) return NAMED_KEY_CODES[key];
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  return 0;
};

/** Builds the CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
const buildModifiers = (shift: boolean, ctrl: boolean, alt: boolean, meta: boolean): number =>
  (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);

/** A printable key press is a single character without Ctrl or Meta held. */
const isPrintableKeyPress = (key: string, ctrl: boolean, meta: boolean): boolean => key.length === 1 && !ctrl && !meta;

/**
 * Presses a keyboard key via CDP Input.dispatchKeyEvent for trusted (isTrusted: true) events.
 * Optionally focuses an element by selector via scripting before dispatching.
 * @param params - Expects `{ tabId, key, selector?, modifiers? }`.
 * @returns `{ pressed, key, target: { tagName, id? } }`.
 */
export const handleBrowserPressKey = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const key = requireStringParam(params, 'key', id);
    if (key === null) return;
    const selector = typeof params.selector === 'string' && params.selector.length > 0 ? params.selector : null;
    const modifiers =
      typeof params.modifiers === 'object' && params.modifiers !== null
        ? (params.modifiers as Record<string, unknown>)
        : {};
    const shiftKey = modifiers.shift === true;
    const ctrlKey = modifiers.ctrl === true;
    const altKey = modifiers.alt === true;
    const metaKey = modifiers.meta === true;

    // If a selector is provided, focus the element and capture its info
    let focusTarget: { tagName: string; id?: string } | undefined;
    if (selector) {
      const focusResults = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return { error: `Element not found: ${sel}` };
          (el as HTMLElement).focus();
          return {
            tagName: el.tagName.toLowerCase(),
            id: (el as HTMLElement).id || undefined,
          };
        },
        args: [selector],
      });
      const focusResult = extractScriptResult(focusResults, id);
      if (!focusResult) return;
      focusTarget = { tagName: focusResult.tagName as string, id: focusResult.id as string | undefined };
    }

    // Compute CDP key event parameters
    const code = deriveCode(key);
    const windowsVirtualKeyCode = getVirtualKeyCode(key);
    const cdpModifiers = buildModifiers(shiftKey, ctrlKey, altKey, metaKey);
    const printable = isPrintableKeyPress(key, ctrlKey, metaKey);
    const text = printable ? key : key === 'Enter' ? '\r' : key === 'Tab' ? '\t' : '';

    // Dispatch trusted key events via CDP. A keyDown that carries text already inserts the character
    // (Chrome fires keydown, keypress and input for it), so no separate 'char' event follows: sending
    // one would type the character a second time.
    await withDebugger(tabId, async () => {
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: printable ? 'keyDown' : 'rawKeyDown',
        modifiers: cdpModifiers,
        windowsVirtualKeyCode,
        code,
        key,
        text: printable ? text : '',
      });
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        modifiers: cdpModifiers,
        windowsVirtualKeyCode,
        code,
        key,
      });
    });

    // If no selector was provided, query the active element for the response
    if (!focusTarget) {
      const activeResults = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          const el = document.activeElement ?? document.body;
          return {
            tagName: el.tagName.toLowerCase(),
            id: (el as HTMLElement).id || undefined,
          };
        },
        args: [],
      });
      const activeResult = extractScriptResult(activeResults, id);
      if (!activeResult) return;
      focusTarget = { tagName: activeResult.tagName as string, id: activeResult.id as string | undefined };
    }

    sendSuccessResult(id, { pressed: true, key, target: focusTarget });
  } catch (err) {
    sendErrorResult(id, err);
  }
};
