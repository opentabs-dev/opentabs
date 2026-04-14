/**
 * browser_search_bookmarks — searches bookmarks via chrome.bookmarks API.
 */

import { z } from 'zod';
import { dispatchToExtension } from '../extension-protocol.js';
import { defineBrowserTool } from './definition.js';

const searchBookmarks = defineBrowserTool({
  name: 'browser_search_bookmarks',
  description:
    'Search bookmarks by query string. Matches against bookmark titles and URLs. ' +
    'Returns matching bookmarks with id, title, url, parentId, and dateAdded (ISO string).',
  summary: 'Search bookmarks',
  icon: 'bookmark',
  group: 'Bookmarks',
  input: z.object({
    query: z.string().describe('Text to search for in bookmark titles and URLs'),
  }),
  handler: async (args, state) => dispatchToExtension(state, 'browser.searchBookmarks', args),
});

export { searchBookmarks };
