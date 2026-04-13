import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated } from './lucid-api.js';

import { getCurrentUser } from './tools/get-current-user.js';
import { getAccount } from './tools/get-account.js';
import { listAccountUsers } from './tools/list-account-users.js';
import { getUserPermissions } from './tools/get-user-permissions.js';
import { listGroups } from './tools/list-groups.js';

import { listDocuments } from './tools/list-documents.js';
import { getDocument } from './tools/get-document.js';
import { searchDocuments } from './tools/search-documents.js';
import { createDocument } from './tools/create-document.js';
import { trashDocument } from './tools/trash-document.js';
import { getDocumentPages } from './tools/get-document-pages.js';
import { getDocumentRole } from './tools/get-document-role.js';
import { getDocumentStatus } from './tools/get-document-status.js';
import { getDocumentCount } from './tools/get-document-count.js';

import { listFolderEntries } from './tools/list-folder-entries.js';
import { getFolderEntry } from './tools/get-folder-entry.js';
import { createFolder } from './tools/create-folder.js';
import { renameFolder } from './tools/rename-folder.js';
import { deleteFolder } from './tools/delete-folder.js';
import { moveDocumentToFolder } from './tools/move-document-to-folder.js';

class LucidPlugin extends OpenTabsPlugin {
  readonly name = 'lucid';
  readonly description = 'OpenTabs plugin for Lucid (Lucidchart, Lucidspark)';
  override readonly displayName = 'Lucid';
  readonly urlPatterns = ['*://*.lucid.app/*'];
  override readonly homepage = 'https://lucid.app/documents';

  readonly tools: ToolDefinition[] = [
    getCurrentUser,
    getAccount,
    listAccountUsers,
    getUserPermissions,
    listGroups,
    listDocuments,
    getDocument,
    searchDocuments,
    createDocument,
    trashDocument,
    getDocumentPages,
    getDocumentRole,
    getDocumentStatus,
    getDocumentCount,
    listFolderEntries,
    getFolderEntry,
    createFolder,
    renameFolder,
    deleteFolder,
    moveDocumentToFolder,
  ];

  async isReady(): Promise<boolean> {
    return isAuthenticated();
  }
}

export default new LucidPlugin();
