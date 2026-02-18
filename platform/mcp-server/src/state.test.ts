import { createState, getNextRequestId, isToolEnabled, prefixedToolName, STATE_SCHEMA_VERSION } from './state.js';
import { describe, expect, test } from 'bun:test';

describe('createState', () => {
  test('returns state with correct defaults', () => {
    const state = createState();

    expect(state._schemaVersion).toBe(STATE_SCHEMA_VERSION);
    expect(state.plugins).toBeInstanceOf(Map);
    expect(state.plugins.size).toBe(0);
    expect(state.tabMapping).toBeInstanceOf(Map);
    expect(state.tabMapping.size).toBe(0);
    expect(state.toolConfig).toEqual({});
    expect(state.pluginPaths).toEqual([]);
    expect(state.pendingDispatches).toBeInstanceOf(Map);
    expect(state.pendingDispatches.size).toBe(0);
    expect(state.extensionWs).toBeNull();
    expect(state.outdatedPlugins).toEqual([]);
    expect(state.browserTools).toEqual([]);
    expect(state.fileWatcherEntries).toEqual([]);
    expect(state.fileWatcherTimers).toBeInstanceOf(Map);
    expect(state.fileWatcherTimers.size).toBe(0);
    expect(state.wsSecret).toBeNull();
    expect(state.toolLookup).toBeInstanceOf(Map);
    expect(state.toolLookup.size).toBe(0);
    expect(state.cachedBrowserTools).toEqual([]);
    expect(state.activeDispatches).toBeInstanceOf(Map);
    expect(state.activeDispatches.size).toBe(0);
  });

  test('returns a fresh state on each call (no shared references)', () => {
    const a = createState();
    const b = createState();

    expect(a).not.toBe(b);
    expect(a.plugins).not.toBe(b.plugins);
    expect(a.tabMapping).not.toBe(b.tabMapping);
    expect(a.pendingDispatches).not.toBe(b.pendingDispatches);
  });
});

describe('getNextRequestId', () => {
  test('returns a valid UUID string', () => {
    const state = createState();
    const id = getNextRequestId(state);

    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('returns unique IDs on each call', () => {
    const state = createState();
    const ids = new Set(Array.from({ length: 100 }, () => getNextRequestId(state)));

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

describe('isToolEnabled', () => {
  test('returns true by default when tool is not in config', () => {
    const state = createState();
    expect(isToolEnabled(state, 'slack_send_message')).toBe(true);
  });

  test('returns false when tool is explicitly disabled', () => {
    const state = createState();
    state.toolConfig = { slack_send_message: false };
    expect(isToolEnabled(state, 'slack_send_message')).toBe(false);
  });

  test('returns true when tool is explicitly enabled', () => {
    const state = createState();
    state.toolConfig = { slack_send_message: true };
    expect(isToolEnabled(state, 'slack_send_message')).toBe(true);
  });

  test('only checks the specific tool name', () => {
    const state = createState();
    state.toolConfig = { slack_send_message: false };
    expect(isToolEnabled(state, 'slack_read_messages')).toBe(true);
  });
});
