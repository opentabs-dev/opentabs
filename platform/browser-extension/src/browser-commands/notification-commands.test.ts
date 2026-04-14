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

// Stub chrome APIs
const mockNotificationsCreate = vi.fn<(id: string, opts: unknown) => Promise<string>>().mockResolvedValue('');
const mockNotificationsClear = vi.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true);
const mockOnClickedAddListener = vi.fn();
const mockTabsCreate = vi.fn<(opts: unknown) => Promise<chrome.tabs.Tab>>().mockResolvedValue({} as chrome.tabs.Tab);
const mockWindowsGetCurrent = vi
  .fn<() => Promise<chrome.windows.Window>>()
  .mockResolvedValue({ id: 1 } as chrome.windows.Window);
const mockSidePanelOpen = vi.fn<(opts: unknown) => Promise<void>>().mockResolvedValue(undefined);

Object.assign(globalThis, {
  chrome: {
    ...((globalThis as Record<string, unknown>).chrome as object),
    runtime: { getURL: (path: string) => `chrome-extension://test-id/${path}` },
    notifications: {
      create: mockNotificationsCreate,
      clear: mockNotificationsClear,
      onClicked: { addListener: mockOnClickedAddListener },
    },
    tabs: { create: mockTabsCreate },
    windows: { getCurrent: mockWindowsGetCurrent },
    sidePanel: { open: mockSidePanelOpen },
  },
});

// Import after mocking
const { handleBrowserShowNotification, _notificationUrlsForTesting } = await import('./notification-commands.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleBrowserShowNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _notificationUrlsForTesting.clear();
  });

  test('creates notification with title and message', async () => {
    await handleBrowserShowNotification({ title: 'Test', message: 'Hello' }, 1);

    expect(mockNotificationsCreate).toHaveBeenCalledOnce();
    const [notifId, opts] = mockNotificationsCreate.mock.calls[0] as [string, Record<string, unknown>];
    expect(notifId).toMatch(/^opentabs-notify-/);
    expect(opts).toMatchObject({
      type: 'basic',
      title: 'Test',
      message: 'Hello',
      priority: 1,
      requireInteraction: false,
    });

    // Success response includes the notification ID
    expect(mockSendToServer).toHaveBeenCalledOnce();
    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      result: { notificationId: notifId },
      id: 1,
    });
  });

  test('uses default extension icon when iconUrl is not provided', async () => {
    await handleBrowserShowNotification({ title: 'T', message: 'M' }, 2);

    const [, opts] = mockNotificationsCreate.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.iconUrl).toBe('chrome-extension://test-id/icons/icon-128.png');
  });

  test('uses custom iconUrl when provided', async () => {
    await handleBrowserShowNotification({ title: 'T', message: 'M', iconUrl: 'https://example.com/icon.png' }, 3);

    const [, opts] = mockNotificationsCreate.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.iconUrl).toBe('https://example.com/icon.png');
  });

  test('passes optional fields when provided', async () => {
    await handleBrowserShowNotification(
      {
        title: 'T',
        message: 'M',
        requireInteraction: true,
        contextMessage: 'Extra context',
        url: 'https://example.com',
      },
      4,
    );

    const [notifId, opts] = mockNotificationsCreate.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts).toMatchObject({
      requireInteraction: true,
      contextMessage: 'Extra context',
    });

    // URL should be stored for click handling
    expect(_notificationUrlsForTesting.get(notifId)).toBe('https://example.com');
  });

  test('does not include contextMessage when not provided', async () => {
    await handleBrowserShowNotification({ title: 'T', message: 'M' }, 5);

    const [, opts] = mockNotificationsCreate.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts).not.toHaveProperty('contextMessage');
  });

  test('does not store URL when not provided', async () => {
    await handleBrowserShowNotification({ title: 'T', message: 'M' }, 6);

    expect(_notificationUrlsForTesting.size).toBe(0);
  });

  test('sends error result on chrome.notifications.create failure', async () => {
    mockNotificationsCreate.mockRejectedValueOnce(new Error('notifications disabled'));

    await handleBrowserShowNotification({ title: 'T', message: 'M' }, 7);

    expect(mockSendToServer).toHaveBeenCalledOnce();
    const response = mockSendToServer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      error: expect.objectContaining({ message: expect.stringContaining('notifications disabled') }),
      id: 7,
    });
  });
});
