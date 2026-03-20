import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ConfigSchema, ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './retool-api.js';
import { changeUserName } from './tools/change-user-name.js';
import { cloneApp } from './tools/clone-app.js';
import { createApp } from './tools/create-app.js';
import { createFolder } from './tools/create-folder.js';
import { createResourceFolder } from './tools/create-resource-folder.js';
import { deleteFolder } from './tools/delete-folder.js';
import { deleteResourceFolder } from './tools/delete-resource-folder.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getOrganization } from './tools/get-organization.js';
import { getSourceControlSettings } from './tools/get-source-control-settings.js';
import { listAgents } from './tools/list-agents.js';
import { listApps } from './tools/list-apps.js';
import { listBranches } from './tools/list-branches.js';
import { listEnvironments } from './tools/list-environments.js';
import { listExperiments } from './tools/list-experiments.js';
import { listPlaygroundQueries } from './tools/list-playground-queries.js';
import { listResources } from './tools/list-resources.js';
import { listUserSpaces } from './tools/list-user-spaces.js';
import { listWorkflows } from './tools/list-workflows.js';
import { moveResourceToFolder } from './tools/move-resource-to-folder.js';
import { renameFolder } from './tools/rename-folder.js';

class RetoolPlugin extends OpenTabsPlugin {
  readonly name = 'retool';
  readonly description = 'OpenTabs plugin for Retool';
  override readonly displayName = 'Retool';
  readonly urlPatterns = ['*://*.retool.com/*'];
  override readonly homepage = 'https://retool.com';
  override readonly configSchema: ConfigSchema = {
    instanceUrl: {
      type: 'url' as const,
      label: 'Retool URL',
      description:
        'The URL of your self-hosted Retool instance (e.g., https://retool.example.com). Leave empty to use retool.com.',
      required: false,
      placeholder: 'https://retool.example.com',
    },
  };
  readonly tools: ToolDefinition[] = [
    // Users
    getCurrentUser,
    changeUserName,
    // Organization
    getOrganization,
    listUserSpaces,
    listExperiments,
    // Apps
    listApps,
    createApp,
    cloneApp,
    // Folders
    createFolder,
    renameFolder,
    deleteFolder,
    // Resources
    listResources,
    createResourceFolder,
    deleteResourceFolder,
    moveResourceToFolder,
    // Workflows
    listWorkflows,
    // Environments
    listEnvironments,
    // Source Control
    listBranches,
    getSourceControlSettings,
    // Playground
    listPlaygroundQueries,
    // Agents
    listAgents,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new RetoolPlugin();
