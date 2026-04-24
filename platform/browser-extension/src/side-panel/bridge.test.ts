import { beforeEach, describe, expect, test } from 'vitest';
import type { PluginState, WireToolDef } from './bridge.js';
import {
  extractShortName,
  getFullState,
  installPlugin,
  matchesPlugin,
  matchesTool,
  removePlugin,
  searchPlugins,
  sendConfirmationResponse,
  setAllToolsPermission,
  setPluginPermission,
  setToolPermission,
  updatePlugin,
} from './bridge.js';

/** Captured sendMessage calls. Each entry has the message object passed to sendMessage. */
let sendMessageCalls: Array<{ message: unknown }> = [];

/** Response to return from the next chrome.runtime.sendMessage callback */
let mockResponse: unknown;

/** When set, chrome.runtime.lastError will return this error */
let mockLastError: { message: string } | undefined;

beforeEach(() => {
  sendMessageCalls = [];
  mockResponse = undefined;
  mockLastError = undefined;

  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      get lastError() {
        return mockLastError;
      },
      sendMessage: (message: unknown, callback?: (response: unknown) => void) => {
        sendMessageCalls.push({ message });
        if (callback) {
          callback(mockResponse);
        }
        return Promise.resolve();
      },
    },
  };
});

// --- getFullState ---

describe('getFullState', () => {
  test('sends bg:getFullState and resolves with response', async () => {
    mockResponse = {
      connected: true,
      plugins: [{ name: 'slack' }],
      failedPlugins: [],
      browserTools: [],
      serverVersion: '1.0.0',
    };

    const result = await getFullState();
    expect(result.connected).toBe(true);
    expect(result.plugins).toEqual([{ name: 'slack' }]);
    expect(result.serverVersion).toBe('1.0.0');
    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]?.message).toEqual({ type: 'bg:getFullState' });
  });

  test('includes disconnectReason when disconnected', async () => {
    mockResponse = {
      connected: false,
      disconnectReason: 'connection_refused',
      plugins: [],
      failedPlugins: [],
      browserTools: [],
    };

    const result = await getFullState();
    expect(result.connected).toBe(false);
    expect(result.disconnectReason).toBe('connection_refused');
  });

  test('rejects when chrome.runtime.lastError is set', async () => {
    mockLastError = { message: 'Extension context invalidated.' };

    await expect(getFullState()).rejects.toThrow('Extension context invalidated.');
  });
});

// --- setToolPermission ---

describe('setToolPermission', () => {
  test('sends bg:setToolPermission with correct params', async () => {
    mockResponse = { ok: true };

    await setToolPermission('slack', 'send-message', 'auto');

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]?.message).toEqual({
      type: 'bg:setToolPermission',
      plugin: 'slack',
      tool: 'send-message',
      permission: 'auto',
    });
  });

  test('rejects when response contains error field', async () => {
    mockResponse = { error: 'Tool not found' };

    await expect(setToolPermission('slack', 'unknown', 'auto')).rejects.toThrow('Tool not found');
  });
});

// --- setAllToolsPermission ---

describe('setAllToolsPermission', () => {
  test('sends bg:setAllToolsPermission with correct params', async () => {
    mockResponse = { ok: true };

    await setAllToolsPermission('slack', 'auto');

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]?.message).toEqual({
      type: 'bg:setAllToolsPermission',
      plugin: 'slack',
      permission: 'auto',
    });
  });

  test('sends permission=off when disabling all tools', async () => {
    mockResponse = { ok: true };

    await setAllToolsPermission('datadog', 'off');

    expect(sendMessageCalls[0]?.message).toMatchObject({
      type: 'bg:setAllToolsPermission',
      plugin: 'datadog',
      permission: 'off',
    });
  });
});

// --- setPluginPermission ---

describe('setPluginPermission', () => {
  test('sends bg:setPluginPermission with correct params', async () => {
    mockResponse = { ok: true };

    await setPluginPermission('slack', 'auto');

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]?.message).toEqual({
      type: 'bg:setPluginPermission',
      plugin: 'slack',
      permission: 'auto',
    });
  });

  test('sends permission for browser pseudo-plugin', async () => {
    mockResponse = { ok: true };

    await setPluginPermission('browser', 'ask');

    expect(sendMessageCalls[0]?.message).toMatchObject({
      type: 'bg:setPluginPermission',
      plugin: 'browser',
      permission: 'ask',
    });
  });

  test('includes reviewedVersion when provided', async () => {
    mockResponse = { ok: true };

    await setPluginPermission('slack', 'auto', '1.2.0');

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]?.message).toEqual({
      type: 'bg:setPluginPermission',
      plugin: 'slack',
      permission: 'auto',
      reviewedVersion: '1.2.0',
    });
  });

  test('omits reviewedVersion when not provided', async () => {
    mockResponse = { ok: true };

    await setPluginPermission('slack', 'ask');

    expect(sendMessageCalls[0]?.message).not.toHaveProperty('reviewedVersion');
  });
});

