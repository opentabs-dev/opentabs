import { beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — set up before importing handler modules
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

// Stub chrome APIs (debugger/tabs stubs required for network-capture module-level listeners)
const mockExecuteScript = vi.fn<(opts: unknown) => Promise<unknown[]>>().mockResolvedValue([]);
const mockDebuggerAttach = vi.fn().mockResolvedValue(undefined);
const mockDebuggerDetach = vi.fn().mockResolvedValue(undefined);
const mockDebuggerSendCommand = vi.fn().mockResolvedValue(undefined);
Object.assign(globalThis, {
  chrome: {
    ...((globalThis as Record<string, unknown>).chrome as object),
    runtime: { id: 'test-extension-id' },
    scripting: { executeScript: mockExecuteScript },
    debugger: {
      attach: mockDebuggerAttach,
      detach: mockDebuggerDetach,
      sendCommand: mockDebuggerSendCommand,
      onEvent: { addListener: vi.fn() },
      onDetach: { addListener: vi.fn() },
    },
    tabs: {
      ...((globalThis as Record<string, unknown>).chrome as { tabs?: object } | undefined)?.tabs,
      onRemoved: { addListener: vi.fn() },
    },
  },
});

// Import after mocking
const { handleBrowserPressKey, SHIFTED_PUNCTUATION_CODES, UNSHIFTED_PUNCTUATION_CODES } = await import(
  './key-press-command.js'
);

/** Extract the first argument from the first call to mockSendToServer */
const firstSentMessage = (): Record<string, unknown> => {
  const calls = mockSendToServer.mock.calls;
  expect(calls.length).toBeGreaterThanOrEqual(1);
  const firstCall = calls[0];
  if (!firstCall) throw new Error('Expected at least one call');
  return firstCall[0] as Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// handleBrowserPressKey
// ---------------------------------------------------------------------------

describe('handleBrowserPressKey', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockExecuteScript.mockReset();
    mockDebuggerAttach.mockReset().mockResolvedValue(undefined);
    mockDebuggerDetach.mockReset().mockResolvedValue(undefined);
    mockDebuggerSendCommand.mockReset().mockResolvedValue(undefined);
  });

  test('rejects missing tabId', async () => {
    await handleBrowserPressKey({ key: 'Enter' }, 'req-1');
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      error: { code: -32602, message: 'Missing or invalid tabId parameter' },
    });
  });

  test('rejects non-number tabId', async () => {
    await handleBrowserPressKey({ tabId: 'abc', key: 'Enter' }, 'req-2');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects missing key', async () => {
    await handleBrowserPressKey({ tabId: 1 }, 'req-3');
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-3',
      error: { code: -32602, message: 'Missing or invalid key parameter' },
    });
  });

  test('rejects empty key', async () => {
    await handleBrowserPressKey({ tabId: 1, key: '' }, 'req-4');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects non-string key', async () => {
    await handleBrowserPressKey({ tabId: 1, key: 42 }, 'req-5');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('works with numeric id', async () => {
    await handleBrowserPressKey({ key: 'Enter' }, 99);
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 99,
      error: { code: -32602 },
    });
  });
});

// ---------------------------------------------------------------------------
// CDP dispatch
// ---------------------------------------------------------------------------

describe('handleBrowserPressKey — CDP dispatch', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockExecuteScript.mockReset();
    mockDebuggerAttach.mockReset().mockResolvedValue(undefined);
    mockDebuggerDetach.mockReset().mockResolvedValue(undefined);
    mockDebuggerSendCommand.mockReset().mockResolvedValue(undefined);
  });

  test('dispatches CDP key events for a named key', async () => {
    // No selector → activeElement query returns body
    mockExecuteScript.mockResolvedValueOnce([{ result: { tagName: 'body' } }]);
    await handleBrowserPressKey({ tabId: 42, key: 'Enter' }, 'req-cdp-1');

    expect(mockDebuggerAttach).toHaveBeenCalledWith({ tabId: 42 }, '1.3');

    // Named key: rawKeyDown + keyUp (2 calls, no char)
    expect(mockDebuggerSendCommand).toHaveBeenCalledTimes(2);

    const firstCall = mockDebuggerSendCommand.mock.calls[0];
    expect(firstCall?.[1]).toBe('Input.dispatchKeyEvent');
    expect(firstCall?.[2]).toMatchObject({ type: 'rawKeyDown', key: 'Enter' });

    const secondCall = mockDebuggerSendCommand.mock.calls[1];
    expect(secondCall?.[1]).toBe('Input.dispatchKeyEvent');
    expect(secondCall?.[2]).toMatchObject({ type: 'keyUp', key: 'Enter' });

    expect(mockDebuggerDetach).toHaveBeenCalledWith({ tabId: 42 });

    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-cdp-1',
      result: { pressed: true, key: 'Enter' },
    });
  });

  test('dispatches CDP key events for a printable character', async () => {
    // No selector → activeElement query returns input
    mockExecuteScript.mockResolvedValueOnce([{ result: { tagName: 'input', id: 'search' } }]);
    await handleBrowserPressKey({ tabId: 42, key: 'a' }, 'req-cdp-2');

    // Printable char: keyDown + char + keyUp (3 calls)
    expect(mockDebuggerSendCommand).toHaveBeenCalledTimes(3);

    const keyDown = mockDebuggerSendCommand.mock.calls[0];
    expect(keyDown?.[2]).toMatchObject({ type: 'keyDown', text: 'a' });

    const char = mockDebuggerSendCommand.mock.calls[1];
    expect(char?.[2]).toMatchObject({ type: 'char', text: 'a' });

    const keyUp = mockDebuggerSendCommand.mock.calls[2];
    expect(keyUp?.[2]).toMatchObject({ type: 'keyUp' });

    expect(firstSentMessage()).toMatchObject({
      result: { pressed: true, key: 'a', target: { tagName: 'input', id: 'search' } },
    });
  });

  test('focuses selector element before dispatching CDP events', async () => {
    // Selector focus returns element info
    mockExecuteScript.mockResolvedValueOnce([{ result: { tagName: 'input', id: 'name-field' } }]);
    await handleBrowserPressKey({ tabId: 42, key: 'x', selector: '#name-field' }, 'req-cdp-3');

    // executeScript called once for focus (not for activeElement since selector was provided)
    expect(mockExecuteScript).toHaveBeenCalledTimes(1);

    // CDP events still dispatched
    expect(mockDebuggerSendCommand).toHaveBeenCalled();

    expect(firstSentMessage()).toMatchObject({
      result: { pressed: true, key: 'x', target: { tagName: 'input', id: 'name-field' } },
    });
  });

  test('passes modifier flags to CDP events', async () => {
    mockExecuteScript.mockResolvedValueOnce([{ result: { tagName: 'body' } }]);
    await handleBrowserPressKey({ tabId: 42, key: 'b', modifiers: { meta: true } }, 'req-cdp-4');

    // Meta bitmask = 4
    const firstCall = mockDebuggerSendCommand.mock.calls[0];
    expect(firstCall?.[2]).toMatchObject({ modifiers: 4 });

    expect(firstSentMessage()).toMatchObject({
      result: { pressed: true, key: 'b' },
    });
  });
});

