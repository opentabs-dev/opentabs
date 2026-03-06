import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './notion-api.js';
import { search } from './tools/search.js';
import { listPages } from './tools/list-pages.js';
import { getPage } from './tools/get-page.js';
import { getBlockChildren } from './tools/get-block-children.js';
import { createPage } from './tools/create-page.js';
import { updatePage } from './tools/update-page.js';
import { deletePage } from './tools/delete-page.js';
import { appendBlock } from './tools/append-block.js';
import { updateBlock } from './tools/update-block.js';
import { deleteBlock } from './tools/delete-block.js';
import { getUser } from './tools/get-user.js';
import { listUsers } from './tools/list-users.js';
import { getDatabase } from './tools/get-database.js';
import { queryDatabase } from './tools/query-database.js';
import { createDatabaseItem } from './tools/create-database-item.js';
import { updateDatabaseItem } from './tools/update-database-item.js';
import { listDatabases } from './tools/list-databases.js';
import { createDatabase } from './tools/create-database.js';

class NotionPlugin extends OpenTabsPlugin {
  readonly name = 'notion';
  readonly description = 'OpenTabs plugin for Notion';
  override readonly displayName = 'Notion';
  readonly urlPatterns = ['*://*.notion.so/*'];
  readonly tools: ToolDefinition[] = [
    search,
    listPages,
    getPage,
    getBlockChildren,
    createPage,
    updatePage,
    deletePage,
    appendBlock,
    updateBlock,
    deleteBlock,
    getUser,
    listUsers,
    getDatabase,
    queryDatabase,
    createDatabaseItem,
    updateDatabaseItem,
    listDatabases,
    createDatabase,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new NotionPlugin();
