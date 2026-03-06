import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './github-api.js';
import { addReaction } from './tools/add-reaction.js';
import { compareCommits } from './tools/compare-commits.js';
import { createComment } from './tools/create-comment.js';
import { createIssue } from './tools/create-issue.js';
import { createLabel } from './tools/create-label.js';
import { createOrUpdateFile } from './tools/create-or-update-file.js';
import { createPullRequest } from './tools/create-pull-request.js';
import { createRelease } from './tools/create-release.js';
import { createRepo } from './tools/create-repo.js';
import { deleteFile } from './tools/delete-file.js';
import { getFileContent } from './tools/get-file-content.js';
import { getIssue } from './tools/get-issue.js';
import { getPullRequest } from './tools/get-pull-request.js';
import { getPullRequestDiff } from './tools/get-pull-request-diff.js';
import { getRepo } from './tools/get-repo.js';
import { getUserProfile } from './tools/get-user-profile.js';
import { getWorkflowRun } from './tools/get-workflow-run.js';
import { listBranches } from './tools/list-branches.js';
import { listComments } from './tools/list-comments.js';
import { listCommits } from './tools/list-commits.js';
import { listIssues } from './tools/list-issues.js';
import { listLabels } from './tools/list-labels.js';
import { listNotifications } from './tools/list-notifications.js';
import { listOrgMembers } from './tools/list-org-members.js';
import { listPullRequestFiles } from './tools/list-pull-request-files.js';
import { listPullRequests } from './tools/list-pull-requests.js';
import { listReleases } from './tools/list-releases.js';
import { listRepos } from './tools/list-repos.js';
import { listWorkflowRuns } from './tools/list-workflow-runs.js';
import { mergePullRequest } from './tools/merge-pull-request.js';
import { requestPullRequestReview } from './tools/request-pull-request-review.js';
import { searchIssues } from './tools/search-issues.js';
import { searchRepos } from './tools/search-repos.js';
import { updateIssue } from './tools/update-issue.js';
import { updatePullRequest } from './tools/update-pull-request.js';

class GitHubPlugin extends OpenTabsPlugin {
  readonly name = 'github';
  readonly description = 'OpenTabs plugin for GitHub';
  override readonly displayName = 'GitHub';
  readonly urlPatterns = ['*://github.com/*'];
  readonly tools: ToolDefinition[] = [
    // Repositories
    listRepos,
    getRepo,
    createRepo,
    listCommits,
    compareCommits,
    listReleases,
    createRelease,
    // Issues
    listIssues,
    getIssue,
    createIssue,
    updateIssue,
    searchIssues,
    listLabels,
    createLabel,
    // Pull Requests
    listPullRequests,
    getPullRequest,
    createPullRequest,
    updatePullRequest,
    mergePullRequest,
    getPullRequestDiff,
    listPullRequestFiles,
    requestPullRequestReview,
    // Comments
    listComments,
    createComment,
    // Users & Orgs
    getUserProfile,
    listOrgMembers,
    // Branches
    listBranches,
    // Content
    getFileContent,
    createOrUpdateFile,
    deleteFile,
    // Actions
    listWorkflowRuns,
    getWorkflowRun,
    // Search
    searchRepos,
    // Interactions
    addReaction,
    listNotifications,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new GitHubPlugin();
