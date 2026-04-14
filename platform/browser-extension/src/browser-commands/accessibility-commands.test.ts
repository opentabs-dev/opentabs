import { beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const { mockSendToServer } = vi.hoisted(() => ({
  mockSendToServer: vi.fn<(data: unknown) => void>(),
}));

vi.mock('../messaging.js', () => ({
  sendToServer: mockSendToServer,
  forwardToSidePanel: vi.fn(),
}));

vi.mock('../sanitize-error.js', () => ({
  sanitizeErrorMessage: (msg: string) => msg,
}));

vi.mock('../network-capture.js', () => ({
  isCapturing: () => false,
}));

// Chrome API stubs
const mockSendCommand = vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>();
const mockAttach = vi.fn<(target: unknown, version: string) => Promise<void>>().mockResolvedValue(undefined);
const mockDetach = vi.fn<(target: unknown) => Promise<void>>().mockResolvedValue(undefined);

Object.assign(globalThis, {
  chrome: {
    ...((globalThis as Record<string, unknown>).chrome as object),
    debugger: {
      attach: mockAttach,
      detach: mockDetach,
      sendCommand: mockSendCommand,
      onEvent: { addListener: vi.fn() },
    },
  },
});

const { handleBrowserGetAccessibilityTree } = await import('./accessibility-commands.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeNode = (
  nodeId: string,
  role: string,
  name: string,
  opts?: { childIds?: string[]; properties?: Array<{ name: string; value: { type: string; value: unknown } }> },
) => ({
  nodeId,
  role: { value: role },
  name: { value: name },
  childIds: opts?.childIds ?? [],
  properties: opts?.properties ?? [],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleBrowserGetAccessibilityTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendCommand.mockReset();
    mockSendCommand.mockResolvedValue(undefined);
  });

  test('returns accessibility nodes for a tab', async () => {
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            makeNode('1', 'RootWebArea', 'Test Page', { childIds: ['2', '3'] }),
            makeNode('2', 'heading', 'Main Heading'),
            makeNode('3', 'button', 'Click Me'),
          ],
        };
      }
      return undefined;
    });

    await handleBrowserGetAccessibilityTree({ tabId: 42 }, 1);

    expect(mockSendCommand).toHaveBeenCalledWith({ tabId: 42 }, 'Accessibility.enable');
    expect(mockSendCommand).toHaveBeenCalledWith({ tabId: 42 }, 'Accessibility.getFullAXTree');

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
    });
    const result = response.result as { nodes: unknown[]; totalNodes: number; truncated: boolean };
    expect(result.nodes).toHaveLength(3);
    expect(result.totalNodes).toBe(3);
    expect(result.truncated).toBe(false);
  });

  test('filters out ignored roles when interestingOnly is true (default)', async () => {
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            makeNode('1', 'RootWebArea', 'Page'),
            makeNode('2', 'none', ''),
            makeNode('3', 'ignored', ''),
            makeNode('4', 'GenericContainer', ''),
            makeNode('5', 'button', 'OK'),
          ],
        };
      }
      return undefined;
    });

    await handleBrowserGetAccessibilityTree({ tabId: 42 }, 2);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const result = response.result as { nodes: Array<{ role: string }> };
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map(n => n.role)).toEqual(['RootWebArea', 'button']);
  });

  test('includes all nodes when interestingOnly is false', async () => {
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [makeNode('1', 'RootWebArea', 'Page'), makeNode('2', 'none', ''), makeNode('3', 'button', 'OK')],
        };
      }
      return undefined;
    });

    await handleBrowserGetAccessibilityTree({ tabId: 42, interestingOnly: false }, 3);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const result = response.result as { nodes: unknown[] };
    expect(result.nodes).toHaveLength(3);
  });

  test('truncates large trees to 2000 nodes', async () => {
    const nodes = Array.from({ length: 2500 }, (_, i) => makeNode(String(i + 1), 'paragraph', `Node ${i + 1}`));
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Accessibility.getFullAXTree') {
        return { nodes };
      }
      return undefined;
    });

    await handleBrowserGetAccessibilityTree({ tabId: 42 }, 4);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const result = response.result as { nodes: unknown[]; totalNodes: number; truncated: boolean };
    expect(result.nodes).toHaveLength(2000);
    expect(result.totalNodes).toBe(2500);
    expect(result.truncated).toBe(true);
  });

  test('extracts states from node properties', async () => {
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            makeNode('1', 'checkbox', 'Accept Terms', {
              properties: [
                { name: 'checked', value: { type: 'boolean', value: true } },
                { name: 'focused', value: { type: 'boolean', value: true } },
                { name: 'disabled', value: { type: 'boolean', value: false } },
              ],
            }),
          ],
        };
      }
      return undefined;
    });

    await handleBrowserGetAccessibilityTree({ tabId: 42 }, 5);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const result = response.result as { nodes: Array<{ states: string[] }> };
    expect(result.nodes[0]?.states).toEqual(['checked', 'focused']);
  });

  test('sends error for missing tabId', async () => {
    await handleBrowserGetAccessibilityTree({}, 6);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('tabId') }),
      id: 6,
    });
  });

  test('sends error when debugger attach fails', async () => {
    mockAttach.mockRejectedValueOnce(new Error('Cannot attach'));

    await handleBrowserGetAccessibilityTree({ tabId: 42 }, 7);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('attach debugger') }),
      id: 7,
    });
  });

  test('always disables Accessibility domain in finally block', async () => {
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Accessibility.getFullAXTree') {
        throw new Error('CDP error');
      }
      return undefined;
    });

    await handleBrowserGetAccessibilityTree({ tabId: 42 }, 8);

    expect(mockSendCommand).toHaveBeenCalledWith({ tabId: 42 }, 'Accessibility.disable');
  });
});
