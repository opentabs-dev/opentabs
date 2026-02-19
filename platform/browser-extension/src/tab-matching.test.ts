import { findAllMatchingTabs, findMatchingTab, matchPattern, urlMatchesPatterns } from './tab-matching.js';
import { beforeEach, describe, expect, test } from 'bun:test';
import type { PluginMeta } from './types.js';

describe('matchPattern', () => {
  describe('scheme matching', () => {
    test('wildcard scheme matches http', () => {
      expect(matchPattern('http://example.com/path', '*://example.com/*')).toBe(true);
    });

    test('wildcard scheme matches https', () => {
      expect(matchPattern('https://example.com/path', '*://example.com/*')).toBe(true);
    });

    test('wildcard scheme rejects ftp', () => {
      expect(matchPattern('ftp://example.com/path', '*://example.com/*')).toBe(false);
    });

    test('explicit http scheme matches http', () => {
      expect(matchPattern('http://example.com/path', 'http://example.com/*')).toBe(true);
    });

    test('explicit http scheme rejects https', () => {
      expect(matchPattern('https://example.com/path', 'http://example.com/*')).toBe(false);
    });

    test('explicit https scheme matches https', () => {
      expect(matchPattern('https://example.com/path', 'https://example.com/*')).toBe(true);
    });
  });

  describe('host matching', () => {
    test('exact host match', () => {
      expect(matchPattern('https://example.com/path', '*://example.com/*')).toBe(true);
    });

    test('exact host mismatch', () => {
      expect(matchPattern('https://other.com/path', '*://example.com/*')).toBe(false);
    });

    test('wildcard host matches any domain', () => {
      expect(matchPattern('https://anything.example.com/path', '*://*/*')).toBe(true);
    });

    test('subdomain wildcard matches subdomain', () => {
      expect(matchPattern('https://app.slack.com/path', '*://*.slack.com/*')).toBe(true);
    });

    test('subdomain wildcard matches bare domain', () => {
      expect(matchPattern('https://slack.com/path', '*://*.slack.com/*')).toBe(true);
    });

    test('subdomain wildcard matches deep subdomain', () => {
      expect(matchPattern('https://a.b.slack.com/path', '*://*.slack.com/*')).toBe(true);
    });

    test('subdomain wildcard rejects unrelated domain', () => {
      expect(matchPattern('https://notslack.com/path', '*://*.slack.com/*')).toBe(false);
    });

    test('localhost matches', () => {
      expect(matchPattern('http://localhost/path', '*://localhost/*')).toBe(true);
    });
  });

  describe('port matching', () => {
    test('pattern with port matches same port', () => {
      expect(matchPattern('http://localhost:9516/path', '*://localhost:9516/*')).toBe(true);
    });

    test('pattern with port rejects different port', () => {
      expect(matchPattern('http://localhost:3000/path', '*://localhost:9516/*')).toBe(false);
    });

    test('pattern without port matches default port', () => {
      expect(matchPattern('https://example.com/path', '*://example.com/*')).toBe(true);
    });

    test('pattern without port matches URL with explicit port', () => {
      expect(matchPattern('https://example.com:8080/path', '*://example.com/*')).toBe(true);
    });

    test('localhost with explicit port matches', () => {
      expect(matchPattern('http://localhost:3000/', 'http://localhost:3000/*')).toBe(true);
    });

    test('default port in pattern does not match URL without explicit port', () => {
      // URL.port is '' for default ports (443 for https), so pattern port '443' !== ''
      expect(matchPattern('https://example.com/path', 'https://example.com:443/*')).toBe(false);
    });

    test('port-only difference between URLs is detected', () => {
      expect(matchPattern('http://localhost:9517/path', '*://localhost:9516/*')).toBe(false);
    });

    test('pattern without port matches localhost with any port', () => {
      expect(matchPattern('http://localhost:9516/path', '*://localhost/*')).toBe(true);
    });

    test('non-default explicit port in URL matches same port in pattern', () => {
      expect(matchPattern('https://example.com:8443/path', '*://example.com:8443/*')).toBe(true);
    });
  });

  describe('path matching', () => {
    test('wildcard path matches any path', () => {
      expect(matchPattern('https://example.com/any/path/here', '*://example.com/*')).toBe(true);
    });

    test('specific path matches exactly', () => {
      expect(matchPattern('https://example.com/api/v1', '*://example.com/api/v1')).toBe(true);
    });

    test('specific path rejects different path', () => {
      expect(matchPattern('https://example.com/api/v2', '*://example.com/api/v1')).toBe(false);
    });

    test('path with wildcard at end matches prefix', () => {
      expect(matchPattern('https://example.com/api/v1/users', '*://example.com/api/*')).toBe(true);
    });

    test('root path matches', () => {
      expect(matchPattern('https://example.com/', '*://example.com/*')).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('invalid URL returns false', () => {
      expect(matchPattern('not-a-url', '*://example.com/*')).toBe(false);
    });

    test('invalid pattern returns false', () => {
      expect(matchPattern('https://example.com/path', 'not-a-pattern')).toBe(false);
    });

    test('empty URL returns false', () => {
      expect(matchPattern('', '*://example.com/*')).toBe(false);
    });

    test('URL with regex-significant characters in path', () => {
      expect(matchPattern('https://example.com/foo.bar', '*://example.com/foo.bar')).toBe(true);
      // dot should be literal, not regex wildcard
      expect(matchPattern('https://example.com/fooXbar', '*://example.com/foo.bar')).toBe(false);
    });

    test('URL with query string (wildcard path)', () => {
      expect(matchPattern('https://example.com/path?key=value', '*://example.com/*')).toBe(true);
    });

    test('URL with query string (specific path)', () => {
      expect(matchPattern('https://example.com/path?foo=bar', '*://example.com/path')).toBe(true);
    });

    test('URL with query string does not pollute path matching', () => {
      expect(matchPattern('https://example.com/path?extra=/other', '*://example.com/path')).toBe(true);
    });

    test('URL with hash fragment (wildcard path)', () => {
      expect(matchPattern('https://example.com/path#section', '*://example.com/*')).toBe(true);
    });

    test('URL with hash fragment (specific path)', () => {
      expect(matchPattern('https://example.com/path#section', '*://example.com/path')).toBe(true);
    });

    test('URL with both query string and hash fragment (specific path)', () => {
      expect(matchPattern('https://example.com/path?key=value#section', '*://example.com/path')).toBe(true);
    });
  });
});

describe('urlMatchesPatterns', () => {
  test('matches any pattern in the list', () => {
    const patterns = ['*://app.slack.com/*', '*://example.com/*'];
    expect(urlMatchesPatterns('https://app.slack.com/path', patterns)).toBe(true);
  });

  test('returns false if no pattern matches', () => {
    const patterns = ['*://app.slack.com/*', '*://example.com/*'];
    expect(urlMatchesPatterns('https://other.com/path', patterns)).toBe(false);
  });

  test('empty patterns list returns false', () => {
    expect(urlMatchesPatterns('https://example.com/path', [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findAllMatchingTabs — requires Chrome API mocks
// ---------------------------------------------------------------------------

const FOCUSED_WINDOW_ID = 100;
const OTHER_WINDOW_ID = 200;

const makeTab = (id: number, opts: { active?: boolean; windowId?: number } = {}): chrome.tabs.Tab =>
  ({
    id,
    active: opts.active ?? false,
    windowId: opts.windowId ?? OTHER_WINDOW_ID,
  }) as chrome.tabs.Tab;

const makePlugin = (urlPatterns: string[]): PluginMeta => ({
  name: 'test-plugin',
  version: '1.0.0',
  urlPatterns,
  trustTier: 'local',
  tools: [{ name: 'test-tool', description: 'A test tool', enabled: true }],
});

let queryResults: Map<string, chrome.tabs.Tab[]>;

beforeEach(() => {
  queryResults = new Map();
  (globalThis as Record<string, unknown>).chrome = {
    tabs: {
      query: ({ url }: { url: string }): Promise<chrome.tabs.Tab[]> => Promise.resolve(queryResults.get(url) ?? []),
    },
    windows: {
      getLastFocused: (): Promise<{ id: number }> => Promise.resolve({ id: FOCUSED_WINDOW_ID }),
    },
  };
});

describe('findAllMatchingTabs', () => {
  test('active tab in focused window is ranked first', async () => {
    const activeFocused = makeTab(1, { active: true, windowId: FOCUSED_WINDOW_ID });
    const activeOther = makeTab(2, { active: true, windowId: OTHER_WINDOW_ID });
    const inactiveUnfocused = makeTab(3, { active: false, windowId: OTHER_WINDOW_ID });

    queryResults.set('*://example.com/*', [inactiveUnfocused, activeOther, activeFocused]);

    const result = await findAllMatchingTabs(makePlugin(['*://example.com/*']));
    expect(result.map(t => t.id)).toEqual([1, 2, 3]);
  });

  test('active-only tab is ranked above focused-only tab', async () => {
    const activeOther = makeTab(1, { active: true, windowId: OTHER_WINDOW_ID });
    const inactiveFocused = makeTab(2, { active: false, windowId: FOCUSED_WINDOW_ID });

    queryResults.set('*://example.com/*', [inactiveFocused, activeOther]);

    const result = await findAllMatchingTabs(makePlugin(['*://example.com/*']));
    expect(result.map(t => t.id)).toEqual([1, 2]);
  });

  test('inactive unfocused tab is ranked last', async () => {
    const activeFocused = makeTab(1, { active: true, windowId: FOCUSED_WINDOW_ID });
    const inactiveFocused = makeTab(2, { active: false, windowId: FOCUSED_WINDOW_ID });
    const activeOther = makeTab(3, { active: true, windowId: OTHER_WINDOW_ID });
    const inactiveUnfocused = makeTab(4, { active: false, windowId: OTHER_WINDOW_ID });

    queryResults.set('*://example.com/*', [inactiveUnfocused, inactiveFocused, activeOther, activeFocused]);

    const result = await findAllMatchingTabs(makePlugin(['*://example.com/*']));
    expect(result.map(t => t.id)).toEqual([1, 3, 2, 4]);
  });

  test('deduplicates when same tab matches multiple URL patterns', async () => {
    const tab = makeTab(1, { active: true, windowId: FOCUSED_WINDOW_ID });

    queryResults.set('*://example.com/*', [tab]);
    queryResults.set('*://*.example.com/*', [tab]);

    const result = await findAllMatchingTabs(makePlugin(['*://example.com/*', '*://*.example.com/*']));
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(1);
  });

  test('returns empty array when no tabs match', async () => {
    const result = await findAllMatchingTabs(makePlugin(['*://example.com/*']));
    expect(result).toEqual([]);
  });

  test('returns single tab without sorting', async () => {
    const tab = makeTab(1, { active: false, windowId: OTHER_WINDOW_ID });
    queryResults.set('*://example.com/*', [tab]);

    const result = await findAllMatchingTabs(makePlugin(['*://example.com/*']));
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(1);
  });

  test('skips patterns that throw errors', async () => {
    const tab = makeTab(1, { active: true, windowId: FOCUSED_WINDOW_ID });

    // Set up a query mock that rejects for invalid patterns
    (globalThis as Record<string, unknown>).chrome = {
      tabs: {
        query: ({ url }: { url: string }): Promise<chrome.tabs.Tab[]> => {
          if (url === 'bad-pattern') return Promise.reject(new Error('Invalid pattern'));
          if (url === '*://good.com/*') return Promise.resolve([tab]);
          return Promise.resolve([]);
        },
      },
      windows: {
        getLastFocused: (): Promise<{ id: number }> => Promise.resolve({ id: FOCUSED_WINDOW_ID }),
      },
    };

    const result = await findAllMatchingTabs(makePlugin(['bad-pattern', '*://good.com/*']));
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(1);
  });
});

describe('findMatchingTab', () => {
  test('returns the highest-ranked matching tab when multiple tabs match', async () => {
    const activeFocused = makeTab(1, { active: true, windowId: FOCUSED_WINDOW_ID });
    const activeOther = makeTab(2, { active: true, windowId: OTHER_WINDOW_ID });
    const inactiveUnfocused = makeTab(3, { active: false, windowId: OTHER_WINDOW_ID });

    queryResults.set('*://example.com/*', [inactiveUnfocused, activeOther, activeFocused]);

    const result = await findMatchingTab(makePlugin(['*://example.com/*']));
    expect(result?.id).toBe(1);
  });

  test('returns null when no tabs match any pattern', async () => {
    const result = await findMatchingTab(makePlugin(['*://example.com/*']));
    expect(result).toBeNull();
  });

  test('returns null when patterns array is empty', async () => {
    const result = await findMatchingTab(makePlugin([]));
    expect(result).toBeNull();
  });
});
