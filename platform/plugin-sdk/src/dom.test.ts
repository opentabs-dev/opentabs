import { GlobalWindow } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getTextContent, observeDOM, querySelectorAll, waitForSelector, waitForSelectorRemoval } from './dom.js';

let win: GlobalWindow;

beforeEach(() => {
  win = new GlobalWindow({ url: 'https://localhost' });
  globalThis.document = win.document as unknown as Document;
  globalThis.MutationObserver = win.MutationObserver as unknown as typeof MutationObserver;
});

afterEach(() => {
  vi.restoreAllMocks();
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

  test('resolves when class is added to an existing element via attribute change', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const promise = waitForSelector('.my-class');
    queueMicrotask(() => {
      div.classList.add('my-class');
    });
    const el = await promise;
    expect(el.classList.contains('my-class')).toBe(true);
  });

  test('rejects on timeout', async () => {
    await expect(waitForSelector('#nonexistent', { timeout: 100 })).rejects.toThrow(
      'waitForSelector: timed out after 100ms waiting for "#nonexistent"',
    );
  });

  test('rejects immediately with descriptive error for invalid CSS selector', async () => {
    await expect(waitForSelector('[invalid')).rejects.toThrow('waitForSelector: invalid CSS selector "[invalid"');
  });

  test('rejects and cleans up timer and observer when querySelector throws in observer callback', async () => {
    let callCount = 0;
    vi.spyOn(document, 'querySelector').mockImplementation(() => {
      callCount++;
      if (callCount === 1) return null; // initial check: element not found, set up observer
      throw new Error('simulated querySelector failure in callback');
    });

    const promise = waitForSelector('#target', { timeout: 5000 });

    // Trigger a mutation so the observer callback fires
    queueMicrotask(() => {
      const div = document.createElement('div');
      document.body.appendChild(div);
    });

    await expect(promise).rejects.toThrow('simulated querySelector failure in callback');
  });

  test('rejects immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('pre-aborted'));
    await expect(waitForSelector('#target', { signal: controller.signal })).rejects.toThrow('pre-aborted');
  });

  test('throws DOMException when signal is aborted without custom reason', async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await waitForSelector('#target', { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe('AbortError');
    }
  });

  test('rejects promptly when signal is aborted mid-wait', async () => {
    const controller = new AbortController();
    const promise = waitForSelector('#nonexistent', { timeout: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(new Error('mid-wait abort')), 20);
    await expect(promise).rejects.toThrow('mid-wait abort');
  });

  test('resolves when element is added between initial check and observer setup (TOCTOU race)', async () => {
    const fakeEl = document.createElement('div');
    fakeEl.id = 'race-target';
    let callCount = 0;
    vi.spyOn(document, 'querySelector').mockImplementation(() => {
      callCount++;
      if (callCount === 1) return null; // initial check: element not yet present
      return fakeEl; // re-check after observe: element appeared in the race window
    });

    const el = await waitForSelector('#race-target', { timeout: 5000 });
    expect(el).toBe(fakeEl);
  });

  test('resolves when attribute is set on existing element making it match :disabled pseudo-class', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const promise = waitForSelector('input:disabled', { timeout: 5000 });
    queueMicrotask(() => {
      input.setAttribute('disabled', '');
    });
    const el = await promise;
    expect(el).toBe(input);
  });

  test('resolves when attribute is set on existing element making it match :checked pseudo-class', async () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    document.body.appendChild(input);
    const promise = waitForSelector('input:checked', { timeout: 5000 });
    queueMicrotask(() => {
      input.setAttribute('checked', '');
    });
    const el = await promise;
    expect(el).toBe(input);
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

  test('rejects on timeout if element is not removed', async () => {
    document.body.innerHTML = '<div id="persistent">stays</div>';
    await expect(waitForSelectorRemoval('#persistent', { timeout: 100 })).rejects.toThrow(
      'waitForSelectorRemoval: timed out after 100ms waiting for "#persistent" to be removed',
    );
  });

  test('rejects immediately with descriptive error for invalid CSS selector', async () => {
    await expect(waitForSelectorRemoval('[invalid')).rejects.toThrow(
      'waitForSelectorRemoval: invalid CSS selector "[invalid"',
    );
  });

  test('rejects and cleans up timer and observer when querySelector throws in observer callback', async () => {
    document.body.innerHTML = '<div id="target">content</div>';

    let callCount = 0;
    vi.spyOn(document, 'querySelector').mockImplementation(() => {
      callCount++;
      if (callCount === 1) return document.getElementById('target'); // initial check: element found
      throw new Error('simulated querySelector failure in removal callback');
    });

    const promise = waitForSelectorRemoval('#target', { timeout: 5000 });

    // Trigger a mutation so the observer callback fires
    queueMicrotask(() => {
      const div = document.createElement('span');
      document.body.appendChild(div);
    });

    await expect(promise).rejects.toThrow('simulated querySelector failure in removal callback');
  });

  test('rejects immediately when signal is already aborted', async () => {
    document.body.innerHTML = '<div id="persistent">stays</div>';
    const controller = new AbortController();
    controller.abort(new Error('pre-aborted removal'));
    await expect(waitForSelectorRemoval('#persistent', { signal: controller.signal })).rejects.toThrow(
      'pre-aborted removal',
    );
  });

  test('throws DOMException when signal is aborted without custom reason', async () => {
    document.body.innerHTML = '<div id="persistent">stays</div>';
    const controller = new AbortController();
    controller.abort();
    try {
      await waitForSelectorRemoval('#persistent', { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe('AbortError');
    }
  });

  test('rejects promptly when signal is aborted mid-wait', async () => {
    document.body.innerHTML = '<div id="persistent">stays</div>';
    const controller = new AbortController();
    const promise = waitForSelectorRemoval('#persistent', { timeout: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(new Error('mid-wait removal abort')), 20);
    await expect(promise).rejects.toThrow('mid-wait removal abort');
  });

  test('resolves when element is removed between initial check and observer setup (TOCTOU race)', async () => {
    const fakeEl = document.createElement('div');
    fakeEl.id = 'race-removal-target';
    let callCount = 0;
    vi.spyOn(document, 'querySelector').mockImplementation(() => {
      callCount++;
      if (callCount === 1) return fakeEl; // initial check: element still present
      return null; // re-check after observe: element was removed in the race window
    });

    await waitForSelectorRemoval('#race-removal-target', { timeout: 5000 });
  });

  test('resolves when attribute is removed from existing element making it no longer match :disabled', async () => {
    const button = document.createElement('button');
    button.setAttribute('disabled', '');
    document.body.appendChild(button);
    const promise = waitForSelectorRemoval('button:disabled', { timeout: 5000 });
    queueMicrotask(() => {
      button.removeAttribute('disabled');
    });
    await promise;
    expect(document.querySelector('button:disabled')).toBeNull();
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

  test('returns empty array for invalid CSS selector', () => {
    expect(querySelectorAll('[invalid')).toEqual([]);
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

  test('returns null for invalid CSS selector', () => {
    expect(getTextContent('[invalid')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// needsAttributeObservation (tested indirectly via MutationObserver options)
// ---------------------------------------------------------------------------

describe('needsAttributeObservation', () => {
  /** Helper: starts waitForSelector and returns the `attributes` option passed to observer.observe */
  const getAttributesOption = async (selector: string): Promise<boolean> => {
    let capturedAttributes = false;
    const OriginalObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = class extends OriginalObserver {
      override observe(target: Node, options?: MutationObserverInit) {
        capturedAttributes = options?.attributes ?? false;
        super.observe(target, options);
      }
    } as typeof MutationObserver;
    try {
      // Start waitForSelector — it will set up the observer immediately since there's no matching element
      const promise = waitForSelector(selector, { timeout: 100 });
      await promise.catch(() => {}); // let it time out
    } finally {
      globalThis.MutationObserver = OriginalObserver;
    }
    return capturedAttributes;
  };

  test('returns true for selectors containing attribute-backed pseudo-classes', async () => {
    for (const pseudo of [
      ':checked',
      ':disabled',
      ':enabled',
      ':required',
      ':optional',
      ':read-only',
      ':read-write',
      ':default',
    ]) {
      expect(await getAttributesOption(`input${pseudo}`)).toBe(true);
    }
  });

  test('returns false for plain tag selectors like div, span, input#myId', async () => {
    for (const selector of ['div', 'span', 'input#myId', '#some-id', 'div > span']) {
      expect(await getAttributesOption(selector)).toBe(false);
    }
  });

  test('returns true for class selectors (existing behavior)', async () => {
    expect(await getAttributesOption('.my-class')).toBe(true);
  });

  test('returns true for attribute selectors (existing behavior)', async () => {
    expect(await getAttributesOption('input[type="text"]')).toBe(true);
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

  test('throws descriptive error for invalid CSS selector', () => {
    expect(() => observeDOM('[invalid', () => {})).toThrow('observeDOM: invalid CSS selector "[invalid"');
  });

  test('respects custom options — fires on attribute changes but not child additions', async () => {
    document.body.innerHTML = '<div id="attr-container"></div>';
    let callCount = 0;
    const disconnect = observeDOM(
      '#attr-container',
      () => {
        callCount++;
      },
      { attributes: true, childList: false },
    );

    const container = document.querySelector('#attr-container');

    // Change an attribute — should trigger callback (attributes: true)
    if (container) {
      container.setAttribute('data-test', 'value');
    }
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    expect(callCount).toBe(1);

    // Add a child — should NOT trigger callback (childList: false)
    if (container) {
      container.appendChild(document.createElement('span'));
    }
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    expect(callCount).toBe(1);

    disconnect();
  });

  test('does not call callback after cleanup function is invoked', async () => {
    document.body.innerHTML = '<div id="cleanup-container"></div>';
    let callCount = 0;
    const disconnect = observeDOM('#cleanup-container', () => {
      callCount++;
    });

    const container = document.querySelector('#cleanup-container');

    // First mutation — observer is active, callback should fire
    if (container) {
      container.appendChild(document.createElement('span'));
    }
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    expect(callCount).toBe(1);

    // Disconnect the observer
    disconnect();

    // Second mutation — observer is disconnected, callback should NOT fire
    if (container) {
      container.appendChild(document.createElement('span'));
    }
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    expect(callCount).toBe(1);
  });
});
