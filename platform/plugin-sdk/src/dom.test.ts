import { getTextContent, observeDOM, querySelectorAll, waitForSelector, waitForSelectorRemoval } from './dom.js';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalWindow } from 'happy-dom';

let win: GlobalWindow;

beforeEach(() => {
  win = new GlobalWindow({ url: 'https://localhost' });
  globalThis.document = win.document as unknown as Document;
  globalThis.MutationObserver = win.MutationObserver as unknown as typeof MutationObserver;
});

afterEach(() => {
  win.close();
});

// ---------------------------------------------------------------------------
// waitForSelector
// ---------------------------------------------------------------------------

describe('waitForSelector', () => {
  test('resolves immediately if element already exists', async () => {
    document.body.innerHTML = '<div id="target">hello</div>';
    const el = await waitForSelector('#target');
    expect(el.id).toBe('target');
  });

  test('resolves when element is added after observer is set up', async () => {
    const promise = waitForSelector('#delayed');
    // Add element after the observer is watching (next microtask)
    queueMicrotask(() => {
      const el = document.createElement('div');
      el.id = 'delayed';
      document.body.appendChild(el);
    });
    const el = await promise;
    expect(el.id).toBe('delayed');
  });

  test('rejects on timeout', () => {
    expect(waitForSelector('#nonexistent', { timeout: 100 })).rejects.toThrow(
      'waitForSelector: timed out after 100ms waiting for "#nonexistent"',
    );
  });
});

// ---------------------------------------------------------------------------
// waitForSelectorRemoval
// ---------------------------------------------------------------------------

describe('waitForSelectorRemoval', () => {
  test('resolves immediately if element does not exist', async () => {
    await waitForSelectorRemoval('#nonexistent');
  });

  test('resolves when element is removed', async () => {
    document.body.innerHTML = '<div id="removable">content</div>';
    const promise = waitForSelectorRemoval('#removable');
    queueMicrotask(() => {
      const el = document.querySelector('#removable');
      if (el?.parentNode) {
        el.parentNode.removeChild(el);
      }
    });
    await promise;
    expect(document.querySelector('#removable')).toBeNull();
  });

  test('rejects on timeout if element is not removed', () => {
    document.body.innerHTML = '<div id="persistent">stays</div>';
    expect(waitForSelectorRemoval('#persistent', { timeout: 100 })).rejects.toThrow(
      'waitForSelectorRemoval: timed out after 100ms waiting for "#persistent" to be removed',
    );
  });
});

// ---------------------------------------------------------------------------
// querySelectorAll
// ---------------------------------------------------------------------------

describe('querySelectorAll', () => {
  test('returns a real array of matching elements', () => {
    document.body.innerHTML = '<span class="item">a</span><span class="item">b</span><span class="item">c</span>';
    const items = querySelectorAll('.item');
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(3);
  });

  test('returns empty array when no elements match', () => {
    document.body.innerHTML = '';
    expect(querySelectorAll('.nothing')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getTextContent
// ---------------------------------------------------------------------------

describe('getTextContent', () => {
  test('returns trimmed text content of matching element', () => {
    document.body.innerHTML = '<p id="msg">  hello world  </p>';
    expect(getTextContent('#msg')).toBe('hello world');
  });

  test('returns null when no element matches', () => {
    document.body.innerHTML = '';
    expect(getTextContent('#missing')).toBeNull();
  });

  test('returns empty string for element with only whitespace', () => {
    document.body.innerHTML = '<p id="empty">   </p>';
    expect(getTextContent('#empty')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// observeDOM
// ---------------------------------------------------------------------------

describe('observeDOM', () => {
  test('calls callback when child is added and returns cleanup function', async () => {
    document.body.innerHTML = '<div id="container"></div>';
    let called = false;
    const disconnect = observeDOM('#container', () => {
      called = true;
    });
    expect(typeof disconnect).toBe('function');

    const child = document.createElement('span');
    const container = document.querySelector('#container');
    if (container) {
      container.appendChild(child);
    }

    // Wait for MutationObserver to fire
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    expect(called).toBe(true);

    disconnect();
  });

  test('throws when selector matches nothing', () => {
    document.body.innerHTML = '';
    expect(() => observeDOM('#nonexistent', () => {})).toThrow(
      'observeDOM: no element found for selector "#nonexistent"',
    );
  });
});
