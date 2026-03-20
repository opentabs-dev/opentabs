import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ConfigSchema, ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './confluence-api.js';
import { addLabel } from './tools/add-label.js';
import { createComment } from './tools/create-comment.js';
import { createPage } from './tools/create-page.js';
import { deleteComment } from './tools/delete-comment.js';
import { deletePage } from './tools/delete-page.js';
import { getPage } from './tools/get-page.js';
import { getPageChildren } from './tools/get-page-children.js';
import { getSpace } from './tools/get-space.js';
import { getUserProfile } from './tools/get-user-profile.js';
import { listComments } from './tools/list-comments.js';
import { listLabels } from './tools/list-labels.js';
import { listPageAttachments } from './tools/list-page-attachments.js';
import { listPageVersions } from './tools/list-page-versions.js';
import { listPages } from './tools/list-pages.js';
import { listSpaces } from './tools/list-spaces.js';
import { removeLabel } from './tools/remove-label.js';
import { search } from './tools/search.js';
import { updatePage } from './tools/update-page.js';

class ConfluencePlugin extends OpenTabsPlugin {
  readonly name = 'confluence';
  readonly description = 'OpenTabs plugin for Confluence';
  override readonly displayName = 'Confluence';
  readonly urlPatterns = ['*://*.atlassian.net/wiki/*'];
  override readonly configSchema: ConfigSchema = {
    instanceUrl: {
      type: 'url' as const,
      label: 'Confluence URL',
      description:
        'The URL of your self-hosted Confluence instance (e.g., https://confluence.example.com). Leave empty to use Confluence Cloud on atlassian.net.',
      required: false,
      placeholder: 'https://confluence.example.com',
    },
  };
  readonly tools: ToolDefinition[] = [
    listSpaces,
    getSpace,
    listPages,
    getPage,
    createPage,
    updatePage,
    deletePage,
    getPageChildren,
    listPageAttachments,
    listPageVersions,
    search,
    listComments,
    createComment,
    deleteComment,
    listLabels,
    addLabel,
    removeLabel,
    getUserProfile,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new ConfluencePlugin();
