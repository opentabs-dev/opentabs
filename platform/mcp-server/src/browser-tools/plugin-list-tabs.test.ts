import type { WsHandle } from '@opentabs-dev/shared';
import { describe, expect, test } from 'vitest';
import { buildRegistry } from '../registry.js';
import type { ExtensionConnection, RegisteredPlugin } from '../state.js';
import { createState } from '../state.js';
import { pluginListTabs } from './plugin-list-tabs.js';

const createMockWs = (): WsHandle & { sent: string[] } => ({
  sent: [] as string[],
  send(msg: string) {
    this.sent.push(msg);
  },
  close() {},
});

const createMockConnection = (id: string): ExtensionConnection => ({
  ws: createMockWs(),
  connectionId: id,
  profileLabel: id,
  tabMapping: new Map(),
  activeNetworkCaptures: new Set(),
});

const makePlugin = (name: string, displayName?: string): RegisteredPlugin => ({
  name,
  version: '1.0.0',
  displayName: displayName ?? name,
  urlPatterns: [],
  excludePatterns: [],
  source: 'local' as const,
  iife: '// noop',
  tools: [],
});

describe('plugin_list_tabs connectionId annotations', () => {
  test('tabs include connectionId from their source connection', async () => {
    const state = createState();
    const connA = createMockConnection('conn-a');
    const connB = createMockConnection('conn-b');
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    state.registry = buildRegistry([makePlugin('slack', 'Slack')], []);

    connA.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 10, url: 'https://app.slack.com/workspace-a', title: 'Slack A', ready: true }],
    });
    connB.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 20, url: 'https://app.slack.com/workspace-b', title: 'Slack B', ready: true }],
    });

    const result = (await pluginListTabs.handler({ plugin: 'slack' }, state)) as Array<{
      plugin: string;
      tabs: Array<{ tabId: number; connectionId: string }>;
    }>;

    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry).toBeDefined();
    expect(entry?.tabs).toHaveLength(2);

    const tabA = entry?.tabs.find(t => t.tabId === 10);
    const tabB = entry?.tabs.find(t => t.tabId === 20);
    expect(tabA?.connectionId).toBe('conn-a');
    expect(tabB?.connectionId).toBe('conn-b');
  });

  test('all plugins include connectionId when no plugin filter', async () => {
    const state = createState();
    const connA = createMockConnection('conn-a');
    state.extensionConnections.set('conn-a', connA);

    state.registry = buildRegistry([makePlugin('slack', 'Slack'), makePlugin('github', 'GitHub')], []);

    connA.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 10, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    connA.tabMapping.set('github', {
      state: 'unavailable',
      tabs: [{ tabId: 20, url: 'https://github.com', title: 'GitHub', ready: false }],
    });

    const result = (await pluginListTabs.handler({}, state)) as Array<{
      plugin: string;
      tabs: Array<{ tabId: number; connectionId: string }>;
    }>;

    expect(result).toHaveLength(2);

    for (const entry of result) {
      for (const tab of entry.tabs) {
        expect(tab.connectionId).toBe('conn-a');
      }
    }
  });

  test('plugin with no matching tabs returns empty tabs array', async () => {
    const state = createState();
    const conn = createMockConnection('conn-a');
    state.extensionConnections.set('conn-a', conn);
    state.registry = buildRegistry([makePlugin('slack', 'Slack')], []);

    const result = (await pluginListTabs.handler({ plugin: 'slack' }, state)) as Array<{
      plugin: string;
      state: string;
      tabs: unknown[];
    }>;

    expect(result).toHaveLength(1);
    expect(result[0]?.state).toBe('closed');
    expect(result[0]?.tabs).toEqual([]);
  });

  test('unknown plugin returns error', async () => {
    const state = createState();
    state.registry = buildRegistry([], []);

    const result = (await pluginListTabs.handler({ plugin: 'nonexistent' }, state)) as { error: string };
    expect(result.error).toContain('not found');
  });

  test('tabs from multiple connections for the same plugin are merged', async () => {
    const state = createState();
    const connA = createMockConnection('profile-1');
    const connB = createMockConnection('profile-2');
    const connC = createMockConnection('profile-3');
    state.extensionConnections.set('profile-1', connA);
    state.extensionConnections.set('profile-2', connB);
    state.extensionConnections.set('profile-3', connC);

    state.registry = buildRegistry([makePlugin('slack', 'Slack')], []);

    connA.tabMapping.set('slack', {
      state: 'unavailable',
      tabs: [{ tabId: 1, url: 'https://app.slack.com/1', title: 'Slack 1', ready: false }],
    });
    connB.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 2, url: 'https://app.slack.com/2', title: 'Slack 2', ready: true }],
    });
    // connC has no slack tabs

    const result = (await pluginListTabs.handler({ plugin: 'slack' }, state)) as Array<{
      plugin: string;
      state: string;
      tabs: Array<{ tabId: number; connectionId: string }>;
    }>;

    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry?.tabs).toHaveLength(2);
    // Best state is 'ready' (from profile-2)
    expect(entry?.state).toBe('ready');
    expect(entry?.tabs.find(t => t.tabId === 1)?.connectionId).toBe('profile-1');
    expect(entry?.tabs.find(t => t.tabId === 2)?.connectionId).toBe('profile-2');
  });
});
