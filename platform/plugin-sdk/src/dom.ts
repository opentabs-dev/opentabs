// ---------------------------------------------------------------------------
// DOM utilities for plugin authors
// ---------------------------------------------------------------------------

export interface WaitForSelectorOptions {
  /** Timeout in milliseconds (default: 10000) */
  timeout?: number;
}

export interface ObserveDOMOptions {
  /** Watch for added/removed child nodes (default: true) */
  childList?: boolean;
  /** Watch for attribute changes (default: false) */
  attributes?: boolean;
  /** Watch the entire subtree (default: true) */
  subtree?: boolean;
}

/**
 * Waits for an element matching `selector` to appear in the DOM.
 * Uses MutationObserver for efficient detection, falls back to an
 * initial querySelector check for elements already present.
 */
export const waitForSelector = (selector: string, opts?: WaitForSelectorOptions): Promise<Element> => {
  const timeout = opts?.timeout ?? 10_000;

  return new Promise<Element>((resolve, reject) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      reject(new Error(`waitForSelector: timed out after ${timeout}ms waiting for "${selector}"`));
    }, timeout);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
};

/**
 * Waits for an element matching `selector` to be removed from the DOM.
 * Resolves immediately if no matching element exists.
 */
export const waitForSelectorRemoval = (selector: string, opts?: WaitForSelectorOptions): Promise<void> => {
  const timeout = opts?.timeout ?? 10_000;

  return new Promise<void>((resolve, reject) => {
    if (!document.querySelector(selector)) {
      resolve();
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      reject(new Error(`waitForSelectorRemoval: timed out after ${timeout}ms waiting for "${selector}" to be removed`));
    }, timeout);

    const observer = new MutationObserver(() => {
      if (!document.querySelector(selector)) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        resolve();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
};

/**
 * Typed wrapper around `document.querySelectorAll` that returns a real array.
 */
export const querySelectorAll = <T extends Element = Element>(selector: string): T[] =>
  Array.from(document.querySelectorAll<T>(selector));

/**
 * Returns the trimmed `textContent` of the first element matching `selector`,
 * or `null` if no element is found.
 */
export const getTextContent = (selector: string): string | null => {
  const el = document.querySelector(selector);
  if (!el) return null;
  return el.textContent.trim();
};

/**
 * Sets up a MutationObserver on the element matching `selector`.
 * Returns a cleanup function that disconnects the observer.
 */
export const observeDOM = (
  selector: string,
  callback: (mutations: MutationRecord[], observer: MutationObserver) => void,
  options?: ObserveDOMOptions,
): (() => void) => {
  const target = document.querySelector(selector);
  if (!target) {
    throw new Error(`observeDOM: no element found for selector "${selector}"`);
  }

  const observer = new MutationObserver(callback);
  observer.observe(target, {
    childList: options?.childList ?? true,
    attributes: options?.attributes ?? false,
    subtree: options?.subtree ?? true,
  });

  return () => observer.disconnect();
};
