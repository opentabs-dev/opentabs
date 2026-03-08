import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './bitbucket-api.js';

// Repositories
import { listRepositories } from './tools/list-repositories.js';
import { getRepository } from './tools/get-repository.js';
import { createRepository } from './tools/create-repository.js';

// Pull Requests
import { listPullRequests } from './tools/list-pull-requests.js';
import { getPullRequest } from './tools/get-pull-request.js';
import { createPullRequest } from './tools/create-pull-request.js';
import { updatePullRequest } from './tools/update-pull-request.js';
import { mergePullRequest } from './tools/merge-pull-request.js';
import { declinePullRequest } from './tools/decline-pull-request.js';
import { approvePullRequest } from './tools/approve-pull-request.js';
import { listPrComments } from './tools/list-pr-comments.js';
import { createPrComment } from './tools/create-pr-comment.js';
import { getPullRequestDiff } from './tools/get-pull-request-diff.js';

// Branches & Tags
import { listBranches } from './tools/list-branches.js';
import { createBranch } from './tools/create-branch.js';
import { deleteBranch } from './tools/delete-branch.js';
import { listTags } from './tools/list-tags.js';

// Commits
import { listCommits } from './tools/list-commits.js';
import { getCommit } from './tools/get-commit.js';

// Pipelines
import { listPipelines } from './tools/list-pipelines.js';
import { getPipeline } from './tools/get-pipeline.js';
import { listPipelineSteps } from './tools/list-pipeline-steps.js';

// Source
import { getFileContent } from './tools/get-file-content.js';
import { searchCode } from './tools/search-code.js';

// Workspaces
import { listWorkspaces } from './tools/list-workspaces.js';
import { listWorkspaceMembers } from './tools/list-workspace-members.js';

// Users
import { getUserProfile } from './tools/get-user-profile.js';

class BitbucketPlugin extends OpenTabsPlugin {
  readonly name = 'bitbucket';
  readonly description = 'OpenTabs plugin for Bitbucket';
  override readonly displayName = 'Bitbucket';
  readonly urlPatterns = ['*://*.bitbucket.org/*'];
  override readonly homepage = 'https://bitbucket.org';
  readonly tools: ToolDefinition[] = [
    // Repositories
    listRepositories,
    getRepository,
    createRepository,
    // Pull Requests
    listPullRequests,
    getPullRequest,
    createPullRequest,
    updatePullRequest,
    mergePullRequest,
    declinePullRequest,
    approvePullRequest,
    listPrComments,
    createPrComment,
    getPullRequestDiff,
    // Branches & Tags
    listBranches,
    createBranch,
    deleteBranch,
    listTags,
    // Commits
    listCommits,
    getCommit,
    // Pipelines
    listPipelines,
    getPipeline,
    listPipelineSteps,
    // Source
    getFileContent,
    searchCode,
    // Workspaces
    listWorkspaces,
    listWorkspaceMembers,
    // Users
    getUserProfile,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new BitbucketPlugin();
