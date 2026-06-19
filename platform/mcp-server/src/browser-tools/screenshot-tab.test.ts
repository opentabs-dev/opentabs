import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const { mockDispatchToExtension } = vi.hoisted(() => ({
  mockDispatchToExtension:
    vi.fn<(state: unknown, method: string, params: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('../extension-protocol.js', () => ({
  dispatchToExtension: mockDispatchToExtension,
}));

const { screenshotTab } = await import('./screenshot-tab.js');
const { createState } = await import('../state.js');

describe('screenshotTab.formatResult', () => {
  test('emits a single MCP image content part with mimeType image/png', () => {
    expect(screenshotTab.formatResult).toBeDefined();
    const formatted = screenshotTab.formatResult?.({ image: 'iVBORw0KGgoAAAANSUhEUg==' });
    expect(formatted).toEqual([{ type: 'image', data: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' }]);
  });

  test('renders a {savedTo, bytes} summary as a text part', () => {
    const formatted = screenshotTab.formatResult?.({ savedTo: '/tmp/shot.png', bytes: 1234 });
    expect(formatted).toHaveLength(1);
    const part = formatted?.[0];
    expect(part?.type).toBe('text');
    const text = part?.type === 'text' ? part.text : '';
    expect(text).toContain('/tmp/shot.png');
    expect(text).toContain('1234');
  });

  test('throws a metadata-only error when the payload is not {image: string}', () => {
    // Contract: the error describes the malformed payload by type and keys,
    // never by serialising the payload itself — screenshots can carry PII
    // (tokens, DOM content) if something has gone very wrong upstream.
    expect(() => screenshotTab.formatResult?.({ image: 12345, secret: 'leakme' })).toThrow(
      /browser_screenshot_tab: extension returned unexpected payload/,
    );
    expect(() => screenshotTab.formatResult?.({ image: 12345, secret: 'leakme' })).toThrow(
      /type=object.*keys=\[image,secret\]/,
    );
    expect(() => screenshotTab.formatResult?.({ image: 12345, secret: 'leakme' })).not.toThrow(/leakme/);
  });

  test('rejects an empty-string image payload as a malformed capture', () => {
    // An empty `image` field would otherwise pass the `typeof === 'string'` check
    // and emit a zero-byte image content part — handing clients a "successful"
    // response that decodes to nothing. Fail fast instead.
    expect(() => screenshotTab.formatResult?.({ image: '' })).toThrow(
      /browser_screenshot_tab: extension returned unexpected payload \(expected \{image: non-empty string\}/,
    );
  });
});

describe('screenshotTab.handler — filePath', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'opentabs-screenshot-test-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    mockDispatchToExtension.mockReset();
  });

  // A 1x1 transparent PNG.
  const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  test('without filePath the handler returns the raw {image} payload for formatResult', async () => {
    mockDispatchToExtension.mockResolvedValue({ image: PNG_BASE64 });
    const result = await screenshotTab.handler({ tabId: 1 }, createState());
    expect(result).toEqual({ image: PNG_BASE64 });
  });

  test('with filePath the PNG is written to disk and a {savedTo, bytes} summary returned', async () => {
    mockDispatchToExtension.mockResolvedValue({ image: PNG_BASE64 });
    const path = join(dir, 'capture.png');
    const result = (await screenshotTab.handler({ tabId: 1, filePath: path }, createState())) as {
      savedTo: string;
      bytes: number;
    };
    expect(result.savedTo).toBe(path);
    const onDisk = await readFile(path);
    expect(result.bytes).toBe(onDisk.byteLength);
    // Verify the bytes are the decoded PNG (magic header).
    expect(onDisk.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  test('rejects a non-absolute filePath', async () => {
    mockDispatchToExtension.mockResolvedValue({ image: PNG_BASE64 });
    await expect(screenshotTab.handler({ tabId: 1, filePath: 'relative.png' }, createState())).rejects.toThrow(
      /filePath must be an absolute path/,
    );
  });
});
