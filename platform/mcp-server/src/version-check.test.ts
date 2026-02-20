import { createState } from './state.js';
import { fetchLatestVersion, isNewer, checkForUpdates } from './version-check.js';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { RegisteredPlugin } from './state.js';

// ---- fetch mock helpers ----

/** Save and restore globalThis.fetch around each test that replaces it */
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Create a mock fetch that returns the given npm registry JSON */
const mockFetch = (distTagsLatest: string | undefined, status = 200): void => {
  const body = JSON.stringify({
    'dist-tags': distTagsLatest !== undefined ? { latest: distTagsLatest } : {},
  });
  globalThis.fetch = ((_url: URL | string, _init?: RequestInit) =>
    Promise.resolve(new Response(body, { status }))) as unknown as typeof globalThis.fetch;
};

/** Create a minimal RegisteredPlugin for testing */
const makePlugin = (name: string, overrides: Partial<RegisteredPlugin> = {}): RegisteredPlugin => ({
  name,
  version: '1.0.0',
  displayName: name,
  urlPatterns: [`https://${name}.example.com/*`],
  trustTier: 'community',
  iife: `(function(){})()`,
  tools: [],
  adapterHash: 'abc123',
  ...overrides,
});

describe('isNewer', () => {
  describe('basic comparisons', () => {
    test('newer major version', () => {
      expect(isNewer('1.0.0', '2.0.0')).toBe(true);
    });

    test('newer minor version', () => {
      expect(isNewer('1.0.0', '1.1.0')).toBe(true);
    });

    test('newer patch version', () => {
      expect(isNewer('1.0.0', '1.0.1')).toBe(true);
    });

    test('same version', () => {
      expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    });

    test('older major version', () => {
      expect(isNewer('2.0.0', '1.0.0')).toBe(false);
    });

    test('older minor version', () => {
      expect(isNewer('1.1.0', '1.0.0')).toBe(false);
    });

    test('older patch version', () => {
      expect(isNewer('1.0.1', '1.0.0')).toBe(false);
    });
  });

  describe('v prefix handling', () => {
    test('strips v prefix from current', () => {
      expect(isNewer('v1.0.0', '2.0.0')).toBe(true);
    });

    test('strips v prefix from latest', () => {
      expect(isNewer('1.0.0', 'v2.0.0')).toBe(true);
    });

    test('strips v prefix from both', () => {
      expect(isNewer('v1.0.0', 'v1.0.0')).toBe(false);
    });
  });

  describe('prerelease handling', () => {
    test('prerelease suffix is stripped for comparison (1.0.0-beta.1 treated as 1.0.0)', () => {
      expect(isNewer('1.0.0-beta.1', '1.0.0')).toBe(false);
    });

    test('prerelease current vs newer release', () => {
      expect(isNewer('1.0.0-beta.1', '1.0.1')).toBe(true);
    });

    test('prerelease latest vs same base release', () => {
      expect(isNewer('2.0.0', '2.0.0-rc.1')).toBe(false);
    });

    test('prerelease does not cause NaN', () => {
      expect(isNewer('0.9.0', '1.0.0-beta.1')).toBe(true);
    });
  });

  describe('NaN segment handling', () => {
    test('malformed current segment treated as 0 (latest is newer)', () => {
      expect(isNewer('1.0.abc', '2.0.0')).toBe(true);
    });

    test('malformed latest segment treated as 0 (current is newer)', () => {
      expect(isNewer('2.0.0', '1.0.abc')).toBe(false);
    });

    test('both versions have malformed segments', () => {
      expect(isNewer('1.abc.0', '2.xyz.0')).toBe(true);
    });

    test('malformed segment in same position compares as equal (both become 0)', () => {
      expect(isNewer('1.abc.0', '1.xyz.0')).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('missing patch version treated as 0', () => {
      expect(isNewer('1.0', '1.0.1')).toBe(true);
    });

    test('handles large version numbers', () => {
      expect(isNewer('1.999.999', '2.0.0')).toBe(true);
    });

    test('major version difference dominates', () => {
      expect(isNewer('1.99.99', '2.0.0')).toBe(true);
      expect(isNewer('2.0.0', '1.99.99')).toBe(false);
    });
  });
});

describe('fetchLatestVersion', () => {
  test('unscoped package constructs correct npm registry URL', async () => {
    const seen: string[] = [];
    globalThis.fetch = ((url: URL | string, _init?: RequestInit) => {
      seen.push(String(url));
      return Promise.resolve(new Response(JSON.stringify({ 'dist-tags': { latest: '2.0.0' } }), { status: 200 }));
    }) as unknown as typeof globalThis.fetch;

    await fetchLatestVersion('my-package');
    expect(seen[0]).toBe('https://registry.npmjs.org/my-package');
  });

  test('scoped package encodes / as %2F in URL', async () => {
    const seen: string[] = [];
    globalThis.fetch = ((url: URL | string, _init?: RequestInit) => {
      seen.push(String(url));
      return Promise.resolve(new Response(JSON.stringify({ 'dist-tags': { latest: '1.2.3' } }), { status: 200 }));
    }) as unknown as typeof globalThis.fetch;

    await fetchLatestVersion('@opentabs-dev/plugin-sdk');
    expect(seen[0]).toBe('https://registry.npmjs.org/@opentabs-dev%2Fplugin-sdk');
  });

  test('successful fetch returns latest version string', async () => {
    mockFetch('3.1.4');
    const result = await fetchLatestVersion('some-package');
    expect(result).toBe('3.1.4');
  });

  test('non-200 response returns null', async () => {
    mockFetch(undefined, 404);
    const result = await fetchLatestVersion('missing-package');
    expect(result).toBeNull();
  });

  test('malformed JSON response returns null', async () => {
    globalThis.fetch = ((_url: URL | string, _init?: RequestInit) =>
      Promise.resolve(new Response('not valid json', { status: 200 }))) as unknown as typeof globalThis.fetch;
    const result = await fetchLatestVersion('some-package');
    expect(result).toBeNull();
  });

  test('network error (fetch throws) returns null', async () => {
    globalThis.fetch = ((_url: URL | string, _init?: RequestInit) =>
      Promise.reject(new Error('network timeout'))) as unknown as typeof globalThis.fetch;
    const result = await fetchLatestVersion('some-package');
    expect(result).toBeNull();
  });

  test('response with no dist-tags.latest returns null', async () => {
    globalThis.fetch = ((_url: URL | string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ 'dist-tags': {} }), { status: 200 }),
      )) as unknown as typeof globalThis.fetch;
    const result = await fetchLatestVersion('some-package');
    expect(result).toBeNull();
  });
});

