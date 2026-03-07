import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { getDeployment } from './tools/get-deployment.js';
import { getProject } from './tools/get-project.js';
import { getUser } from './tools/get-user.js';
import { listDeployments } from './tools/list-deployments.js';
import { listDomains } from './tools/list-domains.js';
import { listEnvVars } from './tools/list-env-vars.js';
import { listProjects } from './tools/list-projects.js';
import { listTeams } from './tools/list-teams.js';
import { isVercelAuthenticated, waitForVercelAuth } from './vercel-api.js';

class VercelPlugin extends OpenTabsPlugin {
  readonly name = 'vercel';
  readonly description = 'OpenTabs plugin for Vercel';
  override readonly displayName = 'Vercel';
  readonly urlPatterns = ['*://vercel.com/*'];
  readonly homepage = 'https://vercel.com/dashboard';
  readonly tools: ToolDefinition[] = [
    // Projects
    listProjects,
    getProject,
    // Deployments
    listDeployments,
    getDeployment,
    // Domains
    listDomains,
    // Environment Variables
    listEnvVars,
    // Account
    getUser,
    listTeams,
  ];

  async isReady(): Promise<boolean> {
    if (isVercelAuthenticated()) return true;
    return waitForVercelAuth();
  }
}

export default new VercelPlugin();
