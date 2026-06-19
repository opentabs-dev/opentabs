/**
 * Unit tests for the in-process MCP client used by E2E fixtures.
 *
 * These exercise the JSON / SSE response parsing in `createMcpClient`
 * without spinning up the real MCP server — `globalThis.fetch` is stubbed
 * per test. Anything more involved (session lifecycle, retry-after-restart,
 * extension dispatch) is covered by the Playwright E2E suites.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMcpClient } from './fixtures.js';

interface MockFetchResponse {
  ok: boolean;
  status?: number;
  headers: Headers;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

const jsonResponse = (body: unknown): MockFetchResponse => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const sseResponse = (lines: string[]): MockFetchResponse => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'text/event-stream' }),
  text: async () => lines.join('\n'),
});

describe('createMcpClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('callTool', () => {
    test('preserves the full contentParts array (text + image) and joins only text into `content`', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              { type: 'text', text: 'narrative ' },
              { type: 'image', data: 'IMG', mimeType: 'image/png' },
            ],
            isError: false,
          },
        }),
      );

      const client = createMcpClient(0);
      const r = await client.callTool('foo');

      expect(r.isError).toBe(false);
      expect(r.content).toBe('narrative ');
      expect(r.contentParts).toHaveLength(2);
      expect(r.contentParts[1]).toEqual({ type: 'image', data: 'IMG', mimeType: 'image/png' });
    });

    test('error response: contentParts is always an array (never undefined)', async () => {
      // The contract this test pins: `contentParts` is the array consumers can
      // safely index into without undefined-handling. The polling logic in the
      // E2E suites relies on it.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: 'dispatch timeout' },
        }),
      );

      const client = createMcpClient(0);
      const r = await client.callTool('foo');

      expect(r.isError).toBe(true);
      expect(r.content).toBe('dispatch timeout');
      expect(Array.isArray(r.contentParts)).toBe(true);
      expect(r.contentParts).toEqual([]);
    });
  });

  describe('callToolWithProgress', () => {
    test('JSON response: joins only text parts into `content` and preserves all parts in `contentParts`', async () => {
      // Mixed-content tool result: text + image + text. The SSE/JSON helper
      // must mirror the contract introduced in `callTool`: `content` is the
      // joined text-only payload; `contentParts` is the raw array.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              { type: 'text', text: 'before ' },
              { type: 'image', data: 'IMG', mimeType: 'image/png' },
              { type: 'text', text: 'after' },
            ],
            isError: false,
          },
        }),
      );

      const client = createMcpClient(0);
      const r = await client.callToolWithProgress('foo');

      expect(r.isError).toBe(false);
      expect(r.content).toBe('before after');
      expect(r.contentParts).toHaveLength(3);
      expect(r.contentParts[1]).toEqual({ type: 'image', data: 'IMG', mimeType: 'image/png' });
      expect(r.progressNotifications).toEqual([]);
    });

    test('SSE response: extracts progress notifications and parses tool result with full contentParts', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"t","progress":1,"total":2,"message":"halfway"}}',
          '',
          'data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"hi"},{"type":"image","data":"IMG","mimeType":"image/png"}],"isError":false}}',
          '',
        ]),
      );

      const client = createMcpClient(0);
      const r = await client.callToolWithProgress('foo');

      expect(r.isError).toBe(false);
      expect(r.content).toBe('hi');
      expect(r.contentParts).toHaveLength(2);
      expect(r.contentParts[1]?.type).toBe('image');
      expect(r.progressNotifications).toEqual([{ progress: 1, total: 2, message: 'halfway' }]);
    });

    test('JSON error response: returns isError with empty contentParts', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: 'dispatch timeout' },
        }),
      );

      const client = createMcpClient(0);
      const r = await client.callToolWithProgress('foo');

      expect(r.isError).toBe(true);
      expect(r.content).toBe('dispatch timeout');
      expect(Array.isArray(r.contentParts)).toBe(true);
      expect(r.contentParts).toEqual([]);
    });
  });
});
