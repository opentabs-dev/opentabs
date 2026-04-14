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
const mockAddListener = vi.fn();
const mockRemoveListener = vi.fn();

Object.assign(globalThis, {
  chrome: {
    ...((globalThis as Record<string, unknown>).chrome as object),
    debugger: {
      attach: mockAttach,
      detach: mockDetach,
      sendCommand: mockSendCommand,
      onEvent: { addListener: mockAddListener, removeListener: mockRemoveListener },
    },
  },
});

const { handleBrowserAuditPage } = await import('./audit-commands.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fireIssue = (tabId: number, code: string, details: Record<string, unknown> = {}) => {
  const listener = mockAddListener.mock.calls[0]?.[0] as
    | ((source: { tabId: number }, method: string, params?: Record<string, unknown>) => void)
    | undefined;
  if (listener) {
    listener({ tabId }, 'Audits.issueAdded', { issue: { code, details } });
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleBrowserAuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendCommand.mockReset();
    mockSendCommand.mockResolvedValue(undefined);
  });

  test('returns grouped issues after collection period', async () => {
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Audits.enable') {
        fireIssue(42, 'MixedContentIssue', { mixedContentIssue: { severity: 'Warning' } });
        fireIssue(42, 'CookieIssue', { cookieIssue: { severity: 'Info' } });
      }
      return undefined;
    });

    await handleBrowserAuditPage({ tabId: 42, waitSeconds: 1 }, 1);

    expect(mockSendCommand).toHaveBeenCalledWith({ tabId: 42 }, 'Audits.enable');
    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 1 });
    const result = response.result as {
      issues: Record<string, unknown[]>;
      summary: Record<string, number>;
      totalIssues: number;
      truncated: boolean;
    };
    expect(result.issues.mixedContent).toHaveLength(1);
    expect(result.issues.cookies).toHaveLength(1);
    expect(result.summary.mixedContent).toBe(1);
    expect(result.summary.cookies).toBe(1);
    expect(result.totalIssues).toBe(2);
    expect(result.truncated).toBe(false);
  });

  test('returns empty categories when no issues found', async () => {
    await handleBrowserAuditPage({ tabId: 42, waitSeconds: 1 }, 2);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const result = response.result as {
      issues: Record<string, unknown[]>;
      summary: Record<string, number>;
    };
    expect(result.issues.mixedContent).toHaveLength(0);
    expect(result.issues.cors).toHaveLength(0);
    expect(result.issues.csp).toHaveLength(0);
    expect(result.issues.cookies).toHaveLength(0);
    expect(result.issues.deprecations).toHaveLength(0);
    expect(result.issues.generic).toHaveLength(0);
    expect(result.summary.mixedContent).toBe(0);
  });

  test('categorizes issues correctly', async () => {
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Audits.enable') {
        fireIssue(42, 'CorsIssue', {});
        fireIssue(42, 'ContentSecurityPolicyIssue', {});
        fireIssue(42, 'DeprecationIssue', {});
        fireIssue(42, 'GenericIssue', {});
      }
      return undefined;
    });

    await handleBrowserAuditPage({ tabId: 42, waitSeconds: 1 }, 3);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const result = response.result as { issues: Record<string, unknown[]> };
    expect(result.issues.cors).toHaveLength(1);
    expect(result.issues.csp).toHaveLength(1);
    expect(result.issues.deprecations).toHaveLength(1);
    expect(result.issues.generic).toHaveLength(1);
  });

  test('extracts severity from issue details', async () => {
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Audits.enable') {
        fireIssue(42, 'MixedContentIssue', {
          mixedContentIssue: { severity: 'Error', url: 'http://example.com/resource' },
        });
      }
      return undefined;
    });

    await handleBrowserAuditPage({ tabId: 42, waitSeconds: 1 }, 4);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const result = response.result as { issues: { mixedContent: Array<{ severity: string }> } };
    expect(result.issues.mixedContent[0]?.severity).toBe('Error');
  });

  test('extracts source location from issue details', async () => {
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Audits.enable') {
        fireIssue(42, 'DeprecationIssue', {
          deprecationIssue: { sourceFile: '/app.js', lineNumber: 42 },
        });
      }
      return undefined;
    });

    await handleBrowserAuditPage({ tabId: 42, waitSeconds: 1 }, 5);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const result = response.result as {
      issues: { deprecations: Array<{ sourceFile: string | null; lineNumber: number | null }> };
    };
    expect(result.issues.deprecations[0]?.sourceFile).toBe('/app.js');
    expect(result.issues.deprecations[0]?.lineNumber).toBe(42);
  });

  test('truncates to 100 issues max', async () => {
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Audits.enable') {
        for (let i = 0; i < 120; i++) {
          fireIssue(42, 'GenericIssue', {});
        }
      }
      return undefined;
    });

    await handleBrowserAuditPage({ tabId: 42, waitSeconds: 1 }, 6);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const result = response.result as { totalIssues: number; truncated: boolean; issues: Record<string, unknown[]> };
    expect(result.totalIssues).toBe(120);
    expect(result.truncated).toBe(true);
    expect(result.issues.generic).toHaveLength(100);
  });

  test('sends error for missing tabId', async () => {
    await handleBrowserAuditPage({}, 7);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('tabId') }),
      id: 7,
    });
  });

  test('sends error when debugger attach fails', async () => {
    mockAttach.mockRejectedValueOnce(new Error('Cannot attach'));

    await handleBrowserAuditPage({ tabId: 42 }, 8);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('attach debugger') }),
      id: 8,
    });
  });

  test('removes event listener even on error', async () => {
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Audits.enable') throw new Error('CDP error');
      return undefined;
    });

    await handleBrowserAuditPage({ tabId: 42 }, 9);

    expect(mockRemoveListener).toHaveBeenCalledTimes(1);
  });

  test('ignores events from other tabs', async () => {
    mockSendCommand.mockImplementation(async (_target, method) => {
      if (method === 'Audits.enable') {
        fireIssue(99, 'MixedContentIssue', {});
      }
      return undefined;
    });

    await handleBrowserAuditPage({ tabId: 42, waitSeconds: 1 }, 10);

    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    const result = response.result as { totalIssues: number };
    expect(result.totalIssues).toBe(0);
  });
});
