import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, isSharePointDocument, waitForAuth } from './microsoft-word-api.js';
import { appendToDocument } from './tools/append-to-document.js';
import { copyItem } from './tools/copy-item.js';
import { createDocument } from './tools/create-document.js';
import { createFolder } from './tools/create-folder.js';
import { createSharingLink } from './tools/create-sharing-link.js';
import { deleteItem } from './tools/delete-item.js';
import { deletePermission } from './tools/delete-permission.js';
import { getActiveDocument } from './tools/get-active-document.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getDocumentText } from './tools/get-document-text.js';
import { getDrive } from './tools/get-drive.js';
import { getFileContent } from './tools/get-file-content.js';
import { getItem } from './tools/get-item.js';
import { getPreviewUrl } from './tools/get-preview-url.js';
import { listChildren } from './tools/list-children.js';
import { listPermissions } from './tools/list-permissions.js';
import { listRecentDocuments } from './tools/list-recent-documents.js';
import { listSharedWithMe } from './tools/list-shared-with-me.js';
import { listVersions } from './tools/list-versions.js';
import { moveItem } from './tools/move-item.js';
import { reauthenticate } from './tools/reauthenticate.js';
import { renameItem } from './tools/rename-item.js';
import { replaceTextInDocument } from './tools/replace-text-in-document.js';
import { restoreVersion } from './tools/restore-version.js';
import { searchFiles } from './tools/search-files.js';
import { updateDocument } from './tools/update-document.js';
import { updateFileContent } from './tools/update-file-content.js';
import { uploadFile } from './tools/upload-file.js';

class MicrosoftWordPlugin extends OpenTabsPlugin {
  readonly name = 'microsoft-word';
  readonly description = 'OpenTabs plugin for Microsoft Word Online';
  override readonly displayName = 'Microsoft Word';
  readonly urlPatterns = ['*://word.cloud.microsoft/*', '*://*.sharepoint.com/:w:/*'];
  override readonly homepage = 'https://word.cloud.microsoft';
  readonly tools: ToolDefinition[] = [
    // Account
    getCurrentUser,
    reauthenticate,
    // Drive
    getDrive,
    // Documents — the core document editing tools
    getActiveDocument,
    getDocumentText,
    createDocument,
    updateDocument,
    appendToDocument,
    replaceTextInDocument,
    getFileContent,
    // Files
    listRecentDocuments,
    listChildren,
    getItem,
    searchFiles,
    createFolder,
    uploadFile,
    updateFileContent,
    renameItem,
    moveItem,
    copyItem,
    deleteItem,
    listSharedWithMe,
    getPreviewUrl,
    // Sharing
    createSharingLink,
    listPermissions,
    deletePermission,
    // Versions
    listVersions,
    restoreVersion,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    // On SharePoint/OneDrive-hosted documents the Graph token is captured
    // asynchronously by the pre-script and may not have arrived yet. Report the
    // document page as ready so the plugin activates on load; tool handlers
    // surface a clear auth error if the token has not been captured.
    if (isSharePointDocument()) return true;
    return waitForAuth();
  }
}

export default new MicrosoftWordPlugin();
