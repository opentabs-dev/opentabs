import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isFigmaAuthenticated, waitForFigmaAuth } from './figma-api.js';
import { createFile } from './tools/create-file.js';
import { getFile } from './tools/get-file.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getTeamInfo } from './tools/get-team-info.js';
import { listComments } from './tools/list-comments.js';
import { listFiles } from './tools/list-files.js';
import { listRecentFiles } from './tools/list-recent-files.js';
import { listTeams } from './tools/list-teams.js';
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
    listFiles,
    getFile,
    createFile,
    updateFile,
    trashFile,
    listComments,
    listRecentFiles,
  ];

  async isReady(): Promise<boolean> {
    if (isFigmaAuthenticated()) return true;
    return waitForFigmaAuth();
  }
}

export default new FigmaPlugin();
