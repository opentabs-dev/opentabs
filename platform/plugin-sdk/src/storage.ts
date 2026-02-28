// ---------------------------------------------------------------------------
// Storage utilities for plugin authors
// ---------------------------------------------------------------------------

import { log } from './log.js';

/**
 * Reads a value from localStorage. Returns null if the key is not found or
 * if storage access throws (e.g., SecurityError in sandboxed iframes).
 */
export const getLocalStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
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
    localStorage.setItem(key, value);
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
    return sessionStorage.getItem(key);
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
    sessionStorage.setItem(key, value);
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
    localStorage.removeItem(key);
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
    sessionStorage.removeItem(key);
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
