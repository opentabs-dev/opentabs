import { GlobalWindow } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { LogEntry } from './log.js';
import { _setLogTransport } from './log.js';
import {
  clearAuthCache,
  findLocalStorageEntry,
  getAuthCache,
  getCookie,
  getLocalStorage,
  getSessionStorage,
  removeLocalStorage,
  removeSessionStorage,
  setAuthCache,
  setLocalStorage,
  setSessionStorage,
} from './storage.js';

let win: GlobalWindow;

// The storage utilities access `window.localStorage` / `window.sessionStorage`
// (property access, not the bare identifier) to avoid ReferenceErrors when the
// host app deletes the property from the global scope. In the Vitest/Node.js
// environment, `window` is not defined by default, so we alias it to globalThis.
beforeEach(() => {
  win = new GlobalWindow({ url: 'https://localhost' });
  (globalThis as Record<string, unknown>).window = globalThis;
  globalThis.document = win.document as unknown as Document;
  Object.defineProperty(globalThis, 'localStorage', {
    value: win.localStorage as unknown as Storage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: win.sessionStorage as unknown as Storage,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  win.close();
});

// ---------------------------------------------------------------------------
// getLocalStorage
// ---------------------------------------------------------------------------

describe('getLocalStorage', () => {
  test('returns the stored value', () => {
    localStorage.setItem('test-key', 'test-value');
    expect(getLocalStorage('test-key')).toBe('test-value');
  });

  test('returns null for missing key', () => {
    expect(getLocalStorage('nonexistent')).toBeNull();
  });

  test('returns null when localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
      configurable: true,
    });
    expect(getLocalStorage('key')).toBeNull();
    Object.defineProperty(globalThis, 'localStorage', {
      value: win.localStorage as unknown as Storage,
      configurable: true,
      writable: true,
    });
  });

  describe('iframe fallback', () => {
    test('returns value from iframe localStorage when localStorage is undefined', () => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const mockIframe = {
        style: {} as CSSStyleDeclaration,
        contentWindow: {
          localStorage: {
            getItem: (k: string) => (k === 'fallback-key' ? 'fallback-value' : null),
          },
        },
      };
      const createElementSpy = vi
        .spyOn(document, 'createElement')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const appendChildSpy = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const removeChildSpy = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      try {
        expect(getLocalStorage('fallback-key')).toBe('fallback-value');
        expect(getLocalStorage('missing-key')).toBeNull();
      } finally {
        createElementSpy.mockRestore();
        appendChildSpy.mockRestore();
        removeChildSpy.mockRestore();
        Object.defineProperty(globalThis, 'localStorage', {
          value: win.localStorage as unknown as Storage,
          configurable: true,
          writable: true,
        });
      }
    });

    test('returns null when iframe contentWindow is null (sandboxed context)', () => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const mockIframe = {
        style: {} as CSSStyleDeclaration,
        contentWindow: null,
      };
      const createElementSpy = vi
        .spyOn(document, 'createElement')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const appendChildSpy = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const removeChildSpy = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      try {
        expect(getLocalStorage('key')).toBeNull();
      } finally {
        createElementSpy.mockRestore();
        appendChildSpy.mockRestore();
        removeChildSpy.mockRestore();
        Object.defineProperty(globalThis, 'localStorage', {
          value: win.localStorage as unknown as Storage,
          configurable: true,
          writable: true,
        });
      }
    });

    test('returns null when iframe creation throws SecurityError', () => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(() => {
        throw new DOMException('Not allowed', 'SecurityError');
      });
      try {
        expect(getLocalStorage('key')).toBeNull();
      } finally {
        createElementSpy.mockRestore();
        Object.defineProperty(globalThis, 'localStorage', {
          value: win.localStorage as unknown as Storage,
          configurable: true,
          writable: true,
        });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// setLocalStorage
// ---------------------------------------------------------------------------

describe('setLocalStorage', () => {
  test('stores a value', () => {
    setLocalStorage('my-key', 'my-value');
    expect(localStorage.getItem('my-key')).toBe('my-value');
  });

  test('silently fails when localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
      configurable: true,
    });
    expect(() => setLocalStorage('key', 'value')).not.toThrow();
    Object.defineProperty(globalThis, 'localStorage', {
      value: win.localStorage as unknown as Storage,
      configurable: true,
      writable: true,
    });
  });

  test('silently fails when localStorage.setItem throws QuotaExceededError', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        setItem: () => {
          throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
        },
      },
      configurable: true,
      writable: true,
    });
    expect(() => setLocalStorage('key', 'value')).not.toThrow();
    Object.defineProperty(globalThis, 'localStorage', {
      value: win.localStorage as unknown as Storage,
      configurable: true,
      writable: true,
    });
  });

  test('emits log.warn when localStorage throws SecurityError', () => {
    const entries: LogEntry[] = [];
    const restore = _setLogTransport(entry => entries.push(entry));
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        get: () => {
          throw new DOMException('Access denied', 'SecurityError');
        },
        configurable: true,
      });
      setLocalStorage('sec-key', 'value');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe('warning');
      expect(entries[0]?.message).toContain('sec-key');
    } finally {
      restore();
      Object.defineProperty(globalThis, 'localStorage', {
        value: win.localStorage as unknown as Storage,
        configurable: true,
        writable: true,
      });
    }
  });

  test('emits log.warn when localStorage.setItem throws QuotaExceededError', () => {
    const entries: LogEntry[] = [];
    const restore = _setLogTransport(entry => entries.push(entry));
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        value: {
          setItem: () => {
            throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
          },
        },
        configurable: true,
        writable: true,
      });
      setLocalStorage('quota-key', 'value');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe('warning');
      expect(entries[0]?.message).toContain('quota-key');
    } finally {
      restore();
      Object.defineProperty(globalThis, 'localStorage', {
        value: win.localStorage as unknown as Storage,
        configurable: true,
        writable: true,
      });
    }
  });

  describe('iframe fallback', () => {
    test('persists value via iframe when localStorage is undefined', () => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const store: Record<string, string> = {};
      const mockIframe = {
        style: {} as CSSStyleDeclaration,
        contentWindow: {
          localStorage: {
            setItem: (k: string, v: string) => {
              store[k] = v;
            },
          },
        },
      };
      const createElementSpy = vi
        .spyOn(document, 'createElement')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const appendChildSpy = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const removeChildSpy = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      try {
        setLocalStorage('fb-key', 'fb-value');
        expect(store['fb-key']).toBe('fb-value');
      } finally {
        createElementSpy.mockRestore();
        appendChildSpy.mockRestore();
        removeChildSpy.mockRestore();
        Object.defineProperty(globalThis, 'localStorage', {
          value: win.localStorage as unknown as Storage,
          configurable: true,
          writable: true,
        });
      }
    });

    test('emits log.warn when iframe fallback is used', () => {
      const entries: LogEntry[] = [];
      const restore = _setLogTransport(entry => entries.push(entry));
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const mockIframe = {
        style: {} as CSSStyleDeclaration,
        contentWindow: {
          localStorage: { setItem: () => {} },
        },
      };
      const createElementSpy = vi
        .spyOn(document, 'createElement')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const appendChildSpy = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const removeChildSpy = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      try {
        setLocalStorage('warn-key', 'value');
        expect(entries).toHaveLength(1);
        expect(entries[0]?.level).toBe('warning');
        expect(entries[0]?.message).toContain('iframe fallback');
        expect(entries[0]?.message).toContain('warn-key');
      } finally {
        restore();
        createElementSpy.mockRestore();
        appendChildSpy.mockRestore();
        removeChildSpy.mockRestore();
        Object.defineProperty(globalThis, 'localStorage', {
          value: win.localStorage as unknown as Storage,
          configurable: true,
          writable: true,
        });
      }
    });

    test('emits log.warn when iframe fallback setItem throws QuotaExceededError', () => {
      const entries: LogEntry[] = [];
      const restore = _setLogTransport(entry => entries.push(entry));
      Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
      const mockIframe = {
        style: {} as CSSStyleDeclaration,
        contentWindow: {
          localStorage: {
            setItem: () => {
              throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
            },
          },
        },
      };
      const createElementSpy = vi
        .spyOn(document, 'createElement')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const appendChildSpy = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const removeChildSpy = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      try {
        setLocalStorage('quota-iframe-key', 'value');
        // Should have two warnings: 'using iframe fallback' + 'iframe fallback failed'
        expect(entries.some(e => e.level === 'warning' && e.message.includes('quota-iframe-key'))).toBe(true);
        expect(entries.some(e => e.level === 'warning' && e.message.includes('iframe fallback failed'))).toBe(true);
      } finally {
        restore();
        createElementSpy.mockRestore();
        appendChildSpy.mockRestore();
        removeChildSpy.mockRestore();
        Object.defineProperty(globalThis, 'localStorage', {
          value: win.localStorage as unknown as Storage,
          configurable: true,
          writable: true,
        });
      }
    });

    test('returns gracefully when iframe creation throws SecurityError', () => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(() => {
        throw new DOMException('Not allowed', 'SecurityError');
      });
      try {
        expect(() => setLocalStorage('key', 'value')).not.toThrow();
      } finally {
        createElementSpy.mockRestore();
        Object.defineProperty(globalThis, 'localStorage', {
          value: win.localStorage as unknown as Storage,
          configurable: true,
          writable: true,
        });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// removeLocalStorage
// ---------------------------------------------------------------------------

describe('removeLocalStorage', () => {
  test('removes an existing key', () => {
    localStorage.setItem('to-remove', 'value');
    removeLocalStorage('to-remove');
    expect(localStorage.getItem('to-remove')).toBeNull();
  });

  test('does nothing for a missing key', () => {
    expect(() => removeLocalStorage('nonexistent')).not.toThrow();
  });

  test('silently fails when localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
      configurable: true,
    });
    expect(() => removeLocalStorage('key')).not.toThrow();
    Object.defineProperty(globalThis, 'localStorage', {
      value: win.localStorage as unknown as Storage,
      configurable: true,
      writable: true,
    });
  });

  test('emits log.warn when localStorage throws SecurityError', () => {
    const entries: LogEntry[] = [];
    const restore = _setLogTransport(entry => entries.push(entry));
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        get: () => {
          throw new DOMException('Access denied', 'SecurityError');
        },
        configurable: true,
      });
      removeLocalStorage('rm-key');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe('warning');
      expect(entries[0]?.message).toContain('rm-key');
    } finally {
      restore();
      Object.defineProperty(globalThis, 'localStorage', {
        value: win.localStorage as unknown as Storage,
        configurable: true,
        writable: true,
      });
    }
  });

  describe('iframe fallback', () => {
    test('removes key via iframe when localStorage is undefined', () => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const store: Record<string, string | undefined> = { 'to-remove': 'value' };
      const mockIframe = {
        style: {} as CSSStyleDeclaration,
        contentWindow: {
          localStorage: {
            removeItem: (k: string) => {
              delete store[k];
            },
          },
        },
      };
      const createElementSpy = vi
        .spyOn(document, 'createElement')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const appendChildSpy = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const removeChildSpy = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      try {
        removeLocalStorage('to-remove');
        expect(store['to-remove']).toBeUndefined();
      } finally {
        createElementSpy.mockRestore();
        appendChildSpy.mockRestore();
        removeChildSpy.mockRestore();
        Object.defineProperty(globalThis, 'localStorage', {
          value: win.localStorage as unknown as Storage,
          configurable: true,
          writable: true,
        });
      }
    });

    test('emits log.warn when iframe fallback is used', () => {
      const entries: LogEntry[] = [];
      const restore = _setLogTransport(entry => entries.push(entry));
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const mockIframe = {
        style: {} as CSSStyleDeclaration,
        contentWindow: {
          localStorage: { removeItem: () => {} },
        },
      };
      const createElementSpy = vi
        .spyOn(document, 'createElement')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const appendChildSpy = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const removeChildSpy = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      try {
        removeLocalStorage('warn-key');
        expect(entries).toHaveLength(1);
        expect(entries[0]?.level).toBe('warning');
        expect(entries[0]?.message).toContain('iframe fallback');
        expect(entries[0]?.message).toContain('warn-key');
      } finally {
        restore();
        createElementSpy.mockRestore();
        appendChildSpy.mockRestore();
        removeChildSpy.mockRestore();
        Object.defineProperty(globalThis, 'localStorage', {
          value: win.localStorage as unknown as Storage,
          configurable: true,
          writable: true,
        });
      }
    });

    test('returns gracefully when iframe creation throws SecurityError', () => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(() => {
        throw new DOMException('Not allowed', 'SecurityError');
      });
      try {
        expect(() => removeLocalStorage('key')).not.toThrow();
      } finally {
        createElementSpy.mockRestore();
        Object.defineProperty(globalThis, 'localStorage', {
          value: win.localStorage as unknown as Storage,
          configurable: true,
          writable: true,
        });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// iframe fallback round-trip
// ---------------------------------------------------------------------------

describe('iframe fallback round-trip', () => {
  test('setLocalStorage via iframe followed by getLocalStorage via iframe returns the written value', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const store: Record<string, string> = {};
    const mockIframe = {
      style: {} as CSSStyleDeclaration,
      contentWindow: {
        localStorage: {
          getItem: (k: string) => store[k] ?? null,
          setItem: (k: string, v: string) => {
            store[k] = v;
          },
        },
      },
    };
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
    const appendChildSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
    const removeChildSpy = vi
      .spyOn(document.body, 'removeChild')
      .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
    try {
      setLocalStorage('round-trip-key', 'round-trip-value');
      expect(getLocalStorage('round-trip-key')).toBe('round-trip-value');
    } finally {
      createElementSpy.mockRestore();
      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
      Object.defineProperty(globalThis, 'localStorage', {
        value: win.localStorage as unknown as Storage,
        configurable: true,
        writable: true,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// getSessionStorage
// ---------------------------------------------------------------------------

describe('getSessionStorage', () => {
  test('returns the stored value', () => {
    sessionStorage.setItem('session-key', 'session-value');
    expect(getSessionStorage('session-key')).toBe('session-value');
  });

  test('returns null for missing key', () => {
    expect(getSessionStorage('nonexistent')).toBeNull();
  });

  test('returns null when sessionStorage throws', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      get: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
      configurable: true,
    });
    expect(getSessionStorage('key')).toBeNull();
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: win.sessionStorage as unknown as Storage,
      configurable: true,
      writable: true,
    });
  });
});

// ---------------------------------------------------------------------------
// setSessionStorage
// ---------------------------------------------------------------------------

describe('setSessionStorage', () => {
  test('stores a value', () => {
    setSessionStorage('session-key', 'session-value');
    expect(sessionStorage.getItem('session-key')).toBe('session-value');
  });

  test('silently fails when sessionStorage throws', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      get: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
      configurable: true,
    });
    expect(() => setSessionStorage('key', 'value')).not.toThrow();
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: win.sessionStorage as unknown as Storage,
      configurable: true,
      writable: true,
    });
  });

  test('silently fails when sessionStorage.setItem throws QuotaExceededError', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: {
        setItem: () => {
          throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
        },
      },
      configurable: true,
      writable: true,
    });
    expect(() => setSessionStorage('key', 'value')).not.toThrow();
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: win.sessionStorage as unknown as Storage,
      configurable: true,
      writable: true,
    });
  });

  test('emits log.warn when sessionStorage throws SecurityError', () => {
    const entries: LogEntry[] = [];
    const restore = _setLogTransport(entry => entries.push(entry));
    try {
      Object.defineProperty(globalThis, 'sessionStorage', {
        get: () => {
          throw new DOMException('Access denied', 'SecurityError');
        },
        configurable: true,
      });
      setSessionStorage('sec-key', 'value');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe('warning');
      expect(entries[0]?.message).toContain('sec-key');
    } finally {
      restore();
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: win.sessionStorage as unknown as Storage,
        configurable: true,
        writable: true,
      });
    }
  });

  test('emits log.warn when sessionStorage.setItem throws QuotaExceededError', () => {
    const entries: LogEntry[] = [];
    const restore = _setLogTransport(entry => entries.push(entry));
    try {
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: {
          setItem: () => {
            throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
          },
        },
        configurable: true,
        writable: true,
      });
      setSessionStorage('quota-key', 'value');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe('warning');
      expect(entries[0]?.message).toContain('quota-key');
    } finally {
      restore();
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: win.sessionStorage as unknown as Storage,
        configurable: true,
        writable: true,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// removeSessionStorage
// ---------------------------------------------------------------------------

describe('removeSessionStorage', () => {
  test('removes an existing key', () => {
    sessionStorage.setItem('to-remove', 'value');
    removeSessionStorage('to-remove');
    expect(sessionStorage.getItem('to-remove')).toBeNull();
  });

  test('does nothing for a missing key', () => {
    expect(() => removeSessionStorage('nonexistent')).not.toThrow();
  });

  test('silently fails when sessionStorage throws', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      get: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
      configurable: true,
    });
    expect(() => removeSessionStorage('key')).not.toThrow();
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: win.sessionStorage as unknown as Storage,
      configurable: true,
      writable: true,
    });
  });

  test('emits log.warn when sessionStorage throws SecurityError', () => {
    const entries: LogEntry[] = [];
    const restore = _setLogTransport(entry => entries.push(entry));
    try {
      Object.defineProperty(globalThis, 'sessionStorage', {
        get: () => {
          throw new DOMException('Access denied', 'SecurityError');
        },
        configurable: true,
      });
      removeSessionStorage('rm-key');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe('warning');
      expect(entries[0]?.message).toContain('rm-key');
    } finally {
      restore();
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: win.sessionStorage as unknown as Storage,
        configurable: true,
        writable: true,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// getCookie
// ---------------------------------------------------------------------------

describe('getCookie', () => {
  test('returns the value of an existing cookie', () => {
    Object.defineProperty(win.document, 'cookie', {
      get: () => 'theme=dark; session=abc123',
      configurable: true,
    });
    expect(getCookie('session')).toBe('abc123');
    expect(getCookie('theme')).toBe('dark');
  });

  test('returns null for a missing cookie', () => {
    Object.defineProperty(win.document, 'cookie', {
      get: () => 'theme=dark',
      configurable: true,
    });
    expect(getCookie('session')).toBeNull();
  });

  test('decodes URI-encoded cookie values', () => {
    Object.defineProperty(win.document, 'cookie', {
      get: () => 'data=hello%20world%26more',
      configurable: true,
    });
    expect(getCookie('data')).toBe('hello world&more');
  });

  test('returns raw value when decodeURIComponent fails', () => {
    Object.defineProperty(win.document, 'cookie', {
      get: () => 'bad=%E0%A4%A',
      configurable: true,
    });
    expect(getCookie('bad')).toBe('%E0%A4%A');
  });

  test('returns null when document.cookie is empty', () => {
    Object.defineProperty(win.document, 'cookie', {
      get: () => '',
      configurable: true,
    });
    expect(getCookie('anything')).toBeNull();
  });

  test('handles cookie names that are prefixes of other cookies', () => {
    Object.defineProperty(win.document, 'cookie', {
      get: () => 'token_v2=old; token=current',
      configurable: true,
    });
    expect(getCookie('token')).toBe('current');
    expect(getCookie('token_v2')).toBe('old');
  });

  test('handles cookies with = in the value', () => {
    Object.defineProperty(win.document, 'cookie', {
      get: () => 'token=abc=def=ghi; other=val',
      configurable: true,
    });
    expect(getCookie('token')).toBe('abc=def=ghi');
  });

  test('handles cookies with empty values', () => {
    Object.defineProperty(win.document, 'cookie', {
      get: () => 'empty=; other=val',
      configurable: true,
    });
    expect(getCookie('empty')).toBe('');
  });

  test('returns null when document.cookie getter throws SecurityError', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(win.document, 'cookie');
    Object.defineProperty(win.document, 'cookie', {
      get: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
      configurable: true,
    });
    expect(getCookie('anything')).toBeNull();
    if (originalDescriptor) {
      Object.defineProperty(win.document, 'cookie', originalDescriptor);
    }
  });
});

// ---------------------------------------------------------------------------
// findLocalStorageEntry
// ---------------------------------------------------------------------------

describe('findLocalStorageEntry', () => {
  test('returns matching entry when predicate returns true', () => {
    localStorage.setItem('auth-token', 'secret123');
    localStorage.setItem('user-name', 'alice');
    const result = findLocalStorageEntry(key => key === 'auth-token');
    expect(result).toEqual({ key: 'auth-token', value: 'secret123' });
  });

  test('returns null when no entry matches', () => {
    localStorage.setItem('unrelated', 'value');
    expect(findLocalStorageEntry(key => key === 'nonexistent')).toBeNull();
  });

  test('returns null when localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
      configurable: true,
    });
    expect(findLocalStorageEntry(() => true)).toBeNull();
    Object.defineProperty(globalThis, 'localStorage', {
      value: win.localStorage as unknown as Storage,
      configurable: true,
      writable: true,
    });
  });

  describe('iframe fallback', () => {
    test('returns value from iframe localStorage when localStorage is undefined', () => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const store: Record<string, string> = { 'fb-token': 'fb-secret' };
      const keys = Object.keys(store);
      const mockIframe = {
        style: {} as CSSStyleDeclaration,
        contentWindow: {
          localStorage: {
            get length() {
              return keys.length;
            },
            key: (i: number) => keys[i] ?? null,
            getItem: (k: string) => store[k] ?? null,
          },
        },
      };
      const createElementSpy = vi
        .spyOn(document, 'createElement')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const appendChildSpy = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      const removeChildSpy = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation(() => mockIframe as unknown as HTMLIFrameElement);
      try {
        expect(findLocalStorageEntry(k => k === 'fb-token')).toEqual({ key: 'fb-token', value: 'fb-secret' });
        expect(findLocalStorageEntry(k => k === 'missing')).toBeNull();
      } finally {
        createElementSpy.mockRestore();
        appendChildSpy.mockRestore();
        removeChildSpy.mockRestore();
        Object.defineProperty(globalThis, 'localStorage', {
          value: win.localStorage as unknown as Storage,
          configurable: true,
          writable: true,
        });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// getAuthCache
// ---------------------------------------------------------------------------

describe('getAuthCache', () => {
  const g = globalThis as Record<string, unknown>;

  afterEach(() => {
    delete g.__openTabs;
  });

  test('returns value from tokenCache for known namespace', () => {
    g.__openTabs = { tokenCache: { myPlugin: { token: 'abc' } } };
    expect(getAuthCache('myPlugin')).toEqual({ token: 'abc' });
  });

  test('returns null when namespace is not in tokenCache', () => {
    g.__openTabs = { tokenCache: { other: 'val' } };
    expect(getAuthCache('myPlugin')).toBeNull();
  });

  test('returns null when tokenCache is not initialized', () => {
    g.__openTabs = {};
    expect(getAuthCache('myPlugin')).toBeNull();
  });

  test('returns null when __openTabs is not set', () => {
    expect(getAuthCache('myPlugin')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setAuthCache
// ---------------------------------------------------------------------------

describe('setAuthCache', () => {
  const g = globalThis as Record<string, unknown>;

  afterEach(() => {
    delete g.__openTabs;
  });

  test('writes value to tokenCache', () => {
    g.__openTabs = { tokenCache: {} };
    setAuthCache('myPlugin', 'token-value');
    expect((g.__openTabs as Record<string, unknown>).tokenCache).toEqual({ myPlugin: 'token-value' });
  });

  test('initializes __openTabs when missing', () => {
    setAuthCache('myPlugin', 42);
    expect(g.__openTabs).toBeDefined();
    const ns = g.__openTabs as Record<string, unknown>;
    expect((ns.tokenCache as Record<string, unknown>).myPlugin).toBe(42);
  });

  test('initializes tokenCache when __openTabs exists but tokenCache is missing', () => {
    g.__openTabs = { otherProp: true };
    setAuthCache('myPlugin', 'val');
    const ns = g.__openTabs as Record<string, unknown>;
    expect((ns.tokenCache as Record<string, unknown>).myPlugin).toBe('val');
  });

  test('overwrites existing value', () => {
    g.__openTabs = { tokenCache: { myPlugin: 'old' } };
    setAuthCache('myPlugin', 'new');
    expect((g.__openTabs as Record<string, unknown>).tokenCache).toEqual({ myPlugin: 'new' });
  });
});

// ---------------------------------------------------------------------------
// clearAuthCache
// ---------------------------------------------------------------------------

describe('clearAuthCache', () => {
  const g = globalThis as Record<string, unknown>;

  afterEach(() => {
    delete g.__openTabs;
  });

  test('getAuthCache returns null after clearAuthCache', () => {
    setAuthCache('myPlugin', 'token');
    expect(getAuthCache('myPlugin')).toBe('token');
    clearAuthCache('myPlugin');
    expect(getAuthCache('myPlugin')).toBeNull();
  });

  test('key still exists in tokenCache with value undefined (not deleted)', () => {
    setAuthCache('myPlugin', 'token');
    clearAuthCache('myPlugin');
    const ns = g.__openTabs as Record<string, unknown>;
    const cache = ns.tokenCache as Record<string, unknown>;
    expect(Object.keys(cache)).toContain('myPlugin');
    expect(cache.myPlugin).toBeUndefined();
  });

  test('no-op when cache namespace never set', () => {
    g.__openTabs = { tokenCache: {} };
    expect(() => clearAuthCache('nonexistent')).not.toThrow();
  });
});
