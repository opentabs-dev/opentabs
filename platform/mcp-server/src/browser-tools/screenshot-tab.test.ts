import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WsHandle } from '@opentabs-dev/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ExtensionConnection, ServerState } from '../state.js';
import { createState } from '../state.js';
import { screenshotTab } from './screenshot-tab.js';

const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const createMockWs = (): WsHandle & { sent: string[] } => ({
  sent: [] as string[],
  send(msg: string) {
    this.sent.push(msg);
  },
  close() {},
});

const installExtensionConnection = (state: ServerState, id = 'conn-test'): WsHandle & { sent: string[] } => {
  const ws = createMockWs();
  const conn: ExtensionConnection = {
    ws,
    connectionId: id,
    profileLabel: id,
    tabMapping: new Map(),
    activeNetworkCaptures: new Set(),
  };
  state.extensionConnections.set(id, conn);
  return ws;
};

const settleDispatchWith = (state: ServerState, response: unknown): void => {
  for (const [, pending] of state.pendingDispatches) {
    pending.resolve(response);
    clearTimeout(pending.timerId);
  }
};

describe('browser_screenshot_tab handler', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'screenshot-tab-test-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test('without filePath returns the dispatch result unchanged', async () => {
    const state = createState();
    installExtensionConnection(state);

    const promise = screenshotTab.handler({ tabId: 1 }, state);
    settleDispatchWith(state, { image: SAMPLE_PNG_BASE64 });

    expect(await promise).toEqual({ image: SAMPLE_PNG_BASE64 });
  });

  test('with absolute filePath writes valid PNG bytes to disk and returns {savedTo, bytes}', async () => {
    const state = createState();
    installExtensionConnection(state);
    const filePath = join(workDir, 'shot.png');

    const promise = screenshotTab.handler({ tabId: 1, filePath }, state);
    settleDispatchWith(state, { image: SAMPLE_PNG_BASE64 });
    const result = (await promise) as { savedTo: string; bytes: number };

    const decoded = Buffer.from(SAMPLE_PNG_BASE64, 'base64');
    expect(result).toEqual({ savedTo: filePath, bytes: decoded.byteLength });

    const onDisk = readFileSync(filePath);
    expect(onDisk.equals(decoded)).toBe(true);
    expect(onDisk.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  test('with relative filePath rejects without dispatching to disk', async () => {
    const state = createState();
    installExtensionConnection(state);

    const promise = screenshotTab.handler({ tabId: 1, filePath: 'relative/shot.png' }, state);
    settleDispatchWith(state, { image: SAMPLE_PNG_BASE64 });

    await expect(promise).rejects.toThrow(/filePath must be an absolute path/);
  });

  test('with filePath but malformed extension payload throws without writing', async () => {
    const state = createState();
    installExtensionConnection(state);
    const filePath = join(workDir, 'should-not-exist.png');

    const promise = screenshotTab.handler({ tabId: 1, filePath }, state);
    settleDispatchWith(state, { unexpected: 'shape' });

    await expect(promise).rejects.toThrow(/extension returned unexpected payload/);
    expect(() => readFileSync(filePath)).toThrow(/ENOENT/);
  });
});
