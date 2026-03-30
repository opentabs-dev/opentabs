import type { WsHandle } from '@opentabs-dev/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ExtensionConnection } from './state.js';
import {
  consumeReviewToken,
  createState,
  EMPTY_REGISTRY,
  findConnectionByWs,
  generateReviewToken,
  getAnyConnection,
  getConfiguredToolPermission,
  getConnectionForTab,
  getMergedTabMapping,
  getNextRequestId,
  getToolPermission,
  isExtensionConnected,
  prefixedToolName,
  REVIEW_TOKEN_TTL_MS,
  STATE_SCHEMA_VERSION,
  validateReviewToken,
} from './state.js';

/** Create a mock WsHandle */
const createMockWs = (): WsHandle => ({
  send() {},
  close() {},
});

/** Create a mock ExtensionConnection */
const createMockConnection = (id: string, ws?: WsHandle): ExtensionConnection => ({
  ws: ws ?? createMockWs(),
  connectionId: id,
  profileLabel: id,
  tabMapping: new Map(),
  activeNetworkCaptures: new Set(),
});

describe('createState', () => {
  test('returns state with correct defaults', () => {
    const state = createState();

    expect(state._schemaVersion).toBe(STATE_SCHEMA_VERSION);
    expect(state.registry.plugins).toBeInstanceOf(Map);
    expect(state.registry.plugins.size).toBe(0);
    expect(getMergedTabMapping(state)).toBeInstanceOf(Map);
    expect(getMergedTabMapping(state).size).toBe(0);
    expect(state.pluginPaths).toEqual([]);
    expect(state.pendingDispatches).toBeInstanceOf(Map);
    expect(state.pendingDispatches.size).toBe(0);
    expect(state.extensionConnections).toBeInstanceOf(Map);
    expect(state.extensionConnections.size).toBe(0);
    expect(state.outdatedPlugins).toEqual([]);
    expect(state.browserTools).toEqual([]);
    expect(state.fileWatching.entries).toEqual([]);
    expect(state.fileWatching.timers).toBeInstanceOf(Map);
    expect(state.fileWatching.timers.size).toBe(0);
    expect(state.wsSecret).toBeNull();
    expect(state.registry.toolLookup).toBeInstanceOf(Map);
    expect(state.registry.toolLookup.size).toBe(0);
    expect(state.cachedBrowserTools).toEqual([]);
    expect(state.activeDispatches).toBeInstanceOf(Map);
    expect(state.activeDispatches.size).toBe(0);
    expect(state.skipPermissions).toBe(false);
    expect(state.pluginPermissions).toEqual({});
    expect(state.pendingConfirmations).toBeInstanceOf(Map);
    expect(state.pendingConfirmations.size).toBe(0);
  });

  test('returns a fresh state on each call (no shared references)', () => {
    const a = createState();
    const b = createState();

    expect(a).not.toBe(b);
    expect(a.extensionConnections).not.toBe(b.extensionConnections);
    expect(a.pendingDispatches).not.toBe(b.pendingDispatches);
  });
});

