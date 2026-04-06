import {
  requireGroupId,
  requireTabId,
  requireTabIds,
  requireUrl,
  sendErrorResult,
  sendSuccessResult,
  sendValidationError,
} from './helpers.js';

/** Valid Chrome tab group colours */
const TAB_GROUP_COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);

/** Lists all open Chrome tabs with their IDs, URLs, titles, active state, and window IDs. */
export const handleBrowserListTabs = async (id: string | number): Promise<void> => {
  try {
    const tabs = await chrome.tabs.query({});
    const result = tabs.map(tab => ({
      id: tab.id,
      title: tab.title ?? '',
      url: tab.url ?? '',
      active: tab.active,
      windowId: tab.windowId,
      groupId: tab.groupId ?? -1,
    }));
    sendSuccessResult(id, result);
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Opens a new Chrome tab with the specified URL.
 * @param params - Expects `{ url: string }`. Rejects blocked URL schemes (javascript:, data:, etc.)
 *   but allows `about:blank` for internal callers (e.g., analyze-site) that need a blank tab
 *   for network capture setup before navigating to the real URL.
 * @returns The new tab's ID, title, URL, and window ID.
 */
export const handleBrowserOpenTab = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const rawUrl = params.url;
    let url: string;
    if (typeof rawUrl === 'string' && rawUrl === 'about:blank') {
      url = rawUrl;
    } else {
      const validated = requireUrl(params, id);
      if (validated === null) return;
      url = validated;
    }
    const tab = await chrome.tabs.create({ url });
    sendSuccessResult(id, { id: tab.id, title: tab.title ?? '', url: tab.url ?? url, windowId: tab.windowId });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Closes a Chrome tab by its ID.
 * @param params - Expects `{ tabId: number }`.
 * @returns `{ ok: true }` on success.
 */
export const handleBrowserCloseTab = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    await chrome.tabs.remove(tabId);
    sendSuccessResult(id, { ok: true });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Navigates an existing tab to a new URL.
 * @param params - Expects `{ tabId: number, url: string }`. Rejects blocked URL schemes.
 * @returns The tab's ID, title, and navigated URL.
 */
export const handleBrowserNavigateTab = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const url = requireUrl(params, id);
    if (url === null) return;
    const tab = await chrome.tabs.update(tabId, { url });
    sendSuccessResult(id, { id: tab?.id ?? tabId, title: tab?.title ?? '', url });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Activates a tab and brings its window to the foreground.
 * @param params - Expects `{ tabId: number }`.
 * @returns The focused tab's ID, title, URL, and active state.
 */
export const handleBrowserFocusTab = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (!tab) {
      sendValidationError(id, `Tab ${tabId} not found`);
      return;
    }
    await chrome.windows.update(tab.windowId, { focused: true });
    sendSuccessResult(id, { id: tab.id, title: tab.title ?? '', url: tab.url ?? '', active: true });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Retrieves detailed metadata for a single tab including status, favicon URL, and incognito state.
 * @param params - Expects `{ tabId: number }`.
 * @returns Tab metadata: ID, title, URL, status, active, windowId, favIconUrl, and incognito.
 */
export const handleBrowserGetTabInfo = async (params: Record<string, unknown>, id: string | number): Promise<void> => {
  try {
    const tabId = requireTabId(params, id);
    if (tabId === null) return;
    const tab = await chrome.tabs.get(tabId);
    sendSuccessResult(id, {
      id: tab.id,
      title: tab.title ?? '',
      url: tab.url ?? '',
      status: tab.status ?? '',
      active: tab.active,
      windowId: tab.windowId,
      favIconUrl: tab.favIconUrl ?? '',
      incognito: tab.incognito,
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

// ---------------------------------------------------------------------------
// Tab Group Management
// ---------------------------------------------------------------------------

/** Lists all Chrome tab groups, optionally filtered by window ID. */
export const handleBrowserListTabGroups = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const query: chrome.tabGroups.QueryInfo = {};
    if (typeof params.windowId === 'number') {
      query.windowId = params.windowId;
    }
    const groups = await chrome.tabGroups.query(query);
    const result = groups.map(group => ({
      id: group.id,
      title: group.title ?? '',
      color: group.color,
      collapsed: group.collapsed,
      windowId: group.windowId,
    }));
    sendSuccessResult(id, result);
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Creates a new tab group from the given tab IDs, optionally setting a title and colour.
 * @param params - Expects `{ tabIds: number[], title?: string, color?: string }`.
 * @returns The new group's ID, title, and colour.
 */
export const handleBrowserCreateTabGroup = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabIds = requireTabIds(params, id);
    if (tabIds === null) return;
    const color = params.color;
    if (color !== undefined && (typeof color !== 'string' || !TAB_GROUP_COLORS.has(color))) {
      sendValidationError(id, `Invalid color "${String(color)}". Must be one of: ${[...TAB_GROUP_COLORS].join(', ')}`);
      return;
    }
    const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] });
    const updateProps: chrome.tabGroups.UpdateProperties = {};
    if (typeof params.title === 'string') updateProps.title = params.title;
    if (color !== undefined) updateProps.color = color as `${chrome.tabGroups.Color}`;
    if (Object.keys(updateProps).length > 0) {
      await chrome.tabGroups.update(groupId, updateProps);
    }
    const group = await chrome.tabGroups.get(groupId);
    sendSuccessResult(id, {
      groupId: group.id,
      title: group.title ?? '',
      color: group.color,
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Adds tabs to an existing tab group.
 * @param params - Expects `{ groupId: number, tabIds: number[] }`.
 * @returns `{ ok: true, groupId }`.
 */
export const handleBrowserAddTabsToGroup = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const groupId = requireGroupId(params, id);
    if (groupId === null) return;
    const tabIds = requireTabIds(params, id);
    if (tabIds === null) return;
    await chrome.tabs.group({ groupId, tabIds: tabIds as [number, ...number[]] });
    sendSuccessResult(id, { ok: true, groupId });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Removes tabs from their current group (ungroups them).
 * @param params - Expects `{ tabIds: number[] }`.
 * @returns `{ ok: true }`.
 */
export const handleBrowserRemoveTabsFromGroup = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabIds = requireTabIds(params, id);
    if (tabIds === null) return;
    await chrome.tabs.ungroup(tabIds as [number, ...number[]]);
    sendSuccessResult(id, { ok: true });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Updates a tab group's properties (title, colour, collapsed state).
 * @param params - Expects `{ groupId: number, title?: string, color?: string, collapsed?: boolean }`.
 * @returns The updated group state.
 */
export const handleBrowserUpdateTabGroup = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const groupId = requireGroupId(params, id);
    if (groupId === null) return;
    const color = params.color;
    if (color !== undefined && (typeof color !== 'string' || !TAB_GROUP_COLORS.has(color))) {
      sendValidationError(id, `Invalid color "${String(color)}". Must be one of: ${[...TAB_GROUP_COLORS].join(', ')}`);
      return;
    }
    const updateProps: chrome.tabGroups.UpdateProperties = {};
    if (typeof params.title === 'string') updateProps.title = params.title;
    if (color !== undefined) updateProps.color = color as `${chrome.tabGroups.Color}`;
    if (typeof params.collapsed === 'boolean') updateProps.collapsed = params.collapsed;
    const group = await chrome.tabGroups.update(groupId, updateProps);
    if (!group) {
      sendValidationError(id, `Tab group ${groupId} not found`);
      return;
    }
    sendSuccessResult(id, {
      groupId: group.id,
      title: group.title ?? '',
      color: group.color,
      collapsed: group.collapsed,
    });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Lists all tabs belonging to a specific tab group.
 * @param params - Expects `{ groupId: number }`.
 * @returns Array of tab objects.
 */
export const handleBrowserListTabsInGroup = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const groupId = requireGroupId(params, id);
    if (groupId === null) return;
    const tabs = await chrome.tabs.query({ groupId });
    const result = tabs.map(tab => ({
      id: tab.id,
      title: tab.title ?? '',
      url: tab.url ?? '',
      active: tab.active,
      windowId: tab.windowId,
    }));
    sendSuccessResult(id, result);
  } catch (err) {
    sendErrorResult(id, err);
  }
};