// --- searchPlugins ---

describe('searchPlugins', () => {
  test('sends bg:searchPlugins with correct params', async () => {
    mockResponse = {
      results: [{ name: 'slack', displayName: 'Slack', description: 'Slack', version: '1.0', author: 'x' }],
    };

    const result = await searchPlugins('slack');

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]?.message).toEqual({ type: 'bg:searchPlugins', query: 'slack' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.name).toBe('slack');
  });

  test('rejects with error from background', async () => {
    mockResponse = { error: 'Search failed' };

    await expect(searchPlugins('test')).rejects.toThrow('Search failed');
  });
});

// --- installPlugin ---

describe('installPlugin', () => {
  test('sends bg:installPlugin with correct params', async () => {
    mockResponse = { ok: true, plugin: { name: 'slack', displayName: 'Slack', version: '1.0', toolCount: 3 } };

    const result = await installPlugin('@opentabs-dev/opentabs-plugin-slack');

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]?.message).toEqual({
      type: 'bg:installPlugin',
      name: '@opentabs-dev/opentabs-plugin-slack',
    });
    expect(result.ok).toBe(true);
  });

  test('rejects on install failure', async () => {
    mockResponse = { error: 'Package not found in registry' };

    await expect(installPlugin('nonexistent')).rejects.toThrow('Package not found in registry');
  });
});

// --- removePlugin ---

describe('removePlugin', () => {
  test('sends bg:removePlugin with correct params', async () => {
    mockResponse = { ok: true };

    const result = await removePlugin('slack');

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]?.message).toEqual({ type: 'bg:removePlugin', name: 'slack' });
    expect(result).toEqual({ ok: true });
  });

  test('rejects when plugin is not installed', async () => {
    mockResponse = { error: 'Plugin not installed' };

    await expect(removePlugin('nonexistent')).rejects.toThrow('Plugin not installed');
  });
});

// --- updatePlugin ---

describe('updatePlugin', () => {
  test('sends bg:updatePlugin with correct params', async () => {
    mockResponse = { ok: true, plugin: { name: 'slack', displayName: 'Slack', version: '2.0', toolCount: 5 } };

    const result = await updatePlugin('slack');

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]?.message).toEqual({ type: 'bg:updatePlugin', name: 'slack' });
    expect(result.ok).toBe(true);
  });
});

// --- sendBgMessage error handling ---

describe('sendBgMessage error handling', () => {
  test('rejects when chrome.runtime.lastError is set', async () => {
    mockLastError = { message: 'Extension context invalidated.' };

    await expect(setToolPermission('slack', 'send', 'auto')).rejects.toThrow('Extension context invalidated.');
  });

  test('rejects when response contains error field', async () => {
    mockResponse = { error: 'Server disconnected' };

    await expect(setToolPermission('slack', 'send', 'auto')).rejects.toThrow('Server disconnected');
  });

  test('resolves normally when response has no error field', async () => {
    mockResponse = { ok: true, extra: 'data' };

    const result = await setToolPermission('slack', 'send', 'auto');
    expect(result).toEqual({ ok: true, extra: 'data' });
  });
});

// --- Helper to create a minimal PluginState for testing ---

const tool = (overrides?: Partial<WireToolDef>): WireToolDef => ({
  name: 'send_message',
  displayName: 'Send Message',
  description: 'Send a message to a Slack channel',
  icon: 'send',
  permission: 'auto',
  ...overrides,
});

const plugin = (overrides?: Partial<PluginState>): PluginState => ({
  name: 'slack',
  displayName: 'Slack',
  version: '0.1.0',
  permission: 'off',
  source: 'npm',
  tabState: 'ready',
  urlPatterns: ['*://*.slack.com/*'],
  sdkVersion: '0.0.3',
  reviewed: true,
  hasPreScript: false,
  tools: [tool()],
  ...overrides,
});

// --- matchesTool ---

describe('matchesTool', () => {
  test('matches on tool displayName', () => {
    expect(matchesTool(tool(), 'send message')).toBe(true);
    expect(matchesTool(tool(), 'send')).toBe(true);
  });

  test('filterLower param must be lowercase (contract)', () => {
    // matchesTool lowercases the tool fields but compares against filterLower as-is.
    // Callers must pass a lowercase string.
    expect(matchesTool(tool(), 'send')).toBe(true);
    expect(matchesTool(tool(), 'SEND')).toBe(false);
  });

  test('matches on tool name (case-insensitive)', () => {
    expect(matchesTool(tool(), 'send_message')).toBe(true);
    expect(matchesTool(tool(), 'send_m')).toBe(true);
  });

  test('matches on tool description', () => {
    expect(matchesTool(tool(), 'slack channel')).toBe(true);
  });

  test('does not match unrelated query', () => {
    expect(matchesTool(tool(), 'github')).toBe(false);
  });

  test('matches partial substring', () => {
    expect(matchesTool(tool(), 'end_mes')).toBe(true);
  });

  test('empty filter matches everything', () => {
    expect(matchesTool(tool(), '')).toBe(true);
  });
});

