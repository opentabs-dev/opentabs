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

// Stub chrome APIs
const mockTabsQuery = vi.fn<() => Promise<chrome.tabs.Tab[]>>().mockResolvedValue([]);
const mockTabsCreate = vi.fn<(opts: unknown) => Promise<chrome.tabs.Tab>>().mockResolvedValue({} as chrome.tabs.Tab);
const mockTabsRemove = vi.fn<(tabId: number) => Promise<void>>().mockResolvedValue(undefined);
const mockTabsUpdate = vi
  .fn<(tabId: number, props: unknown) => Promise<chrome.tabs.Tab | undefined>>()
  .mockResolvedValue(undefined);
const mockTabsGet = vi.fn<(tabId: number) => Promise<chrome.tabs.Tab>>().mockResolvedValue({} as chrome.tabs.Tab);
const mockWindowsUpdate = vi.fn<(windowId: number, props: unknown) => Promise<void>>().mockResolvedValue(undefined);

const mockTabsGroup = vi.fn<(opts: unknown) => Promise<number>>().mockResolvedValue(1);
const mockTabsUngroup = vi.fn<(tabIds: number[]) => Promise<void>>().mockResolvedValue(undefined);
const mockTabGroupsQuery = vi.fn<(query: unknown) => Promise<chrome.tabGroups.TabGroup[]>>().mockResolvedValue([]);
const mockTabGroupsGet = vi.fn<(groupId: number) => Promise<chrome.tabGroups.TabGroup>>().mockResolvedValue({
  id: 1,
  title: '',
  color: 'blue' as chrome.tabGroups.Color,
  collapsed: false,
  windowId: 1,
} as chrome.tabGroups.TabGroup);
const mockTabGroupsUpdate = vi
  .fn<(groupId: number, props: unknown) => Promise<chrome.tabGroups.TabGroup>>()
  .mockResolvedValue({
    id: 1,
    title: '',
    color: 'blue' as chrome.tabGroups.Color,
    collapsed: false,
    windowId: 1,
  } as chrome.tabGroups.TabGroup);

Object.assign(globalThis, {
  chrome: {
    ...((globalThis as Record<string, unknown>).chrome as object),
    runtime: { id: 'test-extension-id' },
    tabs: {
      query: mockTabsQuery,
      create: mockTabsCreate,
      remove: mockTabsRemove,
      update: mockTabsUpdate,
      get: mockTabsGet,
      group: mockTabsGroup,
      ungroup: mockTabsUngroup,
    },
    windows: { update: mockWindowsUpdate },
    tabGroups: {
      query: mockTabGroupsQuery,
      get: mockTabGroupsGet,
      update: mockTabGroupsUpdate,
    },
  },
});

// Import after mocking
const {
  handleBrowserOpenTab,
  handleBrowserCloseTab,
  handleBrowserNavigateTab,
  handleBrowserFocusTab,
  handleBrowserGetTabInfo,
  handleBrowserListTabs,
  handleBrowserListTabGroups,
  handleBrowserCreateTabGroup,
  handleBrowserAddTabsToGroup,
  handleBrowserRemoveTabsFromGroup,
  handleBrowserUpdateTabGroup,
  handleBrowserListTabsInGroup,
} = await import('./tab-commands.js');

