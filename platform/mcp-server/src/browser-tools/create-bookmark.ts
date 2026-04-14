/**
 * browser_create_bookmark — creates a bookmark via chrome.bookmarks API.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const createBookmark = defineBrowserTool({
  name: 'browser_create_bookmark',
  description:
    'Create a new bookmark. Returns the created bookmark node with id, title, url, parentId, ' +
    'index, and dateAdded (ISO string). Optionally specify a parentId to place the bookmark ' +
    'in a specific folder (use browser_list_bookmark_tree to find folder IDs).',
  summary: 'Create a bookmark',
  icon: 'bookmark',
  group: 'Bookmarks',
  input: z.object({
    title: z.string().describe('Title of the bookmark'),
    url: z.string().describe('URL to bookmark'),
    parentId: z.string().optional().describe('ID of the parent folder (default: Other Bookmarks)'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.createBookmark', args),
});

export { createBookmark };