// ---------------------------------------------------------------------------
// Punctuation code maps
// ---------------------------------------------------------------------------

describe('SHIFTED_PUNCTUATION_CODES', () => {
  test('maps digit-row shifted characters to their physical key codes', () => {
    expect(SHIFTED_PUNCTUATION_CODES['!']).toBe('Digit1');
    expect(SHIFTED_PUNCTUATION_CODES['@']).toBe('Digit2');
    expect(SHIFTED_PUNCTUATION_CODES['#']).toBe('Digit3');
    expect(SHIFTED_PUNCTUATION_CODES.$).toBe('Digit4');
    expect(SHIFTED_PUNCTUATION_CODES['%']).toBe('Digit5');
    expect(SHIFTED_PUNCTUATION_CODES['^']).toBe('Digit6');
    expect(SHIFTED_PUNCTUATION_CODES['&']).toBe('Digit7');
    expect(SHIFTED_PUNCTUATION_CODES['*']).toBe('Digit8');
    expect(SHIFTED_PUNCTUATION_CODES['(']).toBe('Digit9');
    expect(SHIFTED_PUNCTUATION_CODES[')']).toBe('Digit0');
  });

  test('maps shifted symbol keys to their physical key codes', () => {
    expect(SHIFTED_PUNCTUATION_CODES._).toBe('Minus');
    expect(SHIFTED_PUNCTUATION_CODES['+']).toBe('Equal');
    expect(SHIFTED_PUNCTUATION_CODES['{']).toBe('BracketLeft');
    expect(SHIFTED_PUNCTUATION_CODES['}']).toBe('BracketRight');
    expect(SHIFTED_PUNCTUATION_CODES['|']).toBe('Backslash');
    expect(SHIFTED_PUNCTUATION_CODES[':']).toBe('Semicolon');
    expect(SHIFTED_PUNCTUATION_CODES['"']).toBe('Quote');
    expect(SHIFTED_PUNCTUATION_CODES['<']).toBe('Comma');
    expect(SHIFTED_PUNCTUATION_CODES['>']).toBe('Period');
    expect(SHIFTED_PUNCTUATION_CODES['?']).toBe('Slash');
    expect(SHIFTED_PUNCTUATION_CODES['~']).toBe('Backquote');
  });
});

describe('UNSHIFTED_PUNCTUATION_CODES', () => {
  test('maps unshifted punctuation characters to their physical key codes', () => {
    expect(UNSHIFTED_PUNCTUATION_CODES['-']).toBe('Minus');
    expect(UNSHIFTED_PUNCTUATION_CODES['=']).toBe('Equal');
    expect(UNSHIFTED_PUNCTUATION_CODES['[']).toBe('BracketLeft');
    expect(UNSHIFTED_PUNCTUATION_CODES[']']).toBe('BracketRight');
    expect(UNSHIFTED_PUNCTUATION_CODES['\\']).toBe('Backslash');
    expect(UNSHIFTED_PUNCTUATION_CODES[';']).toBe('Semicolon');
    expect(UNSHIFTED_PUNCTUATION_CODES["'"]).toBe('Quote');
    expect(UNSHIFTED_PUNCTUATION_CODES[',']).toBe('Comma');
    expect(UNSHIFTED_PUNCTUATION_CODES['.']).toBe('Period');
    expect(UNSHIFTED_PUNCTUATION_CODES['/']).toBe('Slash');
    expect(UNSHIFTED_PUNCTUATION_CODES['`']).toBe('Backquote');
  });
});