/** Extract the first argument from the first call to mockSendToServer */
const firstSentMessage = (): Record<string, unknown> => {
  const calls = mockSendToServer.mock.calls;
  expect(calls.length).toBeGreaterThanOrEqual(1);
  const firstCall = calls[0];
  if (!firstCall) throw new Error('Expected at least one call');
  return firstCall[0] as Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// handleBrowserOpenTab
// ---------------------------------------------------------------------------

describe('handleBrowserOpenTab', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('rejects missing url', async () => {
    await handleBrowserOpenTab({}, 'req-1');
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      error: { code: -32602, message: 'Missing or invalid url parameter' },
    });
  });

  test('rejects non-string url', async () => {
    await handleBrowserOpenTab({ url: 42 }, 'req-2');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('allows about:blank without URL validation', async () => {
    mockTabsCreate.mockResolvedValueOnce({
      id: 99,
      title: '',
      url: 'about:blank',
      windowId: 1,
    } as chrome.tabs.Tab);
    await handleBrowserOpenTab({ url: 'about:blank' }, 'req-blank');
    expect(mockTabsCreate).toHaveBeenCalledWith({ url: 'about:blank' });
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-blank',
      result: { id: 99, url: 'about:blank' },
    });
  });

  test('rejects javascript: url', async () => {
    await handleBrowserOpenTab({ url: 'javascript:alert(1)' }, 'req-3');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects data: url', async () => {
    await handleBrowserOpenTab({ url: 'data:text/html,<h1>hi</h1>' }, 'req-4');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserCloseTab
// ---------------------------------------------------------------------------

describe('handleBrowserCloseTab', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('rejects missing tabId', async () => {
    await handleBrowserCloseTab({}, 'req-10');
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-10',
      error: { code: -32602, message: 'Missing or invalid tabId parameter' },
    });
  });

  test('rejects non-number tabId', async () => {
    await handleBrowserCloseTab({ tabId: 'abc' }, 'req-11');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserNavigateTab
// ---------------------------------------------------------------------------

describe('handleBrowserNavigateTab', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('rejects missing tabId', async () => {
    await handleBrowserNavigateTab({ url: 'https://example.com' }, 'req-20');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid tabId parameter' },
    });
  });

  test('rejects missing url', async () => {
    await handleBrowserNavigateTab({ tabId: 1 }, 'req-21');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid url parameter' },
    });
  });

  test('rejects blocked url scheme', async () => {
    await handleBrowserNavigateTab({ tabId: 1, url: 'file:///etc/passwd' }, 'req-22');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('returns requested url, not pre-navigation tab url', async () => {
    mockTabsUpdate.mockResolvedValueOnce({
      id: 42,
      title: 'Old Page',
      url: 'https://old.example.com',
    } as chrome.tabs.Tab);
    await handleBrowserNavigateTab({ tabId: 42, url: 'https://new.example.com' }, 'req-23');
    expect(firstSentMessage()).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-23',
      result: { id: 42, url: 'https://new.example.com' },
    });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserFocusTab
// ---------------------------------------------------------------------------

describe('handleBrowserFocusTab', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('rejects missing tabId', async () => {
    await handleBrowserFocusTab({}, 'req-30');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid tabId parameter' },
    });
  });

  test('rejects non-number tabId', async () => {
    await handleBrowserFocusTab({ tabId: true }, 'req-31');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserGetTabInfo
// ---------------------------------------------------------------------------

describe('handleBrowserGetTabInfo', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('rejects missing tabId', async () => {
    await handleBrowserGetTabInfo({}, 'req-40');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: 'Missing or invalid tabId parameter' },
    });
  });

  test('rejects non-number tabId', async () => {
    await handleBrowserGetTabInfo({ tabId: null }, 'req-41');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserListTabs — groupId enhancement
// ---------------------------------------------------------------------------

describe('handleBrowserListTabs', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('includes groupId in output', async () => {
    mockTabsQuery.mockResolvedValueOnce([
      { id: 1, title: 'Tab 1', url: 'https://example.com', active: true, windowId: 1, groupId: 5 } as chrome.tabs.Tab,
      { id: 2, title: 'Tab 2', url: 'https://test.com', active: false, windowId: 1, groupId: -1 } as chrome.tabs.Tab,
    ]);
    await handleBrowserListTabs('req-50');
    const msg = firstSentMessage();
    const result = msg.result as Array<Record<string, unknown>>;
    expect(result[0]).toMatchObject({ id: 1, groupId: 5 });
    expect(result[1]).toMatchObject({ id: 2, groupId: -1 });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserListTabGroups
// ---------------------------------------------------------------------------

describe('handleBrowserListTabGroups', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('returns all tab groups', async () => {
    mockTabGroupsQuery.mockResolvedValueOnce([
      {
        id: 1,
        title: 'Group 1',
        color: 'blue' as chrome.tabGroups.Color,
        collapsed: false,
        windowId: 1,
      } as chrome.tabGroups.TabGroup,
    ]);
    await handleBrowserListTabGroups({}, 'req-60');
    const msg = firstSentMessage();
    const result = msg.result as Array<Record<string, unknown>>;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      groupId: 1,
      title: 'Group 1',
      color: 'blue',
      collapsed: false,
      windowId: 1,
    });
  });

  test('propagates chrome.tabGroups.query rejection', async () => {
    mockTabGroupsQuery.mockRejectedValueOnce(new Error('chrome failed'));
    await handleBrowserListTabGroups({}, 'req-62');
    expect(firstSentMessage()).toMatchObject({ error: { message: expect.stringContaining('chrome failed') } });
  });

  test('filters by windowId', async () => {
    await handleBrowserListTabGroups({ windowId: 2 }, 'req-61');
    expect(mockTabGroupsQuery).toHaveBeenCalledWith({ windowId: 2 });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserCreateTabGroup
// ---------------------------------------------------------------------------

describe('handleBrowserCreateTabGroup', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockTabsGroup.mockReset().mockResolvedValue(1);
    mockTabGroupsUpdate.mockReset().mockResolvedValue({
      id: 1,
      title: 'Test',
      color: 'red' as chrome.tabGroups.Color,
      collapsed: false,
      windowId: 1,
    } as chrome.tabGroups.TabGroup);
    mockTabGroupsGet.mockReset().mockResolvedValue({
      id: 1,
      title: 'Test',
      color: 'red' as chrome.tabGroups.Color,
      collapsed: false,
      windowId: 1,
    } as chrome.tabGroups.TabGroup);
  });

  test('creates group with title and color', async () => {
    await handleBrowserCreateTabGroup({ tabIds: [10, 20], title: 'Test', color: 'red' }, 'req-70');
    expect(mockTabsGroup).toHaveBeenCalledWith({ tabIds: [10, 20] });
    expect(mockTabGroupsUpdate).toHaveBeenCalledWith(1, { title: 'Test', color: 'red' });
    const msg = firstSentMessage();
    expect(msg.result).toMatchObject({ groupId: 1, title: 'Test', color: 'red', collapsed: false, windowId: 1 });
  });

  test('propagates chrome.tabs.group rejection', async () => {
    mockTabsGroup.mockRejectedValueOnce(new Error('group failed'));
    await handleBrowserCreateTabGroup({ tabIds: [1] }, 'req-74');
    expect(firstSentMessage()).toMatchObject({ error: { message: expect.stringContaining('group failed') } });
  });

  test('rejects missing tabIds', async () => {
    await handleBrowserCreateTabGroup({}, 'req-71');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects empty tabIds', async () => {
    await handleBrowserCreateTabGroup({ tabIds: [] }, 'req-72');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects invalid color', async () => {
    await handleBrowserCreateTabGroup({ tabIds: [1], color: 'neon' }, 'req-73');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserAddTabsToGroup
// ---------------------------------------------------------------------------

describe('handleBrowserAddTabsToGroup', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockTabsGroup.mockReset().mockResolvedValue(5);
  });

  test('adds tabs to group', async () => {
    await handleBrowserAddTabsToGroup({ groupId: 5, tabIds: [10, 20] }, 'req-80');
    expect(mockTabsGroup).toHaveBeenCalledWith({ groupId: 5, tabIds: [10, 20] });
    expect(firstSentMessage()).toMatchObject({
      result: { ok: true, groupId: 5 },
    });
  });

  test('rejects missing groupId', async () => {
    await handleBrowserAddTabsToGroup({ tabIds: [1] }, 'req-81');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects negative groupId', async () => {
    await handleBrowserAddTabsToGroup({ groupId: -1, tabIds: [1] }, 'req-82');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects missing tabIds', async () => {
    await handleBrowserAddTabsToGroup({ groupId: 5 }, 'req-83');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('propagates chrome.tabs.group rejection', async () => {
    mockTabsGroup.mockRejectedValueOnce(new Error('add failed'));
    await handleBrowserAddTabsToGroup({ groupId: 5, tabIds: [1] }, 'req-84');
    expect(firstSentMessage()).toMatchObject({ error: { message: expect.stringContaining('add failed') } });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserRemoveTabsFromGroup
// ---------------------------------------------------------------------------

describe('handleBrowserRemoveTabsFromGroup', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockTabsUngroup.mockReset().mockResolvedValue(undefined);
  });

  test('ungroups tabs', async () => {
    await handleBrowserRemoveTabsFromGroup({ tabIds: [10, 20] }, 'req-90');
    expect(mockTabsUngroup).toHaveBeenCalledWith([10, 20]);
    expect(firstSentMessage()).toMatchObject({
      result: { ok: true },
    });
  });

  test('rejects missing tabIds', async () => {
    await handleBrowserRemoveTabsFromGroup({}, 'req-91');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects non-array tabIds', async () => {
    await handleBrowserRemoveTabsFromGroup({ tabIds: 'abc' }, 'req-92');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('propagates chrome.tabs.ungroup rejection', async () => {
    mockTabsUngroup.mockRejectedValueOnce(new Error('ungroup failed'));
    await handleBrowserRemoveTabsFromGroup({ tabIds: [1] }, 'req-93');
    expect(firstSentMessage()).toMatchObject({ error: { message: expect.stringContaining('ungroup failed') } });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserUpdateTabGroup
// ---------------------------------------------------------------------------

describe('handleBrowserUpdateTabGroup', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
    mockTabGroupsUpdate.mockReset().mockResolvedValue({
      id: 3,
      title: 'Updated',
      color: 'green' as chrome.tabGroups.Color,
      collapsed: true,
      windowId: 1,
    } as chrome.tabGroups.TabGroup);
  });

  test('updates group properties', async () => {
    await handleBrowserUpdateTabGroup({ groupId: 3, title: 'Updated', color: 'green', collapsed: true }, 'req-100');
    expect(mockTabGroupsUpdate).toHaveBeenCalledWith(3, { title: 'Updated', color: 'green', collapsed: true });
    expect(firstSentMessage()).toMatchObject({
      result: { groupId: 3, title: 'Updated', color: 'green', collapsed: true, windowId: 1 },
    });
  });

  test('rejects missing groupId', async () => {
    await handleBrowserUpdateTabGroup({ title: 'X' }, 'req-101');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects invalid color', async () => {
    await handleBrowserUpdateTabGroup({ groupId: 3, color: 'rainbow' }, 'req-102');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects empty update (no fields provided)', async () => {
    await handleBrowserUpdateTabGroup({ groupId: 3 }, 'req-103');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602, message: expect.stringContaining('At least one of title, color, or collapsed') },
    });
    expect(mockTabGroupsUpdate).not.toHaveBeenCalled();
  });

  test('propagates chrome.tabGroups.update rejection (e.g. group deleted)', async () => {
    mockTabGroupsUpdate.mockRejectedValueOnce(new Error('No group with id: 99'));
    await handleBrowserUpdateTabGroup({ groupId: 99, title: 'X' }, 'req-104');
    expect(firstSentMessage()).toMatchObject({
      error: { message: expect.stringContaining('No group with id: 99') },
    });
  });
});

// ---------------------------------------------------------------------------
// handleBrowserListTabsInGroup
// ---------------------------------------------------------------------------

describe('handleBrowserListTabsInGroup', () => {
  beforeEach(() => {
    mockSendToServer.mockReset();
  });

  test('returns tabs in group', async () => {
    mockTabsQuery.mockResolvedValueOnce([
      { id: 10, title: 'Tab A', url: 'https://a.com', active: true, windowId: 1 } as chrome.tabs.Tab,
      { id: 20, title: 'Tab B', url: 'https://b.com', active: false, windowId: 1 } as chrome.tabs.Tab,
    ]);
    await handleBrowserListTabsInGroup({ groupId: 5 }, 'req-110');
    expect(mockTabsQuery).toHaveBeenCalledWith({ groupId: 5 });
    const msg = firstSentMessage();
    const result = msg.result as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 10, title: 'Tab A' });
  });

  test('rejects missing groupId', async () => {
    await handleBrowserListTabsInGroup({}, 'req-111');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });

  test('rejects non-number groupId', async () => {
    await handleBrowserListTabsInGroup({ groupId: 'abc' }, 'req-112');
    expect(firstSentMessage()).toMatchObject({
      error: { code: -32602 },
    });
  });
});
