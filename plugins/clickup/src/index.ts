import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './clickup-api.js';

// User
import { getCurrentUser } from './tools/get-current-user.js';

// Workspaces
import { getWorkspace } from './tools/get-workspace.js';
import { getWorkspaceMembers } from './tools/get-workspace-members.js';

// Spaces
import { getSpaces } from './tools/get-spaces.js';
import { getSpace } from './tools/get-space.js';

// Folders
import { getFolders } from './tools/get-folders.js';
import { getFolder } from './tools/get-folder.js';

// Lists
import { getLists } from './tools/get-lists.js';
import { getList } from './tools/get-list.js';

// Goals
import { getGoals } from './tools/get-goals.js';

// Custom Fields
import { getCustomFields } from './tools/get-custom-fields.js';

class ClickUpPlugin extends OpenTabsPlugin {
  readonly name = 'clickup';
  readonly description = 'OpenTabs plugin for ClickUp';
  override readonly displayName = 'ClickUp';
  readonly urlPatterns = ['*://app.clickup.com/*'];
  override readonly homepage = 'https://app.clickup.com';
  readonly tools: ToolDefinition[] = [
    // User
    getCurrentUser,

    // Workspaces
    getWorkspace,
    getWorkspaceMembers,

    // Spaces
    getSpaces,
    getSpace,

    // Folders
    getFolders,
    getFolder,

    // Lists
    getLists,
    getList,

    // Goals
    getGoals,

    // Custom Fields
    getCustomFields,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new ClickUpPlugin();
