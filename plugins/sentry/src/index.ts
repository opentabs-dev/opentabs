import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isSentryAuthenticated, waitForSentryAuth } from './sentry-api.js';
import { createComment } from './tools/create-comment.js';
import { getEvent } from './tools/get-event.js';
import { getIssue } from './tools/get-issue.js';
import { getOrganization } from './tools/get-organization.js';
import { getProject } from './tools/get-project.js';
import { getProjectKeys } from './tools/get-project-keys.js';
import { getRelease } from './tools/get-release.js';
import { listAlerts } from './tools/list-alerts.js';
import { listComments } from './tools/list-comments.js';
import { listIssueEvents } from './tools/list-issue-events.js';
import { listIssueTags } from './tools/list-issue-tags.js';
import { listMembers } from './tools/list-members.js';
import { listMonitors } from './tools/list-monitors.js';
import { listOrganizations } from './tools/list-organizations.js';
import { listProjectEnvironments } from './tools/list-project-environments.js';
import { listProjects } from './tools/list-projects.js';
import { listReleases } from './tools/list-releases.js';
import { listReplays } from './tools/list-replays.js';
import { listTeams } from './tools/list-teams.js';
import { searchIssues } from './tools/search-issues.js';
import { updateIssue } from './tools/update-issue.js';

class SentryPlugin extends OpenTabsPlugin {
  readonly name = 'sentry';
  readonly description = 'OpenTabs plugin for Sentry';
  override readonly displayName = 'Sentry';
  readonly urlPatterns = ['*://*.sentry.io/*'];
  override readonly homepage = 'https://sentry.io';
  readonly tools: ToolDefinition[] = [
    // Issues
    searchIssues,
    getIssue,
    updateIssue,
    listIssueEvents,
    getEvent,
    listIssueTags,
    listComments,
    createComment,
    // Projects
    listProjects,
    getProject,
    getProjectKeys,
    listProjectEnvironments,
    // Organizations
    listOrganizations,
    getOrganization,
    listMembers,
    // Teams
    listTeams,
    // Releases
    listReleases,
    getRelease,
    // Alerts
    listAlerts,
    // Monitors (Crons)
    listMonitors,
    // Replays
    listReplays,
  ];

  async isReady(): Promise<boolean> {
    if (isSentryAuthenticated()) return true;
    return waitForSentryAuth();
  }
}

export default new SentryPlugin();