describe('getNextRequestId', () => {
  test('returns a valid UUID string', () => {
    const id = getNextRequestId();

    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('returns unique IDs on each call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => getNextRequestId()));

    expect(ids.size).toBe(100);
  });
});

describe('prefixedToolName', () => {
  test('joins plugin and tool names with underscore', () => {
    expect(prefixedToolName('slack', 'send_message')).toBe('slack_send_message');
  });

  test('works with single-word tool names', () => {
    expect(prefixedToolName('browser', 'navigate')).toBe('browser_navigate');
  });

  test('handles empty strings', () => {
    expect(prefixedToolName('', '')).toBe('_');
  });
});

describe('getToolPermission', () => {
  test('returns "off" when skipPermissions is true but no plugin config', () => {
    const state = createState();
    state.skipPermissions = true;
    expect(getToolPermission(state, 'slack', 'send_message')).toBe('off');
  });

  test('returns "off" when skipPermissions is true and plugin permission is "off"', () => {
    const state = createState();
    state.skipPermissions = true;
    state.pluginPermissions = { slack: { permission: 'off' } };
    expect(getToolPermission(state, 'slack', 'send_message')).toBe('off');
  });

  test('returns "auto" when skipPermissions is true and permission is "ask"', () => {
    const state = createState();
    state.skipPermissions = true;
    state.pluginPermissions = { slack: { permission: 'ask' } };
    expect(getToolPermission(state, 'slack', 'send_message')).toBe('auto');
  });

  test('returns "auto" when skipPermissions is true and permission is "auto"', () => {
    const state = createState();
    state.skipPermissions = true;
    state.pluginPermissions = { slack: { permission: 'auto' } };
    expect(getToolPermission(state, 'slack', 'send_message')).toBe('auto');
  });

  test('returns "off" when skipPermissions is true and per-tool override is "off" despite plugin default "ask"', () => {
    const state = createState();
    state.skipPermissions = true;
    state.pluginPermissions = { slack: { permission: 'ask', tools: { send_message: 'off' } } };
    expect(getToolPermission(state, 'slack', 'send_message')).toBe('off');
  });

  test('returns "off" for unconfigured plugin', () => {
    const state = createState();
    expect(getToolPermission(state, 'slack', 'send_message')).toBe('off');
  });

  test('returns plugin-level permission when tool is not overridden', () => {
    const state = createState();
    state.pluginPermissions = { slack: { permission: 'ask' } };
    expect(getToolPermission(state, 'slack', 'send_message')).toBe('ask');
  });

  test('returns per-tool override over plugin default', () => {
    const state = createState();
    state.pluginPermissions = {
      slack: { permission: 'ask', tools: { send_message: 'auto' } },
    };
    expect(getToolPermission(state, 'slack', 'send_message')).toBe('auto');
  });

  test('returns plugin default for tool not in overrides', () => {
    const state = createState();
    state.pluginPermissions = {
      slack: { permission: 'auto', tools: { send_message: 'ask' } },
    };
    expect(getToolPermission(state, 'slack', 'read_messages')).toBe('auto');
  });

  test('returns "off" when plugin config has no permission and no tool override', () => {
    const state = createState();
    state.pluginPermissions = { slack: {} };
    expect(getToolPermission(state, 'slack', 'send_message')).toBe('off');
  });

  test('returns "off" when plugin config has tools but not the requested one, and no plugin permission', () => {
    const state = createState();
    state.pluginPermissions = { slack: { tools: { read_messages: 'auto' } } };
    expect(getToolPermission(state, 'slack', 'send_message')).toBe('off');
  });
});

describe('getConfiguredToolPermission', () => {
  test('returns "off" for unconfigured plugin', () => {
    const state = createState();
    expect(getConfiguredToolPermission(state, 'slack', 'send_message')).toBe('off');
  });

  test('returns plugin-level permission when tool is not overridden', () => {
    const state = createState();
    state.pluginPermissions = { slack: { permission: 'ask' } };
    expect(getConfiguredToolPermission(state, 'slack', 'send_message')).toBe('ask');
  });

  test('returns per-tool override over plugin default', () => {
    const state = createState();
    state.pluginPermissions = { slack: { permission: 'ask', tools: { send_message: 'auto' } } };
    expect(getConfiguredToolPermission(state, 'slack', 'send_message')).toBe('auto');
  });

  test('ignores skipPermissions — returns "ask" even when skipPermissions is true', () => {
    const state = createState();
    state.skipPermissions = true;
    state.pluginPermissions = { slack: { permission: 'ask' } };
    expect(getConfiguredToolPermission(state, 'slack', 'send_message')).toBe('ask');
  });

  test('ignores skipPermissions for per-tool override of "ask"', () => {
    const state = createState();
    state.skipPermissions = true;
    state.pluginPermissions = { slack: { permission: 'auto', tools: { send_message: 'ask' } } };
    expect(getConfiguredToolPermission(state, 'slack', 'send_message')).toBe('ask');
  });

  test('returns "off" when skipPermissions is true but no plugin config', () => {
    const state = createState();
    state.skipPermissions = true;
    expect(getConfiguredToolPermission(state, 'slack', 'send_message')).toBe('off');
  });
});

describe('EMPTY_REGISTRY', () => {
  test('registry maps are frozen instances of Map', () => {
    expect(EMPTY_REGISTRY.plugins).toBeInstanceOf(Map);
    expect(EMPTY_REGISTRY.toolLookup).toBeInstanceOf(Map);
    expect(Object.isFrozen(EMPTY_REGISTRY.plugins)).toBe(true);
    expect(Object.isFrozen(EMPTY_REGISTRY.toolLookup)).toBe(true);
  });

  test('failures array is frozen', () => {
    expect(Object.isFrozen(EMPTY_REGISTRY.failures)).toBe(true);
  });

  test('calling .set() on a frozen registry map throws TypeError', () => {
    const map = EMPTY_REGISTRY.plugins as unknown as Map<string, unknown>;
    expect(() => map.set('key', {})).toThrow(TypeError);
  });

  test('non-sentinel maps (new Map()) remain mutable', () => {
    const freshMap = new Map<string, unknown>();
    expect(() => freshMap.set('key', {})).not.toThrow();
  });
});

describe('review tokens', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateReviewToken', () => {
    test('returns a unique token string', () => {
      const state = createState();
      const token1 = generateReviewToken(state, 'slack', '1.0.0');
      const token2 = generateReviewToken(state, 'slack', '1.0.0');

      expect(typeof token1).toBe('string');
      expect(typeof token2).toBe('string');
      expect(token1).not.toBe(token2);
    });

    test('stores the token in the reviewTokens map', () => {
      const state = createState();
      const token = generateReviewToken(state, 'slack', '1.0.0');

      expect(state.reviewTokens.has(token)).toBe(true);
      const entry = state.reviewTokens.get(token);
      expect(entry).toBeDefined();
      expect(entry?.plugin).toBe('slack');
      expect(entry?.version).toBe('1.0.0');
      expect(entry?.used).toBe(false);
    });

    test('lazily cleans up expired tokens', () => {
      const state = createState();
      const expiredToken = generateReviewToken(state, 'old-plugin', '0.1.0');
      expect(state.reviewTokens.has(expiredToken)).toBe(true);

      // Advance past TTL
      vi.advanceTimersByTime(REVIEW_TOKEN_TTL_MS + 1);

      // Generating a new token triggers cleanup
      generateReviewToken(state, 'slack', '1.0.0');
      expect(state.reviewTokens.has(expiredToken)).toBe(false);
    });
  });

  describe('validateReviewToken', () => {
    test('returns true for a fresh, matching token', () => {
      const state = createState();
      const token = generateReviewToken(state, 'slack', '1.0.0');

      expect(validateReviewToken(state, token, 'slack', '1.0.0')).toBe(true);
    });

    test('returns false for a nonexistent token', () => {
      const state = createState();

      expect(validateReviewToken(state, 'nonexistent-token', 'slack', '1.0.0')).toBe(false);
    });

    test('returns false for wrong plugin', () => {
      const state = createState();
      const token = generateReviewToken(state, 'slack', '1.0.0');

      expect(validateReviewToken(state, token, 'discord', '1.0.0')).toBe(false);
    });

    test('returns false for wrong version', () => {
      const state = createState();
      const token = generateReviewToken(state, 'slack', '1.0.0');

      expect(validateReviewToken(state, token, 'slack', '2.0.0')).toBe(false);
    });

    test('returns false for expired token', () => {
      const state = createState();
      const token = generateReviewToken(state, 'slack', '1.0.0');

      vi.advanceTimersByTime(REVIEW_TOKEN_TTL_MS + 1);

      expect(validateReviewToken(state, token, 'slack', '1.0.0')).toBe(false);
    });

    test('returns false for already-used token', () => {
      const state = createState();
      const token = generateReviewToken(state, 'slack', '1.0.0');

      consumeReviewToken(state, token);

      expect(validateReviewToken(state, token, 'slack', '1.0.0')).toBe(false);
    });
  });

  describe('consumeReviewToken', () => {
    test('marks a token as used', () => {
      const state = createState();
      const token = generateReviewToken(state, 'slack', '1.0.0');

      expect(state.reviewTokens.get(token)?.used).toBe(false);
      consumeReviewToken(state, token);
      expect(state.reviewTokens.get(token)?.used).toBe(true);
    });

    test('is a no-op for nonexistent tokens', () => {
      const state = createState();

      // Should not throw
      consumeReviewToken(state, 'nonexistent-token');
    });
  });
});

