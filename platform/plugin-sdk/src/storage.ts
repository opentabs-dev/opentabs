// ---------------------------------------------------------------------------
// Storage utilities for plugin authors
// ---------------------------------------------------------------------------

import { log } from './log.js';

/**
 * Creates a hidden same-origin iframe, accesses its localStorage, and passes
 * it to the provided callback. Cleans up the iframe in a finally block.
 * Returns null if the iframe or its storage is inaccessible.
 */
const withIframeFallback = <T>(fn: (storage: Storage) => T): T | null => {
  try {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    try {
      const iframeStorage = iframe.contentWindow?.localStorage;
      return iframeStorage ? fn(iframeStorage) : null;
    } finally {
      document.body.removeChild(iframe);
    }
  } catch {
    return null;
  }
};

/**
 * Accesses window.localStorage via property lookup (not the bare identifier).
 * Returns the Storage object, or undefined if the property is missing (e.g.,
 * Discord deletes it). Throws if the getter itself throws (e.g., SecurityError
 * in sandboxed iframes) — callers must catch.
 */
const getWindowLocalStorage = (): Storage | undefined => window.localStorage as Storage | undefined;

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
  let storage: Storage | undefined;
  try {
    storage = getWindowLocalStorage();
  } catch {
    return null;
  }

  if (storage) {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  return withIframeFallback(s => s.getItem(key));
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
    storage = getWindowLocalStorage();
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

  return withIframeFallback(s => search(s));
};

/**
 * Writes a value to localStorage. Logs a warning if storage access throws
 * (e.g., SecurityError in sandboxed iframes or QuotaExceededError when storage is full).
 *
 * When localStorage is undefined (deleted by the host app, e.g., Discord),
 * falls back to writing via a same-origin iframe's localStorage and logs a
 * warning so plugin developers have diagnostic visibility.
 */
export const setLocalStorage = (key: string, value: string): void => {
  let storage: Storage | undefined;
  try {
    storage = getWindowLocalStorage();
  } catch (error) {
    log.warn(`setLocalStorage failed for key "${key}"`, error);
    return;
  }

  if (storage) {
    try {
      storage.setItem(key, value);
    } catch (error) {
      log.warn(`setLocalStorage failed for key "${key}"`, error);
    }
    return;
  }

  log.warn(`setLocalStorage: localStorage unavailable, using iframe fallback for key "${key}"`);
  withIframeFallback(s => {
    try {
      s.setItem(key, value);
    } catch (error) {
      log.warn(`setLocalStorage: iframe fallback failed for key "${key}"`, error);
    }
    return true;
  });
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
 *
 * When localStorage is undefined (deleted by the host app, e.g., Discord),
 * falls back to removing via a same-origin iframe's localStorage and logs a
 * warning so plugin developers have diagnostic visibility.
 */
export const removeLocalStorage = (key: string): void => {
  let storage: Storage | undefined;
  try {
    storage = getWindowLocalStorage();
  } catch (error) {
    log.warn(`removeLocalStorage failed for key "${key}"`, error);
    return;
  }

  if (storage) {
    try {
      storage.removeItem(key);
    } catch (error) {
      log.warn(`removeLocalStorage failed for key "${key}"`, error);
    }
    return;
  }

  log.warn(`removeLocalStorage: localStorage unavailable, using iframe fallback for key "${key}"`);
  withIframeFallback(s => {
    s.removeItem(key);
    return true;
  });
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
