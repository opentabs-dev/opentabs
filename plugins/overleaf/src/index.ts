import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './overleaf-api.js';
import { getPdf } from './tools/get-pdf.js';
import { getProjectTool } from './tools/get-project.js';
import { listProjects } from './tools/list-projects.js';
import { readFile } from './tools/read-file.js';
import { searchProject } from './tools/search-project.js';

class OverleafPlugin extends OpenTabsPlugin {
  readonly name = 'overleaf';
  readonly description = 'Read Overleaf projects and source, search files, and obtain a fresh compiled PDF';
  override readonly displayName = 'Overleaf';
  readonly urlPatterns = ['https://www.overleaf.com/*', 'https://overleaf.com/*'];
  override readonly homepage = 'https://www.overleaf.com/project';
  readonly tools: ToolDefinition[] = [listProjects, getProjectTool, readFile, searchProject, getPdf];

  async isReady(): Promise<boolean> {
    return isAuthenticated() || waitForAuth();
  }
}

export default new OverleafPlugin();
