// =============================================================================
// Browser Tabs Tools — Platform-Native
//
// Tools for interacting with Chrome browser tabs and windows. These are
// platform-native tools that call chrome.tabs.* and chrome.windows.* APIs
// through the browser controller in the extension's background script.
//
// Unlike plugin tools, these don't use webapp adapters — they're always
// available when the Chrome extension is connected. They're part of the
// MCP server package itself, not an external plugin.
//
// The browser controller lives in the extension's background script and
// handles the actual chrome.* API calls. These tool definitions just
// describe the MCP interface and delegate to the controller via
// sendBrowserRequest().
// =============================================================================

import { createToolRegistrar, sendBrowserRequest, success } from '@opentabs/plugin-sdk/server';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

// -----------------------------------------------------------------------------
// Types — Subset of chrome.tabs.Tab fields returned to MCP clients
// -----------------------------------------------------------------------------

interface TabInfo {
  readonly id: number;
  readonly windowId: number;
  readonly url?: string;
  readonly title?: string;
  readonly active: boolean;
  readonly pinned: boolean;
  readonly incognito: boolean;
  readonly status?: string;
  readonly favIconUrl?: string;
  readonly index: number;
}

// -----------------------------------------------------------------------------
// Tool Registration
// -----------------------------------------------------------------------------

export const registerBrowserTabsTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // -------------------------------------------------------------------------
  // List tabs
  // -------------------------------------------------------------------------

  define(
    'browser_list_tabs',
    {
      description:
        'List open browser tabs. Optionally filter by window, active state, pinned state, ' +
        'or URL pattern. Returns tab IDs, URLs, titles, and status for each matching tab.',
      inputSchema: {
        windowId: z.number().optional().describe('Filter to a specific window ID'),
        active: z.boolean().optional().describe('Filter to active tabs only'),
        pinned: z.boolean().optional().describe('Filter to pinned tabs only'),
        url: z
          .string()
          .optional()
          .describe('URL pattern to match (supports Chrome match patterns like "*://*.example.com/*")'),
        currentWindow: z.boolean().optional().describe('Filter to tabs in the current (focused) window'),
      },
    },
    async ({ windowId, active, pinned, url, currentWindow }) => {
      const params: Record<string, unknown> = {};
      if (windowId !== undefined) params.windowId = windowId;
      if (active !== undefined) params.active = active;
      if (pinned !== undefined) params.pinned = pinned;
      if (url !== undefined) params.url = url;
      if (currentWindow !== undefined) params.currentWindow = currentWindow;

      const result = await sendBrowserRequest<{ tabs: TabInfo[] }>('listTabs', params);
      return success(result);
    },
  );

  // -------------------------------------------------------------------------
  // Get tab
  // -------------------------------------------------------------------------

  define(
    'browser_get_tab',
    {
      description:
        'Get detailed information about a specific browser tab by its ID. ' +
        "Returns the tab's URL, title, active state, and other metadata.",
      inputSchema: {
        tabId: z.number().describe('The ID of the tab to get information about'),
      },
    },
    async ({ tabId }) => {
      const result = await sendBrowserRequest<TabInfo>('getTab', { tabId });
      return success(result);
    },
  );

  // -------------------------------------------------------------------------
  // Open tab
  // -------------------------------------------------------------------------

  define(
    'browser_open_tab',
    {
      description:
        'Open a new browser tab. Optionally specify a URL, whether it should be active, ' +
        'pinned, or in a specific window.',
      inputSchema: {
        url: z.string().optional().describe('URL to open in the new tab (opens blank tab if omitted)'),
        active: z
          .boolean()
          .optional()
          .default(true)
          .describe('Whether the new tab should be active (focused). Default: true'),
        pinned: z.boolean().optional().describe('Whether the new tab should be pinned'),
        windowId: z.number().optional().describe('Window ID to open the tab in (current window if omitted)'),
      },
    },
    async ({ url, active, pinned, windowId }) => {
      const params: Record<string, unknown> = {};
      if (url !== undefined) params.url = url;
      if (active !== undefined) params.active = active;
      if (pinned !== undefined) params.pinned = pinned;
      if (windowId !== undefined) params.windowId = windowId;

      const result = await sendBrowserRequest<TabInfo>('openTab', params);
      return success(result);
    },
  );

  // -------------------------------------------------------------------------
  // Close tab
  // -------------------------------------------------------------------------

  define(
    'browser_close_tab',
    {
      description: 'Close one or more browser tabs by their IDs. Use browser_list_tabs to find tab IDs first.',
      inputSchema: {
        tabId: z.number().optional().describe('ID of a single tab to close'),
        tabIds: z
          .array(z.number())
          .optional()
          .describe('Array of tab IDs to close (for closing multiple tabs at once)'),
      },
    },
    async ({ tabId, tabIds }) => {
      const result = await sendBrowserRequest<{ closed: number[] }>('closeTab', { tabId, tabIds });
      return success(result);
    },
  );

  // -------------------------------------------------------------------------
  // Navigate tab
  // -------------------------------------------------------------------------

  define(
    'browser_navigate_tab',
    {
      description:
        'Navigate an existing browser tab to a new URL. The tab must already exist — ' +
        'use browser_list_tabs to find tab IDs or browser_open_tab to create a new tab.',
      inputSchema: {
        tabId: z.number().describe('ID of the tab to navigate'),
        url: z.string().describe('URL to navigate to'),
      },
    },
    async ({ tabId, url }) => {
      const result = await sendBrowserRequest<TabInfo>('navigateTab', {
        tabId,
        url,
      });
      return success(result);
    },
  );

  // -------------------------------------------------------------------------
  // Focus tab
  // -------------------------------------------------------------------------

  define(
    'browser_focus_tab',
    {
      description:
        'Focus (activate) a specific browser tab and bring its window to the foreground. ' +
        'Use browser_list_tabs to find tab IDs.',
      inputSchema: {
        tabId: z.number().describe('ID of the tab to focus'),
      },
    },
    async ({ tabId }) => {
      const result = await sendBrowserRequest<TabInfo>('focusTab', { tabId });
      return success(result);
    },
  );

  // -------------------------------------------------------------------------
  // Execute script in tab
  // -------------------------------------------------------------------------

  define(
    'browser_execute_script',
    {
      description:
        "Execute JavaScript code in a browser tab's page context (MAIN world). " +
        "The script runs with full access to the page's DOM, JavaScript objects, and APIs. " +
        'Console output (log, warn, error, info) is captured and returned alongside the result. ' +
        'Use this for debugging, inspecting page state, or performing actions not covered by other tools. ' +
        'Use browser_list_tabs to find the tabId first.',
      inputSchema: {
        tabId: z.number().describe('ID of the tab to execute the script in — find via browser_list_tabs'),
        script: z
          .string()
          .describe(
            'JavaScript code to execute. Can use await for async operations. ' +
              "The last expression's value is returned as the result. " +
              'Console methods (log, warn, error, info) are captured. ' +
              'Example: "return document.title" or "const resp = await fetch(\'/api/data\'); return await resp.json()"',
          ),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ tabId, script }) => {
      const result = await sendBrowserRequest<{
        result?: unknown;
        error?: string;
        logs: string[];
      }>('executeScript', { tabId, script });
      return success(result);
    },
  );

  return tools;
};
