import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted runs before vi.mock factories
// ---------------------------------------------------------------------------

const { mockIsSidePanelOpen } = vi.hoisted(() => ({
  mockIsSidePanelOpen: vi.fn<() => boolean>().mockReturnValue(false),
}));

vi.mock('./side-panel-toggle.js', () => ({
  isSidePanelOpen: mockIsSidePanelOpen,
}));

// ---------------------------------------------------------------------------
// Chrome API mocks — set up before importing the module under test so the
// module initialises against the stubs.
// ---------------------------------------------------------------------------

const mockSetBadgeText = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockSetBadgeBackgroundColor = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockNotificationsCreate = vi.fn<() => Promise<string>>().mockResolvedValue('');
const mockNotificationsClear = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
const mockGetURL = vi.fn((path: string) => `chrome-extension://fake-id/${path}`);

(globalThis as Record<string, unknown>).chrome = {
  action: {
    setBadgeText: mockSetBadgeText,
    setBadgeBackgroundColor: mockSetBadgeBackgroundColor,
  },
  notifications: {
    create: mockNotificationsCreate,
    clear: mockNotificationsClear,
    onClicked: { addListener: vi.fn() },
  },
  runtime: {
    getURL: mockGetURL,
  },
};

const NOTIFICATION_ID = 'opentabs-confirmation';

const { notifyConfirmationRequest, clearConfirmationBadge, clearAllConfirmationBadges, getPendingConfirmations } =
  await import('./confirmation-badge.js');

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset internal module state via clearAllConfirmationBadges, then reset mocks
  clearAllConfirmationBadges();
  mockSetBadgeText.mockClear();
  mockSetBadgeBackgroundColor.mockClear();
  mockNotificationsCreate.mockClear();
  mockNotificationsClear.mockClear();
  mockIsSidePanelOpen.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// notifyConfirmationRequest
// ---------------------------------------------------------------------------

describe('notifyConfirmationRequest', () => {
  test('increments badge count and sets badge text', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'doSomething', plugin: 'slack', params: {} });

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '1' });
  });

  test('increments badge count for each successive request', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });
    notifyConfirmationRequest({ id: 'req-2', tool: 'b', plugin: 'slack', params: {} });

    expect(mockSetBadgeText).toHaveBeenLastCalledWith({ text: '2' });
  });

  test('sets badge background color when count is positive', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });

    expect(mockSetBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#ffdb33' });
  });

  test('creates a consolidated notification with plugin and tool', () => {
    notifyConfirmationRequest({ id: 'my-id', tool: 'someAction', plugin: 'slack', params: {} });

    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      NOTIFICATION_ID,
      expect.objectContaining({
        type: 'basic',
        title: 'OpenTabs \u2014 Approval Required',
        message: 'slack: someAction',
        requireInteraction: true,
      }),
    );
  });

  test('uses fallback tool name when tool is not a string', () => {
    notifyConfirmationRequest({ id: 'req-x', plugin: 'slack', params: {} });

    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      NOTIFICATION_ID,
      expect.objectContaining({ message: 'slack: unknown tool' }),
    );
  });

  test('shows count message when multiple confirmations are pending', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'toolA', plugin: 'slack', params: {} });
    mockNotificationsCreate.mockClear();

    notifyConfirmationRequest({ id: 'req-2', tool: 'toolB', plugin: 'github', params: {} });

    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      NOTIFICATION_ID,
      expect.objectContaining({ message: '2 tools awaiting approval' }),
    );
  });

  test('does not show notification when side panel is open', () => {
    mockIsSidePanelOpen.mockReturnValue(true);

    notifyConfirmationRequest({ id: 'req-1', tool: 'doSomething', plugin: 'slack', params: {} });

    // Badge is still updated
    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '1' });
    // Notification is cleared (not created)
    expect(mockNotificationsCreate).not.toHaveBeenCalled();
    expect(mockNotificationsClear).toHaveBeenCalledWith(NOTIFICATION_ID);
  });

  test('duplicate id does not increment pendingConfirmationCount a second time', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });
    mockSetBadgeText.mockClear();

    // Second call with the same id — count must stay at 1, not become 2
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });

    // Badge text should not have been updated (count unchanged)
    expect(mockSetBadgeText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// clearConfirmationBadge
// ---------------------------------------------------------------------------

describe('clearConfirmationBadge', () => {
  test('decrements badge count by one', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });
    notifyConfirmationRequest({ id: 'req-2', tool: 'b', plugin: 'slack', params: {} });
    mockSetBadgeText.mockClear();

    clearConfirmationBadge('req-1');

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '1' });
  });

  test('clears badge text when count reaches zero', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });
    mockSetBadgeText.mockClear();

    clearConfirmationBadge('req-1');

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  test('is idempotent — calling twice with the same id decrements only once', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });
    notifyConfirmationRequest({ id: 'req-2', tool: 'b', plugin: 'slack', params: {} });

    clearConfirmationBadge('req-1');
    mockSetBadgeText.mockClear();

    // Second call with the same id — must be a no-op
    clearConfirmationBadge('req-1');

    expect(mockSetBadgeText).not.toHaveBeenCalled();
  });

  test('clears consolidated notification when count reaches zero', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });
    mockNotificationsClear.mockClear();

    clearConfirmationBadge('req-1');

    expect(mockNotificationsClear).toHaveBeenCalledWith(NOTIFICATION_ID);
  });

  test('updates notification to show remaining tool when one of two is cleared', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'toolA', plugin: 'slack', params: {} });
    notifyConfirmationRequest({ id: 'req-2', tool: 'toolB', plugin: 'github', params: {} });
    mockNotificationsCreate.mockClear();

    clearConfirmationBadge('req-1');

    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      NOTIFICATION_ID,
      expect.objectContaining({ message: 'github: toolB' }),
    );
  });

  test('does not underflow below zero', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });
    clearConfirmationBadge('req-1'); // count → 0
    mockSetBadgeText.mockClear();

    clearConfirmationBadge(); // should stay at 0

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  test('re-used id after clearAllConfirmationBadges can be cleared again', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });
    clearAllConfirmationBadges();

    // New confirmation with the same id
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });
    mockSetBadgeText.mockClear();

    clearConfirmationBadge('req-1');

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
  });
});

