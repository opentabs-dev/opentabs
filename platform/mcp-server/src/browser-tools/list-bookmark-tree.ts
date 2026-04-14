/**
 * browser_list_bookmark_tree — lists bookmark tree via chrome.bookmarks API.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const listBookmarkTree = defineBrowserTool({
  name: 'browser_list_bookmark_tree',
  description:
    'List the bookmark tree structure. Returns bookmark folders and their children up to a max depth of 3. ' +
    'Optionally specify a parentId to get a subtree. Each node has id, title, url (if a bookmark), ' +
    'dateAdded (ISO string), and children (if a folder). Use this to discover folder IDs for browser_create_bookmark.',
  summary: 'List bookmark tree',
  icon: 'bookmark',
  group: 'Bookmarks',
  input: z.object({
    parentId: z.string().optional().describe('ID of the parent node to get subtree for (default: full tree)'),
    maxDepth: z.number().int().positive().optional().describe('Maximum depth of the tree to return (default: 3)'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.listBookmarkTree', args),
});

export { listBookmarkTree };
