import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isFigmaAuthenticated, waitForFigmaAuth } from './figma-api.js';
import { createFile } from './tools/create-file.js';
import { getFile } from './tools/get-file.js';
import { getFileComponents } from './tools/get-file-components.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getTeamInfo } from './tools/get-team-info.js';
import { listComments } from './tools/list-comments.js';
import { listFiles } from './tools/list-files.js';
import { listFileVersions } from './tools/list-file-versions.js';
import { listRecentFiles } from './tools/list-recent-files.js';
import { listTeamProjects } from './tools/list-team-projects.js';
import { listTeams } from './tools/list-teams.js';
import { postComment } from './tools/post-comment.js';
import { trashFile } from './tools/trash-file.js';
import { updateFile } from './tools/update-file.js';

class FigmaPlugin extends OpenTabsPlugin {
  readonly name = 'figma';
  readonly description = 'OpenTabs plugin for Figma';
  override readonly displayName = 'Figma';
  readonly urlPatterns = ['*://*.figma.com/*'];
  readonly tools: ToolDefinition[] = [
    getCurrentUser,
    listTeams,
    getTeamInfo,
    listTeamProjects,
    listFiles,
    getFile,
    getFileComponents,
    listFileVersions,
    createFile,
    updateFile,
    trashFile,
    listComments,
    postComment,
    listRecentFiles,
  ];

  async isReady(): Promise<boolean> {
    if (isFigmaAuthenticated()) return true;
    return waitForFigmaAuth();
  }
}

export default new FigmaPlugin();
