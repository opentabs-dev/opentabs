import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, isPowerPointTab, isSharePoint, waitForAuth } from './powerpoint-api.js';
import { copyItem } from './tools/copy-item.js';
import { createFolder } from './tools/create-folder.js';
import { createPresentation } from './tools/create-presentation.js';
import { createSharingLink } from './tools/create-sharing-link.js';
import { deleteItem } from './tools/delete-item.js';
import { deletePermission } from './tools/delete-permission.js';
import { deleteSlide } from './tools/delete-slide.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getDownloadUrl } from './tools/get-download-url.js';
import { getDrive } from './tools/get-drive.js';
import { getItem } from './tools/get-item.js';
import { getPreviewUrl } from './tools/get-preview-url.js';
import { getSlideContent } from './tools/get-slide-content.js';
import { getSlideNotes } from './tools/get-slide-notes.js';
import { getSlides } from './tools/get-slides.js';
import { getThumbnails } from './tools/get-thumbnails.js';
import { listChildren } from './tools/list-children.js';
import { listPermissions } from './tools/list-permissions.js';
import { listRecent } from './tools/list-recent.js';
import { listSharedWithMe } from './tools/list-shared-with-me.js';
import { listVersions } from './tools/list-versions.js';
import { moveItem } from './tools/move-item.js';
import { renameItem } from './tools/rename-item.js';
import { searchFiles } from './tools/search-files.js';
import { updateSlideNotes } from './tools/update-slide-notes.js';
import { updateSlideText } from './tools/update-slide-text.js';

class PowerPointPlugin extends OpenTabsPlugin {
  readonly name = 'powerpoint';
  readonly description = 'OpenTabs plugin for Microsoft PowerPoint Online';
  override readonly displayName = 'PowerPoint Online';
  readonly urlPatterns = ['*://powerpoint.cloud.microsoft/*', '*://*.sharepoint.com/:p:/*'];
  override readonly homepage = 'https://powerpoint.cloud.microsoft';
  readonly tools: ToolDefinition[] = [
    // Account
    getCurrentUser,
    getDrive,
    // Files
    listChildren,
    listRecent,
    searchFiles,
    listSharedWithMe,
    getItem,
    getDownloadUrl,
    getThumbnails,
    renameItem,
    deleteItem,
    copyItem,
    moveItem,
    createFolder,
    // Presentations
    createPresentation,
    getPreviewUrl,
    // Slides
    getSlides,
    getSlideContent,
    updateSlideText,
    getSlideNotes,
    updateSlideNotes,
    deleteSlide,
    // Sharing
    listPermissions,
    createSharingLink,
    deletePermission,
    // Versions
    listVersions,
  ];

  async isReady(): Promise<boolean> {
    if (!isPowerPointTab()) return false;
    if (isAuthenticated()) return true;
    // On SharePoint/OneDrive-hosted presentations the Graph token is captured
    // asynchronously by the pre-script and may not have arrived yet. Report the
    // presentation page as ready so the plugin activates on load; tool handlers
    // surface a clear auth error if the token has not been captured.
    if (isSharePoint()) return true;
    return waitForAuth();
  }
}

export default new PowerPointPlugin();
