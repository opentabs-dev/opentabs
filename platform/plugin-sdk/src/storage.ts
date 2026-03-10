// ---------------------------------------------------------------------------
// Storage utilities for plugin authors
// ---------------------------------------------------------------------------

import { log } from './log.js';

/**
 * Reads a value from localStorage. Returns null if the key is not found or
 * if storage access throws (e.g., SecurityError in sandboxed iframes).
 *
 * When localStorage is undefined (deleted by the host app, e.g., Discord),
 * falls back to reading from a same-origin iframe's localStorage, which
 * retains access to the underlying storage even when the property is deleted
 * from the main window.
 */
export const getLocalStorage = (key: string): string | null => {
  // Access via window.localStorage (property lookup) rather than the bare
  // `localStorage` identifier. Some apps (e.g., Discord) delete the property
  // from the global scope, which makes the bare identifier throw a
  // ReferenceError. Property access on `window` returns undefined instead.
  let storage: Storage | undefined;
  try {
    storage = window.localStorage as Storage | undefined;
  } catch {
    // Throwing getter (e.g., SecurityError in sandboxed iframes) — give up.
    return null;
  }

  if (storage) {
    try {
      return storage.getItem(key);
    } catch {
      // getItem threw (SecurityError, etc.) — storage exists but is
      // inaccessible, give up.
      return null;
    }
  }

  // localStorage is undefined — some apps (e.g., Discord) delete the property.
  // Same-origin iframes retain access to the underlying storage.
  try {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    try {
      const iframeStorage = iframe.contentWindow?.localStorage;
      return iframeStorage ? iframeStorage.getItem(key) : null;
    } finally {
      document.body.removeChild(iframe);
    }
  } catch {
    return null;
  }
};

/**
 * Searches localStorage keys using a predicate and returns the first matching
 * entry. Returns null if no match is found or if localStorage is inaccessible.
 * Uses the same iframe fallback as getLocalStorage for environments where
 * localStorage is deleted (e.g., Discord).
 */
export const findLocalStorageEntry = (predicate: (key: string) => boolean): { key: string; value: string } | null => {
  const search = (storage: Storage): { key: string; value: string } | null => {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && predicate(key)) {
        const value = storage.getItem(key);
        if (value !== null) return { key, value };
      }
    }
    return null;
  };

  let storage: Storage | undefined;
  try {
    storage = window.localStorage as Storage | undefined;
  } catch {
    return null;
  }

  if (storage) {
    try {
      return search(storage);
    } catch {
      return null;
    }
  }

  // localStorage is undefined — fall back to same-origin iframe.
  try {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    try {
      const iframeStorage = iframe.contentWindow?.localStorage;
      return iframeStorage ? search(iframeStorage) : null;
    } finally {
      document.body.removeChild(iframe);
    }
  } catch {
    return null;
  }
};

/**
 * Writes a value to localStorage. Logs a warning if storage access throws
 * (e.g., SecurityError in sandboxed iframes or QuotaExceededError when storage is full).
 */
export const setLocalStorage = (key: string, value: string): void => {
  try {
    const storage = window.localStorage as Storage | undefined;
    storage?.setItem(key, value);
  } catch (error) {
    log.warn(`setLocalStorage failed for key "${key}"`, error);
  }
};

/**
 * Reads a value from sessionStorage. Returns null if the key is not found or
 * if storage access throws (e.g., SecurityError in sandboxed iframes).
 */
export const getSessionStorage = (key: string): string | null => {
  try {
    const storage = window.sessionStorage as Storage | undefined;
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

/**
 * Writes a value to sessionStorage. Logs a warning if storage access throws
 * (e.g., SecurityError in sandboxed iframes or QuotaExceededError when storage is full).
 */
export const setSessionStorage = (key: string, value: string): void => {
  try {
    const storage = window.sessionStorage as Storage | undefined;
    storage?.setItem(key, value);
  } catch (error) {
    log.warn(`setSessionStorage failed for key "${key}"`, error);
  }
};

/**
 * Removes a key from localStorage. Logs a warning if storage access throws
 * (e.g., SecurityError in sandboxed iframes).
 */
export const removeLocalStorage = (key: string): void => {
  try {
    const storage = window.localStorage as Storage | undefined;
    storage?.removeItem(key);
  } catch (error) {
    log.warn(`removeLocalStorage failed for key "${key}"`, error);
  }
};

/**
 * Removes a key from sessionStorage. Logs a warning if storage access throws
 * (e.g., SecurityError in sandboxed iframes).
 */
export const removeSessionStorage = (key: string): void => {
  try {
    const storage = window.sessionStorage as Storage | undefined;
    storage?.removeItem(key);
  } catch (error) {
    log.warn(`removeSessionStorage failed for key "${key}"`, error);
  }
};

/**
 * Reads a cookie by name from `document.cookie`. Handles URI-encoded values.
 * Returns null if the cookie is not found or if cookie access throws
 * (e.g., SecurityError in sandboxed iframes).
 */
export const getCookie = (name: string): string | null => {
  try {
    const prefix = `${name}=`;
    const entries = document.cookie.split('; ');
    for (const entry of entries) {
      if (entry.startsWith(prefix)) {
        try {
          return decodeURIComponent(entry.slice(prefix.length));
        } catch {
          return entry.slice(prefix.length);
        }
      }
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Reads a cached auth value from globalThis.__openTabs.tokenCache[namespace].
 * Returns null if the namespace is not found or if access throws.
 * The generic T allows both primitive strings and complex objects.
 */
export const getAuthCache = <T>(namespace: string): T | null => {
  try {
    const ns = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
    const cache = ns?.tokenCache as Record<string, unknown> | undefined;
    return (cache?.[namespace] as T) ?? null;
  } catch {
    return null;
  }
};

/**
 * Writes a value to globalThis.__openTabs.tokenCache[namespace].
 * Initializes __openTabs and tokenCache objects if absent.
 * Silently handles errors (consistent with existing storage patterns).
 */
export const setAuthCache = <T>(namespace: string, value: T): void => {
  try {
    const g = globalThis as Record<string, unknown>;
    if (!g.__openTabs) g.__openTabs = {};
    const ns = g.__openTabs as Record<string, unknown>;
    if (!ns.tokenCache) ns.tokenCache = {};
    (ns.tokenCache as Record<string, unknown>)[namespace] = value;
  } catch {}
};

/**
 * Clears the cached auth value at globalThis.__openTabs.tokenCache[namespace].
 * Silently handles errors.
 */
export const clearAuthCache = (namespace: string): void => {
  try {
    const ns = (globalThis as Record<string, unknown>).__openTabs as Record<string, unknown> | undefined;
    const cache = ns?.tokenCache as Record<string, unknown> | undefined;
    if (cache) cache[namespace] = undefined;
  } catch {}
};
