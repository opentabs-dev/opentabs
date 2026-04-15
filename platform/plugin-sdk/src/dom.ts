// ---------------------------------------------------------------------------
// DOM utilities for plugin authors
// ---------------------------------------------------------------------------

/**
 * Matches CSS pseudo-classes whose state is backed by HTML attribute mutations
 * (e.g., :checked reflects the checked attribute, :disabled reflects disabled).
 * Pseudo-classes driven by user interaction (:hover, :focus, :active) are excluded
 * because they don't correspond to attribute mutations.
 */
const ATTRIBUTE_PSEUDO_RE =
  /:(checked|disabled|enabled|required|optional|read-only|read-write|default|valid|invalid|in-range|out-of-range|placeholder-shown)/;

/**
 * Returns true if the selector may match via attribute changes (class, attribute, or
 * attribute-backed pseudo-class selectors), requiring `attributes: true` in
 * MutationObserver options to detect such changes.
 */
const needsAttributeObservation = (selector: string): boolean =>
  selector.includes('[') || selector.includes('.') || ATTRIBUTE_PSEUDO_RE.test(selector);

export interface WaitForSelectorOptions {
  /** Timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** AbortSignal to cancel the wait early */
  signal?: AbortSignal;
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
export const waitForSelector = <T extends Element = Element>(
  selector: string,
  opts?: WaitForSelectorOptions,
): Promise<T> => {
  const timeout = opts?.timeout ?? 10_000;
  const signal = opts?.signal;

  const abortReason = () => (signal?.reason instanceof Error ? signal.reason : new Error('waitForSelector: aborted'));

  if (signal?.aborted) return Promise.reject(abortReason());

  return new Promise<T>((resolve, reject) => {
    let existing: Element | null;
    try {
      existing = document.querySelector(selector);
    } catch {
      reject(new Error(`waitForSelector: invalid CSS selector "${selector}"`));
      return;
    }

    if (existing) {
      resolve(existing as T);
      return;
    }

    let settled = false;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      observer.disconnect();
      reject(abortReason());
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      observer.disconnect();
      reject(new Error(`waitForSelector: timed out after ${timeout}ms waiting for "${selector}"`));
    }, timeout);

    const observer = new MutationObserver(() => {
      let el: Element | null;
      try {
        el = document.querySelector(selector);
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        observer.disconnect();
        reject(
          err instanceof Error ? err : new Error(`waitForSelector: querySelector threw for selector "${selector}"`),
        );
        return;
      }
      if (el) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        observer.disconnect();
        resolve(el as T);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: needsAttributeObservation(selector),
    });

    // Re-check after observe to close the TOCTOU race window: element may have
    // been added between the initial querySelector and observer.observe().
    try {
      const el = document.querySelector(selector);
      if (el) {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        observer.disconnect();
        resolve(el as T);
      }
    } catch {
      // querySelector errors are handled by the observer callback
    }
  });
};

/**
 * Waits for an element matching `selector` to be removed from the DOM.
 * Resolves immediately if no matching element exists.
 */
export const waitForSelectorRemoval = (selector: string, opts?: WaitForSelectorOptions): Promise<void> => {
  const timeout = opts?.timeout ?? 10_000;
  const signal = opts?.signal;

  const abortReason = () =>
    signal?.reason instanceof Error ? signal.reason : new Error('waitForSelectorRemoval: aborted');

  if (signal?.aborted) return Promise.reject(abortReason());

  return new Promise<void>((resolve, reject) => {
    let hasElement: boolean;
    try {
      hasElement = !!document.querySelector(selector);
    } catch {
      reject(new Error(`waitForSelectorRemoval: invalid CSS selector "${selector}"`));
      return;
    }

    if (!hasElement) {
      resolve();
      return;
    }

    let settled = false;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      observer.disconnect();
      reject(abortReason());
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      observer.disconnect();
      reject(new Error(`waitForSelectorRemoval: timed out after ${timeout}ms waiting for "${selector}" to be removed`));
    }, timeout);

    const observer = new MutationObserver(() => {
      let el: Element | null;
      try {
        el = document.querySelector(selector);
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        observer.disconnect();
        reject(
          err instanceof Error
            ? err
            : new Error(`waitForSelectorRemoval: querySelector threw for selector "${selector}"`),
        );
        return;
      }
      if (!el) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        observer.disconnect();
        resolve();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: needsAttributeObservation(selector),
    });

    // Re-check after observe to close the TOCTOU race window: element may have
    // been removed between the initial querySelector and observer.observe().
    try {
      const el = document.querySelector(selector);
      if (!el) {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        observer.disconnect();
        resolve();
      }
    } catch {
      // querySelector errors are handled by the observer callback
    }
  });
};

/**
 * Typed wrapper around `document.querySelectorAll` that returns a real array.
 * Returns an empty array if the selector is invalid.
 */
export const querySelectorAll = <T extends Element = Element>(selector: string): T[] => {
  try {
    return Array.from(document.querySelectorAll<T>(selector));
  } catch {
    return [];
  }
};

/**
 * Returns the trimmed `textContent` of the first element matching `selector`,
 * or `null` if no element is found or the selector is invalid.
 */
export const getTextContent = (selector: string): string | null => {
  let el: Element | null;
  try {
    el = document.querySelector(selector);
  } catch {
    return null;
  }
  if (!el) return null;
  const text = el.textContent as string | null;
  return text === null ? null : text.trim();
};

/**
 * Returns the `content` attribute of the `<meta>` tag with the given `name`,
 * or `null` if the tag is not found or has no content attribute.
 */
export const getMetaContent = (name: string): string | null => {
  if (!name) return null;
  try {
    const meta = document.querySelector<HTMLMetaElement>(`meta[name="${CSS.escape(name)}"]`);
    return meta?.content ?? null;
  } catch {
    return null;
  }
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
  let target: Element | null;
  try {
    target = document.querySelector(selector);
  } catch {
    throw new Error(`observeDOM: invalid CSS selector "${selector}"`);
  }

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
