import { isTabGroupColor, TAB_GROUP_COLORS } from '@opentabs-dev/shared/tab-group-colors';
import {
  requireGroupId,
  requireTabId,
  requireTabIds,
  requireUrl,
  sendErrorResult,
  sendSuccessResult,
  sendValidationError,
} from './helpers.js';

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

/** Serialises a Chrome tab group into the standard wire shape. */
const serializeTabGroup = (group: chrome.tabGroups.TabGroup) => ({
  groupId: group.id,
  title: group.title ?? '',
  color: group.color,
  collapsed: group.collapsed,
  windowId: group.windowId,
});

/**
 * Validates an optional `color` parameter. Returns the validated color, `undefined` if absent,
 * or `null` if invalid (in which case a validation error has been sent and the caller should return).
 */
const validateOptionalColor = (params: Record<string, unknown>, id: string | number): string | undefined | null => {
  const color = params.color;
  if (color === undefined) return undefined;
  if (!isTabGroupColor(color)) {
    sendValidationError(id, `Invalid color "${String(color)}". Must be one of: ${TAB_GROUP_COLORS.join(', ')}`);
    return null;
  }
  return color;
};

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
    sendSuccessResult(id, groups.map(serializeTabGroup));
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Creates a new tab group from the given tab IDs, optionally setting a title and color.
 * Expects `{ tabIds: number[], title?: string, color?: string }`. Returns the full group state.
 */
export const handleBrowserCreateTabGroup = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabIds = requireTabIds(params, id);
    if (tabIds === null) return;
    const color = validateOptionalColor(params, id);
    if (color === null) return;
    const groupId = await chrome.tabs.group({ tabIds });
    const updateProps: chrome.tabGroups.UpdateProperties = {};
    if (typeof params.title === 'string') updateProps.title = params.title;
    if (color !== undefined) updateProps.color = color as chrome.tabGroups.Color;
    if (Object.keys(updateProps).length > 0) {
      await chrome.tabGroups.update(groupId, updateProps);
    }
    const group = await chrome.tabGroups.get(groupId);
    sendSuccessResult(id, serializeTabGroup(group));
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/** Adds tabs to an existing tab group. Expects `{ groupId, tabIds }`. */
export const handleBrowserAddTabsToGroup = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const groupId = requireGroupId(params, id);
    if (groupId === null) return;
    const tabIds = requireTabIds(params, id);
    if (tabIds === null) return;
    await chrome.tabs.group({ groupId, tabIds });
    sendSuccessResult(id, { ok: true, groupId });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/** Removes tabs from their current group (ungroups them). Expects `{ tabIds }`. */
export const handleBrowserRemoveTabsFromGroup = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const tabIds = requireTabIds(params, id);
    if (tabIds === null) return;
    await chrome.tabs.ungroup(tabIds);
    sendSuccessResult(id, { ok: true });
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Updates a tab group's properties (title, color, collapsed state).
 * Expects `{ groupId, title?, color?, collapsed? }`. Returns the updated group state.
 * `chrome.tabGroups.update` throws on invalid group IDs — that path is handled by the catch block.
 */
export const handleBrowserUpdateTabGroup = async (
  params: Record<string, unknown>,
  id: string | number,
): Promise<void> => {
  try {
    const groupId = requireGroupId(params, id);
    if (groupId === null) return;
    const color = validateOptionalColor(params, id);
    if (color === null) return;
    const updateProps: chrome.tabGroups.UpdateProperties = {};
    if (typeof params.title === 'string') updateProps.title = params.title;
    if (color !== undefined) updateProps.color = color as chrome.tabGroups.Color;
    if (typeof params.collapsed === 'boolean') updateProps.collapsed = params.collapsed;
    if (Object.keys(updateProps).length === 0) {
      sendValidationError(id, 'At least one of title, color, or collapsed must be provided');
      return;
    }
    // chrome.tabGroups.update throws on invalid group IDs, so an undefined return is impossible in
    // practice — but the Chrome type still permits it, so assert here so the catch block surfaces
    // the (theoretical) edge case as a normal error rather than a TypeError downstream.
    const group = await chrome.tabGroups.update(groupId, updateProps);
    if (!group) throw new Error(`chrome.tabGroups.update returned no group for id ${groupId}`);
    sendSuccessResult(id, serializeTabGroup(group));
  } catch (err) {
    sendErrorResult(id, err);
  }
};

/**
 * Lists all tabs belonging to a specific tab group.
 * Expects `{ groupId }`. Returns an array of tab objects.
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