describe('checkForUpdates', () => {
  test('local plugins (no npmPackageName) are skipped', async () => {
    const fetchCalls: string[] = [];
    globalThis.fetch = ((url: URL | string, _init?: RequestInit) => {
      fetchCalls.push(String(url));
      return Promise.resolve(new Response(JSON.stringify({ 'dist-tags': { latest: '2.0.0' } }), { status: 200 }));
    }) as unknown as typeof globalThis.fetch;

    const state = createState();
    state.plugins.set('local-plugin', makePlugin('local-plugin', { trustTier: 'local', npmPackageName: undefined }));

    await checkForUpdates(state);

    expect(fetchCalls).toHaveLength(0);
    expect(state.outdatedPlugins).toHaveLength(0);
  });

  test('outdated npm plugin is added to state.outdatedPlugins', async () => {
    mockFetch('2.0.0');

    const state = createState();
    state.plugins.set('my-plugin', makePlugin('my-plugin', { version: '1.0.0', npmPackageName: 'opentabs-plugin-my' }));

    await checkForUpdates(state);

    expect(state.outdatedPlugins).toHaveLength(1);
    expect(state.outdatedPlugins[0]?.name).toBe('opentabs-plugin-my');
    expect(state.outdatedPlugins[0]?.currentVersion).toBe('1.0.0');
    expect(state.outdatedPlugins[0]?.latestVersion).toBe('2.0.0');
  });

  test('up-to-date plugin is NOT added to state.outdatedPlugins', async () => {
    mockFetch('1.0.0');

    const state = createState();
    state.plugins.set('my-plugin', makePlugin('my-plugin', { version: '1.0.0', npmPackageName: 'opentabs-plugin-my' }));

    await checkForUpdates(state);

    expect(state.outdatedPlugins).toHaveLength(0);
  });

  test('fetchLatestVersion returning null does not add to outdatedPlugins', async () => {
    globalThis.fetch = ((_url: URL | string, _init?: RequestInit) =>
      Promise.reject(new Error('network failure'))) as unknown as typeof globalThis.fetch;

    const state = createState();
    state.plugins.set('my-plugin', makePlugin('my-plugin', { version: '1.0.0', npmPackageName: 'opentabs-plugin-my' }));

    await checkForUpdates(state);

    expect(state.outdatedPlugins).toHaveLength(0);
  });

  test('empty plugins map results in empty outdatedPlugins', async () => {
    const state = createState();
    await checkForUpdates(state);
    expect(state.outdatedPlugins).toHaveLength(0);
  });

  test('mixed settled results: fulfilled outdated + rejected network error', async () => {
    let callCount = 0;
    globalThis.fetch = ((_url: URL | string, _init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(JSON.stringify({ 'dist-tags': { latest: '2.0.0' } }), { status: 200 }));
      }
      return Promise.reject(new Error('network failure'));
    }) as unknown as typeof globalThis.fetch;

    const state = createState();
    state.plugins.set('plugin-a', makePlugin('plugin-a', { version: '1.0.0', npmPackageName: 'opentabs-plugin-a' }));
    state.plugins.set('plugin-b', makePlugin('plugin-b', { version: '1.0.0', npmPackageName: 'opentabs-plugin-b' }));

    await checkForUpdates(state);

    // plugin-a gets version 2.0.0 (outdated), plugin-b fetch fails (skipped)
    expect(state.outdatedPlugins).toHaveLength(1);
    expect(state.outdatedPlugins[0]?.name).toBe('opentabs-plugin-a');
  });
});
