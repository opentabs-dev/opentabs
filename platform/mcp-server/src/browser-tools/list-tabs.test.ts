import type { WsHandle } from '@opentabs-dev/shared';
import { describe, expect, test } from 'vitest';
import type { ExtensionConnection } from '../state.js';
import { createState } from '../state.js';
import { listTabs } from './list-tabs.js';

/** Create a mock WsHandle that records sent messages */
const createMockWs = (): WsHandle & { sent: string[] } => ({
  sent: [] as string[],
  send(msg: string) {
    this.sent.push(msg);
  },
  close() {},
});

const createMockConnection = (id: string): { conn: ExtensionConnection; ws: WsHandle & { sent: string[] } } => {
  const ws = createMockWs();
  const conn: ExtensionConnection = {
    ws,
    connectionId: id,
    profileLabel: id,
    tabMapping: new Map(),
    activeNetworkCaptures: new Set(),
  };
  return { conn, ws };
};

/** Settle all pending dispatches on a state by sending fake responses */
const settleDispatches = (state: ReturnType<typeof createState>, responses: Map<string, unknown>): void => {
  for (const [, pending] of state.pendingDispatches) {
    const connId = pending.connectionId;
    if (connId && responses.has(connId)) {
      pending.resolve(responses.get(connId));
    }
    clearTimeout(pending.timerId);
  }
};

describe('browser_list_tabs handler', () => {
  test('merges tabs from multiple connections with connectionId', async () => {
    const state = createState();
    const { conn: connA, ws: wsA } = createMockConnection('conn-a');
    const { conn: connB, ws: wsB } = createMockConnection('conn-b');
    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = listTabs.handler({}, state);

    // Both connections receive dispatch
    expect(wsA.sent).toHaveLength(1);
    expect(wsB.sent).toHaveLength(1);

    // Settle with tab data
    settleDispatches(
      state,
      new Map([
        ['conn-a', [{ id: 1, title: 'Gmail', url: 'https://mail.google.com', active: true }]],
        ['conn-b', [{ id: 2, title: 'Slack', url: 'https://app.slack.com', active: false }]],
      ]),
    );

    const result = (await promise) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, title: 'Gmail', connectionId: 'conn-a' }),
        expect.objectContaining({ id: 2, title: 'Slack', connectionId: 'conn-b' }),
      ]),
    );
  });

  test('single connection returns tabs with connectionId', async () => {
    const state = createState();
    const { conn, ws } = createMockConnection('only-conn');
    state.extensionConnections.set('only-conn', conn);

    const promise = listTabs.handler({}, state);

    expect(ws.sent).toHaveLength(1);

    settleDispatches(
      state,
      new Map([['only-conn', [{ id: 5, title: 'Tab', url: 'https://example.com', active: true }]]]),
    );

    const result = (await promise) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 5,
        title: 'Tab',
        connectionId: 'only-conn',
      }),
    );
  });

  test('no connections throws "Extension not connected"', async () => {
    const state = createState();

    await expect(listTabs.handler({}, state)).rejects.toThrow('Extension not connected');
  });

  test('handles connection returning non-array result gracefully', async () => {
    const state = createState();
    const { conn } = createMockConnection('conn-a');
    state.extensionConnections.set('conn-a', conn);

    const promise = listTabs.handler({}, state);

    // Return a non-array result
    settleDispatches(state, new Map([['conn-a', 'not-an-array']]));

    const result = (await promise) as Array<Record<string, unknown>>;
    // Non-array results are treated as empty
    expect(result).toHaveLength(0);
  });

  test('tabs from multiple connections are correctly annotated with their connectionId', async () => {
    const state = createState();
    const { conn: connA } = createMockConnection('profile-personal');
    const { conn: connB } = createMockConnection('profile-work');
    state.extensionConnections.set('profile-personal', connA);
    state.extensionConnections.set('profile-work', connB);

    const promise = listTabs.handler({}, state);

    settleDispatches(
      state,
      new Map([
        [
          'profile-personal',
          [
            { id: 1, title: 'YouTube', url: 'https://youtube.com' },
            { id: 2, title: 'Reddit', url: 'https://reddit.com' },
          ],
        ],
        ['profile-work', [{ id: 100, title: 'Jira', url: 'https://jira.example.com' }]],
      ]),
    );

    const result = (await promise) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(3);

    // Verify each tab has the correct connectionId
    const personalTabs = result.filter(t => t.connectionId === 'profile-personal');
    const workTabs = result.filter(t => t.connectionId === 'profile-work');
    expect(personalTabs).toHaveLength(2);
    expect(workTabs).toHaveLength(1);
    expect(workTabs[0]).toEqual(expect.objectContaining({ id: 100, title: 'Jira' }));
  });
});