describe('multi-connection helpers', () => {
  describe('isExtensionConnected', () => {
    test('returns false when no connections exist', () => {
      const state = createState();
      expect(isExtensionConnected(state)).toBe(false);
    });

    test('returns true when one connection exists', () => {
      const state = createState();
      state.extensionConnections.set('conn-1', createMockConnection('conn-1'));
      expect(isExtensionConnected(state)).toBe(true);
    });

    test('returns true when multiple connections exist', () => {
      const state = createState();
      state.extensionConnections.set('conn-1', createMockConnection('conn-1'));
      state.extensionConnections.set('conn-2', createMockConnection('conn-2'));
      expect(isExtensionConnected(state)).toBe(true);
    });
  });

  describe('getAnyConnection', () => {
    test('returns undefined when no connections exist', () => {
      const state = createState();
      expect(getAnyConnection(state)).toBeUndefined();
    });

    test('returns a connection when one exists', () => {
      const state = createState();
      const conn = createMockConnection('conn-1');
      state.extensionConnections.set('conn-1', conn);
      expect(getAnyConnection(state)).toBe(conn);
    });
  });

  describe('getConnectionForTab', () => {
    test('returns undefined when no connections exist', () => {
      const state = createState();
      expect(getConnectionForTab(state, 42)).toBeUndefined();
    });

    test('returns the connection that owns the tab', () => {
      const state = createState();
      const connA = createMockConnection('conn-a');
      connA.tabMapping.set('slack', {
        state: 'ready',
        tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: true }],
      });
      const connB = createMockConnection('conn-b');
      connB.tabMapping.set('slack', {
        state: 'ready',
        tabs: [{ tabId: 20, url: 'https://app.slack.com', title: 'Slack', ready: true }],
      });
      state.extensionConnections.set('conn-a', connA);
      state.extensionConnections.set('conn-b', connB);

      expect(getConnectionForTab(state, 10)).toBe(connA);
      expect(getConnectionForTab(state, 20)).toBe(connB);
    });

    test('returns undefined when tab is not in any connection', () => {
      const state = createState();
      const conn = createMockConnection('conn-1');
      conn.tabMapping.set('slack', {
        state: 'ready',
        tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: true }],
      });
      state.extensionConnections.set('conn-1', conn);

      expect(getConnectionForTab(state, 999)).toBeUndefined();
    });
  });

  describe('findConnectionByWs', () => {
    test('returns undefined when no connections exist', () => {
      const state = createState();
      expect(findConnectionByWs(state, createMockWs())).toBeUndefined();
    });

    test('returns the connection matching the ws by identity', () => {
      const state = createState();
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      const conn1 = createMockConnection('conn-1', ws1);
      const conn2 = createMockConnection('conn-2', ws2);
      state.extensionConnections.set('conn-1', conn1);
      state.extensionConnections.set('conn-2', conn2);

      expect(findConnectionByWs(state, ws1)).toBe(conn1);
      expect(findConnectionByWs(state, ws2)).toBe(conn2);
    });

    test('returns undefined for an unregistered ws', () => {
      const state = createState();
      const ws1 = createMockWs();
      state.extensionConnections.set('conn-1', createMockConnection('conn-1', ws1));

      expect(findConnectionByWs(state, createMockWs())).toBeUndefined();
    });
  });

  describe('getMergedTabMapping', () => {
    test('returns empty map when no connections exist', () => {
      const state = createState();
      expect(getMergedTabMapping(state).size).toBe(0);
    });

    test('returns single connection tabs unchanged', () => {
      const state = createState();
      const conn = createMockConnection('conn-1');
      conn.tabMapping.set('slack', {
        state: 'ready',
        tabs: [{ tabId: 1, url: 'https://app.slack.com', title: 'Slack', ready: true }],
      });
      state.extensionConnections.set('conn-1', conn);

      const merged = getMergedTabMapping(state);
      expect(merged.size).toBe(1);
      expect(merged.get('slack')?.tabs).toHaveLength(1);
      expect(merged.get('slack')?.tabs[0]?.tabId).toBe(1);
    });

    test('merges tabs from multiple connections for the same plugin', () => {
      const state = createState();
      const connA = createMockConnection('conn-a');
      connA.tabMapping.set('slack', {
        state: 'ready',
        tabs: [{ tabId: 1, url: 'https://app.slack.com', title: 'Slack 1', ready: true }],
      });
      const connB = createMockConnection('conn-b');
      connB.tabMapping.set('slack', {
        state: 'unavailable',
        tabs: [{ tabId: 2, url: 'https://app.slack.com', title: 'Slack 2', ready: false }],
      });
      state.extensionConnections.set('conn-a', connA);
      state.extensionConnections.set('conn-b', connB);

      const merged = getMergedTabMapping(state);
      expect(merged.size).toBe(1);
      const slackMapping = merged.get('slack');
      expect(slackMapping?.tabs).toHaveLength(2);
      // Uses the "most ready" state: ready > unavailable
      expect(slackMapping?.state).toBe('ready');
    });

    test('merges different plugins from different connections', () => {
      const state = createState();
      const connA = createMockConnection('conn-a');
      connA.tabMapping.set('slack', {
        state: 'ready',
        tabs: [{ tabId: 1, url: 'https://app.slack.com', title: 'Slack', ready: true }],
      });
      const connB = createMockConnection('conn-b');
      connB.tabMapping.set('discord', {
        state: 'ready',
        tabs: [{ tabId: 2, url: 'https://discord.com', title: 'Discord', ready: true }],
      });
      state.extensionConnections.set('conn-a', connA);
      state.extensionConnections.set('conn-b', connB);

      const merged = getMergedTabMapping(state);
      expect(merged.size).toBe(2);
      expect(merged.has('slack')).toBe(true);
      expect(merged.has('discord')).toBe(true);
    });
  });
});
