/**
 * Canonical list of JSON-RPC methods the browser extension handles.
 *
 * Both the offscreen document's ALLOWED_METHODS allowlist and the background
 * script's methodHandlers dispatch table derive from these constants, ensuring
 * they stay in sync. A unit test verifies the invariant.
 */

/** Methods routed to handlers in the background script's dispatch table */
export const DISPATCH_METHODS = [
  'sync.full',
  'plugin.update',
  'plugin.uninstall',
  'tool.dispatch',
  'browser.listTabs',
  'browser.openTab',
  'browser.closeTab',
  'browser.navigateTab',
  'browser.focusTab',
  'browser.getTabInfo',
  'browser.listTabGroups',
  'browser.createTabGroup',
  'browser.addTabsToGroup',
  'browser.removeTabsFromGroup',
  'browser.updateTabGroup',
  'browser.listTabsInGroup',
  'browser.screenshotTab',
  'browser.getTabContent',
  'browser.getPageHtml',
  'browser.getStorage',
  'browser.clickElement',
  'browser.typeText',
  'browser.selectOption',
  'browser.waitForElement',
  'browser.queryElements',
  'browser.getCookies',
  'browser.setCookie',
  'browser.deleteCookies',
  'browser.enableNetworkCapture',
  'browser.getNetworkRequests',
  'browser.getWebSocketFrames',
  'browser.disableNetworkCapture',
  'browser.getConsoleLogs',
  'browser.clearConsoleLogs',
  'browser.executeScript',
  'browser.listResources',
  'browser.getResourceContent',
  'browser.pressKey',
  'browser.scroll',
  'browser.hoverElement',
  'browser.handleDialog',
  'browser.showNotification',
  'browser.interceptRequests',
  'browser.fulfillRequest',
  'browser.failRequest',
  'browser.stopIntercepting',
  'extension.reload',
  'extension.getState',
  'extension.getLogs',
  'extension.getSidePanel',
  'extension.checkAdapter',
  'extension.forceReconnect',
  'extension.getTabState',
] as const;

/**
 * Methods allowed through the offscreen WebSocket filter but NOT routed to
 * a handler in methodHandlers. These are either:
 * - handled directly by the offscreen document (pong)
 * - forwarded to the side panel without a dispatch handler (invocation events)
 */
export const PASSTHROUGH_METHODS = [
  'pong',
  'tool.invocationStart',
  'tool.invocationEnd',
  'confirmation.request',
  'plugins.changed',
] as const;

/** All methods the offscreen document allows through the WebSocket filter */
export const ALL_ALLOWED_METHODS = [...DISPATCH_METHODS, ...PASSTHROUGH_METHODS] as const;
