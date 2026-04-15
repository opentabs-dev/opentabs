import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ConfigSchema, ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { clearAuth, isAuthenticated, waitForAuth } from './sqlpad-api.js';

// Account
import { getCurrentUser } from './tools/get-current-user.js';
import { listUsers } from './tools/list-users.js';

// Connections
import { getSchema } from './tools/get-schema.js';
import { listConnections } from './tools/list-connections.js';

// Queries
import { runQueryTool } from './tools/run-query.js';

// Saved Queries
import { createSavedQuery } from './tools/create-saved-query.js';
import { deleteSavedQuery } from './tools/delete-saved-query.js';
import { getSavedQuery } from './tools/get-saved-query.js';
import { listSavedQueries } from './tools/list-saved-queries.js';
import { listTags } from './tools/list-tags.js';
import { updateSavedQuery } from './tools/update-saved-query.js';

// History
import { listQueryHistory } from './tools/list-query-history.js';

class SqlpadPlugin extends OpenTabsPlugin {
  readonly name = 'sqlpad';
  readonly description =
    'OpenTabs plugin for SQLPad — run SQL queries, browse database schemas, and manage saved queries.';
  override readonly displayName = 'SQLPad';
  readonly urlPatterns: string[] = [];
  override readonly configSchema: ConfigSchema = {
    instanceUrl: {
      type: 'url' as const,
      label: 'SQLPad URL',
      description: 'The URL of your SQLPad instance (e.g., https://sqlpad.example.com)',
      required: true,
      placeholder: 'https://sqlpad.example.com',
    },
  };

  readonly tools: ToolDefinition[] = [
    // Account
    getCurrentUser,
    listUsers,
    // Connections
    listConnections,
    getSchema,
    // Queries
    runQueryTool,
    // Saved Queries
    listSavedQueries,
    getSavedQuery,
    createSavedQuery,
    updateSavedQuery,
    deleteSavedQuery,
    listTags,
    // History
    listQueryHistory,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }

  override teardown(): void {
    clearAuth();
  }
}

export default new SqlpadPlugin();
