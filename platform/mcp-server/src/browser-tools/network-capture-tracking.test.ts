import type { WsHandle } from '@opentabs-dev/shared';
import { describe, expect, test } from 'vitest';
import type { ExtensionConnection, ServerState } from '../state.js';
import { createState } from '../state.js';
import { disableNetworkCapture } from './disable-network-capture.js';
import { enableNetworkCapture } from './enable-network-capture.js';

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

/**
 * Settle the first pending dispatch on the state.
 * Used to simulate the extension responding to enable/disable network capture.
 */
const settleFirstPending = (state: ServerState, result: unknown = 'ok'): void => {
  for (const [, pending] of state.pendingDispatches) {
    pending.resolve(result);
    clearTimeout(pending.timerId);
    return;
  }
};

describe('network capture state tracking', () => {
  test('enable_network_capture tracks capture on the correct connection', async () => {
    const state = createState();
    const connA = createMockConnection('conn-a');
    const connB = createMockConnection('conn-b');

    // Tab 42 belongs to connB
    connB.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 42, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });

    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = enableNetworkCapture.handler({ tabId: 42 }, state);
    settleFirstPending(state);
    await promise;

    // Capture should be tracked on connB (which owns tab 42), not connA
    expect(connB.activeNetworkCaptures.has(42)).toBe(true);
    expect(connA.activeNetworkCaptures.has(42)).toBe(false);
  });

  test('disable_network_capture removes capture from the correct connection', async () => {
    const state = createState();
    const connA = createMockConnection('conn-a');
    const connB = createMockConnection('conn-b');

    // Tab 42 belongs to connB, and it has an active capture
    connB.tabMapping.set('slack', {
      state: 'ready',
      tabs: [{ tabId: 42, url: 'https://app.slack.com', title: 'Slack', ready: true }],
    });
    connB.activeNetworkCaptures.add(42);

    state.extensionConnections.set('conn-a', connA);
    state.extensionConnections.set('conn-b', connB);

    const promise = disableNetworkCapture.handler({ tabId: 42 }, state);
    settleFirstPending(state);
    await promise;

    // Capture should be removed from connB
    expect(connB.activeNetworkCaptures.has(42)).toBe(false);
    expect(connA.activeNetworkCaptures.has(42)).toBe(false);
  });

  test('enable_network_capture falls back to any connection when tab not found in mappings', async () => {
    const state = createState();
    const conn = createMockConnection('conn-a');
    state.extensionConnections.set('conn-a', conn);
    // No tab mappings — tab 99 is unknown

    const promise = enableNetworkCapture.handler({ tabId: 99 }, state);
    settleFirstPending(state);
    await promise;

    // Falls back to getAnyConnection → conn-a
    expect(conn.activeNetworkCaptures.has(99)).toBe(true);
  });

  test('disable_network_capture falls back to any connection when tab not found in mappings', async () => {
    const state = createState();
    const conn = createMockConnection('conn-a');
    conn.activeNetworkCaptures.add(99);
    state.extensionConnections.set('conn-a', conn);
    // No tab mappings

    const promise = disableNetworkCapture.handler({ tabId: 99 }, state);
    settleFirstPending(state);
    await promise;

    expect(conn.activeNetworkCaptures.has(99)).toBe(false);
  });
});