// --- matchesPlugin ---

describe('matchesPlugin', () => {
  test('matches on plugin displayName', () => {
    expect(matchesPlugin(plugin(), 'slack')).toBe(true);
    expect(matchesPlugin(plugin(), 'sla')).toBe(true);
  });

  test('filterLower param must be lowercase (contract)', () => {
    expect(matchesPlugin(plugin(), 'slack')).toBe(true);
    expect(matchesPlugin(plugin(), 'SLACK')).toBe(false);
  });

  test('matches on plugin name', () => {
    expect(matchesPlugin(plugin(), 'slack')).toBe(true);
  });

  test('matches on tool name', () => {
    expect(matchesPlugin(plugin(), 'send_message')).toBe(true);
  });

  test('matches on tool displayName', () => {
    expect(matchesPlugin(plugin(), 'send message')).toBe(true);
  });

  test('does NOT match on tool description', () => {
    // The tool description says "Send a message to a Slack channel"
    // but matchesPlugin should not match on description text alone
    const p = plugin({
      name: 'e2e-test',
      displayName: 'E2E Test',
      tools: [tool({ name: 'do_thing', displayName: 'Do Thing', description: 'Does something with Slack' })],
    });
    expect(matchesPlugin(p, 'slack')).toBe(false);
  });

  test('does not match unrelated query', () => {
    expect(matchesPlugin(plugin(), 'github')).toBe(false);
  });

  test('matches when any tool name matches', () => {
    const p = plugin({
      tools: [
        tool({ name: 'list_channels', displayName: 'List Channels' }),
        tool({ name: 'send_message', displayName: 'Send Message' }),
      ],
    });
    expect(matchesPlugin(p, 'list_channels')).toBe(true);
  });

  test('empty filter matches everything', () => {
    expect(matchesPlugin(plugin(), '')).toBe(true);
  });

  test('plugin with no tools only matches on name/displayName', () => {
    const p = plugin({ tools: [] });
    expect(matchesPlugin(p, 'slack')).toBe(true);
    expect(matchesPlugin(p, 'send')).toBe(false);
  });
});

// --- extractShortName ---

describe('extractShortName', () => {
  test('extracts short name from scoped npm package', () => {
    expect(extractShortName('@opentabs-dev/opentabs-plugin-slack')).toBe('slack');
  });

  test('extracts short name from unscoped npm package', () => {
    expect(extractShortName('opentabs-plugin-datadog')).toBe('datadog');
  });

  test('returns bare name unchanged', () => {
    expect(extractShortName('slack')).toBe('slack');
  });

  test('handles scoped package without opentabs-plugin prefix', () => {
    expect(extractShortName('@org/my-tool')).toBe('my-tool');
  });

  test('handles empty string', () => {
    expect(extractShortName('')).toBe('');
  });

  test('handles deeply nested scope', () => {
    expect(extractShortName('@a/b/opentabs-plugin-x')).toBe('x');
  });

  test('only strips the opentabs-plugin- prefix, not other prefixes', () => {
    expect(extractShortName('my-plugin-slack')).toBe('my-plugin-slack');
  });
});

// --- sendConfirmationResponse ---

describe('sendConfirmationResponse', () => {
  test('sends sp:confirmationResponse with allow decision', () => {
    sendConfirmationResponse('conf-123', 'allow');

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]?.message).toEqual({
      type: 'sp:confirmationResponse',
      data: { id: 'conf-123', decision: 'allow' },
    });
  });

  test('includes alwaysAllow in data when true', () => {
    sendConfirmationResponse('conf-456', 'allow', true);

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]?.message).toEqual({
      type: 'sp:confirmationResponse',
      data: { id: 'conf-456', decision: 'allow', alwaysAllow: true },
    });
  });

  test('omits alwaysAllow from data when not provided', () => {
    sendConfirmationResponse('conf-789', 'deny');

    const message = sendMessageCalls[0]?.message as Record<string, unknown>;
    const data = message.data as Record<string, unknown>;
    expect(Object.hasOwn(data, 'alwaysAllow')).toBe(false);
  });

  test('handles chrome.runtime.sendMessage rejection gracefully', () => {
    // Override sendMessage to return a rejected promise
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        get lastError() {
          return mockLastError;
        },
        sendMessage: (message: unknown, callback?: (response: unknown) => void) => {
          sendMessageCalls.push({ message });
          if (callback) {
            callback(mockResponse);
          }
          return Promise.reject(new Error('Extension context invalidated'));
        },
      },
    };

    // Should not throw — the rejection is caught internally
    expect(() => sendConfirmationResponse('conf-fail', 'deny')).not.toThrow();
    expect(sendMessageCalls).toHaveLength(1);
  });
});
