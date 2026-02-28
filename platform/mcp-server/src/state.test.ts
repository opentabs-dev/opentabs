import {
  createState,
  EMPTY_REGISTRY,
  getNextRequestId,
  isBrowserToolEnabled,
  isSessionAllowed,
  isToolEnabled,
  prefixedToolName,
  STATE_SCHEMA_VERSION,
} from './state.js';
import { describe, expect, test } from 'vitest';
import type { SessionPermissionRule } from './state.js';

describe('createState', () => {
  test('returns state with correct defaults', () => {
    const state = createState();

    expect(state._schemaVersion).toBe(STATE_SCHEMA_VERSION);
    expect(state.registry.plugins).toBeInstanceOf(Map);
    expect(state.registry.plugins.size).toBe(0);
    expect(state.tabMapping).toBeInstanceOf(Map);
    expect(state.tabMapping.size).toBe(0);
    expect(state.toolConfig).toEqual({});
    expect(state.browserToolPolicy).toEqual({});
    expect(state.pluginPaths).toEqual([]);
    expect(state.pendingDispatches).toBeInstanceOf(Map);
    expect(state.pendingDispatches.size).toBe(0);
    expect(state.extensionWs).toBeNull();
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
    expect(state.skipConfirmation).toBe(false);
    expect(state.permissions.trustedDomains).toEqual(['localhost', '127.0.0.1']);
    expect(state.permissions.sensitiveDomains).toEqual([]);
    expect(state.permissions.toolPolicy).toEqual({});
    expect(state.permissions.domainToolPolicy).toEqual({});
  });

  test('returns a fresh state on each call (no shared references)', () => {
    const a = createState();
    const b = createState();

    expect(a).not.toBe(b);
    expect(a.tabMapping).not.toBe(b.tabMapping);
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

describe('isBrowserToolEnabled', () => {
  test('returns true by default when tool is not in policy', () => {
    const state = createState();
    expect(isBrowserToolEnabled(state, 'browser_execute_script')).toBe(true);
  });

  test('returns false when tool is explicitly disabled', () => {
    const state = createState();
    state.browserToolPolicy = { browser_execute_script: false };
    expect(isBrowserToolEnabled(state, 'browser_execute_script')).toBe(false);
  });

  test('returns true when tool is explicitly enabled', () => {
    const state = createState();
    state.browserToolPolicy = { browser_execute_script: true };
    expect(isBrowserToolEnabled(state, 'browser_execute_script')).toBe(true);
  });

  test('only checks the specific tool name', () => {
    const state = createState();
    state.browserToolPolicy = { browser_execute_script: false };
    expect(isBrowserToolEnabled(state, 'browser_list_tabs')).toBe(true);
  });
});

describe('isSessionAllowed', () => {
  test('domain_all with null domain matches calls with null domain', () => {
    const rules: SessionPermissionRule[] = [{ tool: null, domain: null, scope: 'domain_all' }];
    expect(isSessionAllowed(rules, 'slack_send_message', null)).toBe(true);
  });

  test('domain_all with null domain matches calls with a specific domain', () => {
    const rules: SessionPermissionRule[] = [{ tool: null, domain: null, scope: 'domain_all' }];
    expect(isSessionAllowed(rules, 'slack_send_message', 'example.com')).toBe(true);
  });

  test('domain_all with a non-null domain only matches calls with that same domain', () => {
    const rules: SessionPermissionRule[] = [{ tool: null, domain: 'example.com', scope: 'domain_all' }];
    expect(isSessionAllowed(rules, 'slack_send_message', 'example.com')).toBe(true);
    expect(isSessionAllowed(rules, 'slack_send_message', 'other.com')).toBe(false);
    expect(isSessionAllowed(rules, 'slack_send_message', null)).toBe(false);
  });

  test('tool_domain matches only when both tool and domain match', () => {
    const rules: SessionPermissionRule[] = [
      { tool: 'slack_send_message', domain: 'example.com', scope: 'tool_domain' },
    ];
    expect(isSessionAllowed(rules, 'slack_send_message', 'example.com')).toBe(true);
    expect(isSessionAllowed(rules, 'slack_send_message', 'other.com')).toBe(false);
    expect(isSessionAllowed(rules, 'slack_read_messages', 'example.com')).toBe(false);
  });

  test('tool_all matches any domain for the specific tool', () => {
    const rules: SessionPermissionRule[] = [{ tool: 'slack_send_message', domain: null, scope: 'tool_all' }];
    expect(isSessionAllowed(rules, 'slack_send_message', null)).toBe(true);
    expect(isSessionAllowed(rules, 'slack_send_message', 'example.com')).toBe(true);
    expect(isSessionAllowed(rules, 'slack_read_messages', null)).toBe(false);
  });

  test('returns false when no rules match', () => {
    const rules: SessionPermissionRule[] = [];
    expect(isSessionAllowed(rules, 'slack_send_message', 'example.com')).toBe(false);
  });
});

describe('EMPTY_REGISTRY', () => {
  test('registry maps are frozen instances of Map', () => {
    expect(EMPTY_REGISTRY.plugins).toBeInstanceOf(Map);
    expect(EMPTY_REGISTRY.toolLookup).toBeInstanceOf(Map);
    expect(EMPTY_REGISTRY.resourceLookup).toBeInstanceOf(Map);
    expect(EMPTY_REGISTRY.promptLookup).toBeInstanceOf(Map);
    expect(Object.isFrozen(EMPTY_REGISTRY.plugins)).toBe(true);
    expect(Object.isFrozen(EMPTY_REGISTRY.toolLookup)).toBe(true);
    expect(Object.isFrozen(EMPTY_REGISTRY.resourceLookup)).toBe(true);
    expect(Object.isFrozen(EMPTY_REGISTRY.promptLookup)).toBe(true);
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