// ---------------------------------------------------------------------------
// clearAllConfirmationBadges
// ---------------------------------------------------------------------------

describe('clearAllConfirmationBadges', () => {
  test('resets badge to empty', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });
    notifyConfirmationRequest({ id: 'req-2', tool: 'b', plugin: 'slack', params: {} });
    mockSetBadgeText.mockClear();

    clearAllConfirmationBadges();

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  test('resets count so subsequent clears do not underflow', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });
    clearAllConfirmationBadges();
    mockSetBadgeText.mockClear();

    clearConfirmationBadge(); // count is 0, should stay at 0

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  test('is idempotent when called with nothing pending', () => {
    expect(() => clearAllConfirmationBadges()).not.toThrow();
    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  test('clears the consolidated notification', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'a', plugin: 'slack', params: {} });
    notifyConfirmationRequest({ id: 'req-2', tool: 'b', plugin: 'slack', params: {} });
    mockNotificationsClear.mockClear();

    clearAllConfirmationBadges();

    expect(mockNotificationsClear).toHaveBeenCalledWith(NOTIFICATION_ID);
    expect(mockNotificationsClear).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Side panel open — notification suppression
// ---------------------------------------------------------------------------

describe('side panel open suppression', () => {
  test('suppresses notification when side panel opens after confirmations were pending', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'toolA', plugin: 'slack', params: {} });
    expect(mockNotificationsCreate).toHaveBeenCalledTimes(1);

    // Side panel opens, user resolves confirmation
    mockIsSidePanelOpen.mockReturnValue(true);
    mockNotificationsCreate.mockClear();
    mockNotificationsClear.mockClear();

    clearConfirmationBadge('req-1');

    // Notification cleared (not re-created) because panel is open
    expect(mockNotificationsClear).toHaveBeenCalledWith(NOTIFICATION_ID);
    expect(mockNotificationsCreate).not.toHaveBeenCalled();
  });

  test('shows notification when side panel closes and new confirmation arrives', () => {
    mockIsSidePanelOpen.mockReturnValue(true);
    notifyConfirmationRequest({ id: 'req-1', tool: 'toolA', plugin: 'slack', params: {} });
    expect(mockNotificationsCreate).not.toHaveBeenCalled();

    // Side panel closes, new confirmation arrives
    mockIsSidePanelOpen.mockReturnValue(false);
    notifyConfirmationRequest({ id: 'req-2', tool: 'toolB', plugin: 'github', params: {} });

    expect(mockNotificationsCreate).toHaveBeenCalledWith(
      NOTIFICATION_ID,
      expect.objectContaining({ message: '2 tools awaiting approval' }),
    );
  });
});

// ---------------------------------------------------------------------------
// getPendingConfirmations
// ---------------------------------------------------------------------------

describe('getPendingConfirmations', () => {
  test('returns correct entries and entries are removed after clearConfirmationBadge', () => {
    notifyConfirmationRequest({
      id: 'req-1',
      tool: 'toolA',
      plugin: 'slack',
      params: { url: 'https://a.com' },
    });
    notifyConfirmationRequest({
      id: 'req-2',
      tool: 'toolB',
      plugin: 'github',
      params: {},
    });

    const pending = getPendingConfirmations();
    expect(pending).toHaveLength(2);

    const first = pending.find(c => c.id === 'req-1');
    expect(first).toMatchObject({
      id: 'req-1',
      tool: 'toolA',
      plugin: 'slack',
      params: { url: 'https://a.com' },
    });
    expect(first?.receivedAt).toBeTypeOf('number');

    const second = pending.find(c => c.id === 'req-2');
    expect(second).toMatchObject({
      id: 'req-2',
      tool: 'toolB',
      plugin: 'github',
      params: {},
    });

    // Clear one — only the other remains
    clearConfirmationBadge('req-1');
    const afterClear = getPendingConfirmations();
    expect(afterClear).toHaveLength(1);
    expect(afterClear[0]?.id).toBe('req-2');
  });

  test('returns empty array after clearAllConfirmationBadges', () => {
    notifyConfirmationRequest({ id: 'req-1', tool: 'toolA', plugin: 'slack', params: {} });
    notifyConfirmationRequest({ id: 'req-2', tool: 'toolB', plugin: 'github', params: {} });

    clearAllConfirmationBadges();

    expect(getPendingConfirmations()).toEqual([]);
  });

  test('returns empty array when no confirmations are pending', () => {
    expect(getPendingConfirmations()).toEqual([]);
  });
});
