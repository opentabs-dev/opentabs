import { success, sendBrowserRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

interface TabInfo {
  id: number;
  windowId: number;
  url?: string;
  title?: string;
  active: boolean;
  pinned: boolean;
  incognito: boolean;
  status?: string;
  favIconUrl?: string;
  index: number;
}

interface ScriptResult {
  result?: unknown;
  error?: string;
  logs: string[];
}

export const registerBrowserTabsTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List tabs
  define(
    'browser_list_tabs',
    {
      description:
        'List open browser tabs. Returns tab ID, URL, title, and status for each tab. ' +
        'Use filters to narrow results (e.g., only active tabs, tabs in current window, or tabs matching a URL pattern). ' +
        'Tab IDs from results can be used with other browser_* tools.',
      inputSchema: {
        windowId: z.number().optional().describe('Filter to tabs in a specific window'),
        active: z.boolean().optional().describe('Filter to only active tabs (one per window)'),
        pinned: z.boolean().optional().describe('Filter to only pinned tabs'),
        url: z
          .string()
          .optional()
          .describe('URL pattern to match (supports Chrome match patterns, e.g., "*://github.com/*")'),
        currentWindow: z.boolean().optional().describe('Filter to tabs in the currently focused window'),
      },
    },
    async ({ windowId, active, pinned, url, currentWindow }) => {
      const result = await sendBrowserRequest<{ tabs: TabInfo[] }>('listTabs', {
        windowId,
        active,
        pinned,
        url,
        currentWindow,
      });
      return success(result);
    },
  );

  // Get tab details
  define(
    'browser_get_tab',
    {
      description:
        'Get detailed information about a specific browser tab by its ID. ' +
        'Returns URL, title, active/pinned status, and more. ' +
        'Use browser_list_tabs first to find tab IDs.',
      inputSchema: {
        tabId: z.number().describe('The tab ID to get info for'),
      },
    },
    async ({ tabId }) => {
      const result = await sendBrowserRequest<TabInfo>('getTab', { tabId });
      return success(result);
    },
  );

  // Open a new tab
  define(
    'browser_open_tab',
    {
      description:
        'Open a new browser tab with an optional URL. ' +
        'Returns the new tab info including its ID for use with other browser_* tools. ' +
        'By default opens in the current window and becomes the active tab.',
      inputSchema: {
        url: z.string().optional().describe('URL to open (opens blank tab if omitted)'),
        active: z.boolean().optional().default(true).describe('Whether the tab should become active (default: true)'),
        pinned: z.boolean().optional().default(false).describe('Whether to pin the tab (default: false)'),
        windowId: z.number().optional().describe('Window to open the tab in (default: current window)'),
      },
    },
    async ({ url, active, pinned, windowId }) => {
      const result = await sendBrowserRequest<TabInfo>('openTab', { url, active, pinned, windowId });
      return success(result);
    },
  );

  // Close tab(s)
  define(
    'browser_close_tab',
    {
      description:
        'Close one or more browser tabs by ID. ' +
        'Use browser_list_tabs to find tab IDs first. ' +
        'Provide either a single tabId or an array of tabIds to close multiple tabs at once.',
      inputSchema: {
        tabId: z.number().optional().describe('Single tab ID to close'),
        tabIds: z.array(z.number()).optional().describe('Array of tab IDs to close (for bulk close)'),
      },
    },
    async ({ tabId, tabIds }) => {
      const result = await sendBrowserRequest<{ closed: number[] }>('closeTab', { tabId, tabIds });
      return success(result);
    },
  );

  // Navigate an existing tab to a new URL
  define(
    'browser_navigate_tab',
    {
      description:
        'Navigate an existing browser tab to a new URL. ' +
        'Use this instead of browser_open_tab when you want to reuse an existing tab. ' +
        'Use browser_list_tabs to find tab IDs first.',
      inputSchema: {
        tabId: z.number().describe('The tab ID to navigate'),
        url: z.string().describe('The URL to navigate to'),
      },
    },
    async ({ tabId, url }) => {
      const result = await sendBrowserRequest<TabInfo>('navigateTab', { tabId, url });
      return success(result);
    },
  );

  // Focus a tab (activate + bring window to front)
  define(
    'browser_focus_tab',
    {
      description:
        'Focus a browser tab by making it active and bringing its window to the front. ' +
        'Use browser_list_tabs to find tab IDs first.',
      inputSchema: {
        tabId: z.number().describe('The tab ID to focus'),
      },
    },
    async ({ tabId }) => {
      const result = await sendBrowserRequest<TabInfo>('focusTab', { tabId });
      return success(result);
    },
  );

  // Execute script in a tab's page context (MAIN world)
  define(
    'browser_execute_script',
    {
      description:
        "Execute JavaScript code in any browser tab's page context (MAIN world). " +
        "Runs with full access to the page's window, document, localStorage, and session cookies. " +
        'Use browser_list_tabs to find the tab ID for the page you want to target.\n\n' +
        'The script runs in an async function context, so you can use await. ' +
        'It should return a JSON-serializable value.\n\n' +
        'Console output (console.log, console.warn, console.error, console.info) is captured and returned in the logs array.\n\n' +
        'Example scripts:\n' +
        '- "return window.location.href" — get the current URL\n' +
        '- "return document.cookie" — get cookies\n' +
        '- "return Object.keys(localStorage)" — list localStorage keys\n' +
        "- \"const r = await fetch('/api/me', {credentials:'include'}); return r.json()\" — make an authenticated API call\n\n" +
        'WARNING: This tool executes arbitrary code in the target page. Use with caution.',
      inputSchema: {
        tabId: z.coerce.number().describe('Tab ID to execute the script in (use browser_list_tabs to find tab IDs)'),
        script: z.string().describe('JavaScript code to execute. Must return a JSON-serializable value.'),
      },
    },
    async ({ tabId, script }) => {
      const result = await sendBrowserRequest<ScriptResult>('executeScript', { tabId, script });
      return success(result);
    },
  );

  return tools;
};
