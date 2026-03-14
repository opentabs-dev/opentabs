import { z } from 'zod';

// --- Shared schemas ---

export const repositorySchema = z.object({
  id: z.number().describe('Repository ID'),
  name: z.string().describe('Repository name'),
  full_name: z.string().describe('Full name in owner/repo format'),
  description: z.string().describe('Repository description'),
  private: z.boolean().describe('Whether the repository is private'),
  html_url: z.string().describe('URL to the repository on GitHub'),
  default_branch: z.string().describe('Default branch name'),
  language: z.string().describe('Primary programming language'),
  stargazers_count: z.number().describe('Number of stars'),
  forks_count: z.number().describe('Number of forks'),
  open_issues_count: z.number().describe('Number of open issues'),
  archived: z.boolean().describe('Whether the repository is archived'),
  updated_at: z.string().describe('Last updated ISO 8601 timestamp'),
});

export const issueSchema = z.object({
  number: z.number().describe('Issue number'),
  title: z.string().describe('Issue title'),
  state: z.string().describe('Issue state: open or closed'),
  body: z.string().describe('Issue body in Markdown'),
  html_url: z.string().describe('URL to the issue on GitHub'),
  user_login: z.string().describe('Login of the user who created the issue'),
  labels: z.array(z.string()).describe('Label names'),
  assignees: z.array(z.string()).describe('Assignee logins'),
  comments: z.number().describe('Number of comments'),
  created_at: z.string().describe('Created ISO 8601 timestamp'),
  updated_at: z.string().describe('Updated ISO 8601 timestamp'),
  closed_at: z.string().describe('Closed ISO 8601 timestamp or empty string'),
  is_pull_request: z.boolean().describe('Whether this is a pull request'),
});

export const pullRequestSchema = z.object({
  number: z.number().describe('Pull request number'),
  title: z.string().describe('Pull request title'),
  state: z.string().describe('PR state: open, closed, or merged'),
  body: z.string().describe('Pull request body in Markdown'),
  html_url: z.string().describe('URL to the PR on GitHub'),
  user_login: z.string().describe('Login of the user who created the PR'),
  head_ref: z.string().describe('Source branch name'),
  base_ref: z.string().describe('Target branch name'),
  labels: z.array(z.string()).describe('Label names'),
  draft: z.boolean().describe('Whether this is a draft PR'),
  merged: z.boolean().describe('Whether this PR has been merged'),
  mergeable: z.boolean().describe('Whether this PR can be merged'),
  comments: z.number().describe('Number of comments'),
  commits: z.number().describe('Number of commits'),
  additions: z.number().describe('Number of lines added'),
  deletions: z.number().describe('Number of lines deleted'),
  changed_files: z.number().describe('Number of files changed'),
  created_at: z.string().describe('Created ISO 8601 timestamp'),
  updated_at: z.string().describe('Updated ISO 8601 timestamp'),
});

export const commentSchema = z.object({
  id: z.number().describe('Comment ID'),
  body: z.string().describe('Comment body in Markdown'),
  user_login: z.string().describe('Login of the commenter'),
  html_url: z.string().describe('URL to the comment on GitHub'),
  created_at: z.string().describe('Created ISO 8601 timestamp'),
  updated_at: z.string().describe('Updated ISO 8601 timestamp'),
});

export const userSchema = z.object({
  login: z.string().describe('Username'),
  id: z.number().describe('User ID'),
  name: z.string().describe('Display name'),
  bio: z.string().describe('User bio'),
  company: z.string().describe('Company name'),
  location: z.string().describe('Location'),
  email: z.string().describe('Public email address'),
  html_url: z.string().describe('URL to the profile on GitHub'),
  avatar_url: z.string().describe('Avatar image URL'),
  public_repos: z.number().describe('Number of public repositories'),
  followers: z.number().describe('Number of followers'),
  following: z.number().describe('Number of users being followed'),
  created_at: z.string().describe('Account created ISO 8601 timestamp'),
});

export const branchSchema = z.object({
  name: z.string().describe('Branch name'),
  protected: z.boolean().describe('Whether the branch is protected'),
  sha: z.string().describe('SHA of the branch HEAD commit'),
});

export const notificationSchema = z.object({
  id: z.string().describe('Notification ID'),
  reason: z.string().describe('Reason for the notification (e.g., subscribed, mention, review_requested)'),
  unread: z.boolean().describe('Whether the notification is unread'),
  subject_title: z.string().describe('Subject title'),
  subject_type: z.string().describe('Subject type (e.g., Issue, PullRequest, Release)'),
  subject_url: z.string().describe('API URL for the subject'),
  repository_full_name: z.string().describe('Full name of the repository'),
  updated_at: z.string().describe('Updated ISO 8601 timestamp'),
});

// --- Defensive mappers ---

// Repo mapper handles both REST API and same-origin page JSON shapes
export interface RawRepo {
  id?: number;
  name?: string;
  full_name?: string;
  description?: string | null;
  private?: boolean;
  html_url?: string;
  default_branch?: string;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  archived?: boolean;
  updated_at?: string;
  // Same-origin search shape
  hl_name?: string;
  hl_trunc_description?: string;
  public?: boolean;
  followers?: number;
  repo?: { repository?: { id?: number; name?: string; owner_login?: string; updated_at?: string } };
}

export const mapRepository = (r: RawRepo) => ({
  id: r.id ?? r.repo?.repository?.id ?? 0,
  name: r.name ?? r.repo?.repository?.name ?? '',
  full_name: r.full_name ?? r.hl_name?.replace(/<\/?em>/g, '') ?? '',
  description: r.description ?? r.hl_trunc_description ?? '',
  private: r.private ?? r.public === false,
  html_url:
    r.html_url ??
    (r.repo?.repository ? `https://github.com/${r.repo.repository.owner_login}/${r.repo.repository.name}` : ''),
  default_branch: r.default_branch ?? '',
  language: r.language ?? '',
  stargazers_count: r.stargazers_count ?? r.followers ?? 0,
  forks_count: r.forks_count ?? 0,
  open_issues_count: r.open_issues_count ?? 0,
  archived: r.archived ?? false,
  updated_at: r.updated_at ?? r.repo?.repository?.updated_at ?? '',
});

// Relay GraphQL label edge shape
interface RawRelayLabelEdge {
  node?: { name?: string };
}

// Relay GraphQL label connection shape
interface RawRelayLabels {
  edges?: RawRelayLabelEdge[];
}

// Issue/PR mapper handles both REST API and Relay GraphQL shapes
// Relay shape from IssueIndexPageQuery:
// { __typename, id, number, title, author: { login }, labels: { edges }, createdAt, updatedAt,
//   closed, closedAt, isDraft, pullRequestState, milestone }
export interface RawIssueOrPR {
  // REST API fields
  number?: number;
  title?: string;
  state?: string;
  body?: string | null;
  html_url?: string;
  user?: { login?: string } | null;
  labels?: Array<{ name?: string }>;
  assignees?: Array<{ login?: string }>;
  comments?: number;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  pull_request?: unknown;
  head?: { ref?: string };
  base?: { ref?: string };
  draft?: boolean;
  merged?: boolean;
  mergeable?: boolean | null;
  commits?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  // Relay GraphQL fields
  __typename?: string;
  author?: { login?: string; name?: string; displayName?: string };
  createdAt?: string;
  updatedAt?: string;
  closed?: boolean;
  closedAt?: string | null;
  isDraft?: boolean;
  pullRequestState?: string;
  milestone?: { title?: string } | null;
  // Same-origin page embedded data fields (PR detail layout)
  baseBranch?: string;
  headBranch?: string;
  commitsCount?: number;
  mergedBy?: { login?: string } | null;
  mergedTime?: string | null;
  // Same-origin page embedded data fields (PR files)
  diffSummaries?: Array<{
    path?: string;
    linesAdded?: number;
    linesDeleted?: number;
    changeType?: string;
  }>;
  // Relay label edges
  relayLabels?: RawRelayLabels;
  // Repository context for building URLs
  repository?: {
    name?: string;
    owner?: { login?: string; __typename?: string };
  };
}

export const mapIssue = (i: RawIssueOrPR, repoContext?: { owner: string; repo: string }) => {
  const owner = repoContext?.owner ?? i.repository?.owner?.login ?? '';
  const repo = repoContext?.repo ?? i.repository?.name ?? '';
  const num = i.number ?? 0;
  const isRelay = !!i.__typename;
  const isClosed = isRelay ? (i.closed ?? false) : i.state === 'closed';
  const state = isClosed ? 'closed' : 'open';
  const isPR = isRelay ? i.__typename === 'PullRequest' : i.pull_request !== undefined && i.pull_request !== null;

  // Extract labels from either REST or Relay format
  const labels = i.relayLabels?.edges
    ? i.relayLabels.edges.map(e => e.node?.name ?? '').filter(Boolean)
    : (i.labels ?? []).map(l => l.name ?? '');

  return {
    number: num,
    title: i.title ?? '',
    state,
    body: i.body ?? '',
    html_url: i.html_url ?? (owner && repo && num ? `https://github.com/${owner}/${repo}/issues/${num}` : ''),
    user_login: i.user?.login ?? i.author?.login ?? '',
    labels,
    assignees: (i.assignees ?? []).map(a => a.login ?? ''),
    comments: i.comments ?? 0,
    created_at: i.created_at ?? i.createdAt ?? '',
    updated_at: i.updated_at ?? i.updatedAt ?? '',
    closed_at: i.closed_at ?? i.closedAt ?? '',
    is_pull_request: isPR,
  };
};

export const mapPullRequest = (pr: RawIssueOrPR, repoContext?: { owner: string; repo: string }) => {
  const owner = repoContext?.owner ?? pr.repository?.owner?.login ?? '';
  const repo = repoContext?.repo ?? pr.repository?.name ?? '';
  const num = pr.number ?? 0;
  const isRelay = !!pr.__typename;

  // Determine state from various sources
  const relayState = pr.pullRequestState?.toLowerCase();
  const mergedByRelay = relayState === 'merged';
  const mergedByRest = pr.merged ?? false;
  const mergedByPage = pr.mergedTime !== undefined && pr.mergedTime !== null;
  const isMerged = mergedByRelay || mergedByRest || mergedByPage;

  let state: string;
  if (isMerged) {
    state = 'merged';
  } else if (isRelay) {
    state = relayState ?? (pr.closed ? 'closed' : 'open');
  } else {
    state = pr.state ?? 'open';
  }

  // Extract labels from either REST or Relay format
  const labels = pr.relayLabels?.edges
    ? pr.relayLabels.edges.map(e => e.node?.name ?? '').filter(Boolean)
    : (pr.labels ?? []).map(l => l.name ?? '');

  // Compute diff stats from diffSummaries if available
  let additions = pr.additions ?? 0;
  let deletions = pr.deletions ?? 0;
  let changedFiles = pr.changed_files ?? 0;
  if (pr.diffSummaries?.length) {
    additions = pr.diffSummaries.reduce((sum, d) => sum + (d.linesAdded ?? 0), 0);
    deletions = pr.diffSummaries.reduce((sum, d) => sum + (d.linesDeleted ?? 0), 0);
    changedFiles = pr.diffSummaries.length;
  }

  return {
    number: num,
    title: pr.title ?? '',
    state,
    body: pr.body ?? '',
    html_url: pr.html_url ?? (owner && repo && num ? `https://github.com/${owner}/${repo}/pull/${num}` : ''),
    user_login: pr.user?.login ?? pr.author?.login ?? '',
    head_ref: pr.head?.ref ?? pr.headBranch ?? '',
    base_ref: pr.base?.ref ?? pr.baseBranch ?? '',
    labels,
    draft: pr.draft ?? pr.isDraft ?? false,
    merged: isMerged,
    mergeable: pr.mergeable ?? false,
    comments: pr.comments ?? 0,
    commits: pr.commits ?? pr.commitsCount ?? 0,
    additions,
    deletions,
    changed_files: changedFiles,
    created_at: pr.created_at ?? pr.createdAt ?? '',
    updated_at: pr.updated_at ?? pr.updatedAt ?? '',
  };
};

interface RawComment {
  id?: number;
  body?: string;
  user?: { login?: string } | null;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
}

export const mapComment = (c: RawComment) => ({
  id: c.id ?? 0,
  body: c.body ?? '',
  user_login: c.user?.login ?? '',
  html_url: c.html_url ?? '',
  created_at: c.created_at ?? '',
  updated_at: c.updated_at ?? '',
});

interface RawUserProfile {
  login?: string;
  id?: number;
  name?: string | null;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  email?: string | null;
  html_url?: string;
  avatar_url?: string;
  public_repos?: number;
  followers?: number;
  following?: number;
  created_at?: string;
}

export const mapUser = (u: RawUserProfile) => ({
  login: u.login ?? '',
  id: u.id ?? 0,
  name: u.name ?? '',
  bio: u.bio ?? '',
  company: u.company ?? '',
  location: u.location ?? '',
  email: u.email ?? '',
  html_url: u.html_url ?? '',
  avatar_url: u.avatar_url ?? '',
  public_repos: u.public_repos ?? 0,
  followers: u.followers ?? 0,
  following: u.following ?? 0,
  created_at: u.created_at ?? '',
});

// Branch mapper handles same-origin page JSON shape
// { name, isDefault, isProtected, oid, author, date, behindBy, aheadBy }
export interface RawBranch {
  name?: string;
  protected?: boolean;
  isProtected?: boolean;
  commit?: { sha?: string };
  oid?: string;
}

export const mapBranch = (b: RawBranch) => ({
  name: b.name ?? '',
  protected: b.protected ?? b.isProtected ?? false,
  sha: b.commit?.sha ?? b.oid ?? '',
});

interface RawNotification {
  id?: string;
  reason?: string;
  unread?: boolean;
  subject?: { title?: string; type?: string; url?: string };
  repository?: { full_name?: string };
  updated_at?: string;
}

export const mapNotification = (n: RawNotification) => ({
  id: n.id ?? '',
  reason: n.reason ?? '',
  unread: n.unread ?? false,
  subject_title: n.subject?.title ?? '',
  subject_type: n.subject?.type ?? '',
  subject_url: n.subject?.url ?? '',
  repository_full_name: n.repository?.full_name ?? '',
  updated_at: n.updated_at ?? '',
});

// --- Label schemas ---

export const labelSchema = z.object({
  id: z.number().describe('Label ID'),
  name: z.string().describe('Label name'),
  color: z.string().describe('Label hex color (without #)'),
  description: z.string().describe('Label description'),
});

export interface RawLabel {
  id?: number;
  name?: string;
  color?: string;
  description?: string | null;
}

export const mapLabel = (l: RawLabel) => ({
  id: l.id ?? 0,
  name: l.name ?? '',
  color: l.color ?? '',
  description: l.description ?? '',
});

// --- Workflow run schemas ---

export const workflowRunSchema = z.object({
  id: z.number().describe('Workflow run ID'),
  name: z.string().describe('Workflow name'),
  status: z.string().describe('Run status: queued, in_progress, completed, etc.'),
  conclusion: z.string().describe('Run conclusion: success, failure, cancelled, skipped, etc.'),
  head_branch: z.string().describe('Branch the workflow ran on'),
  head_sha: z.string().describe('HEAD commit SHA'),
  html_url: z.string().describe('URL to the workflow run on GitHub'),
  created_at: z.string().describe('Created ISO 8601 timestamp'),
  updated_at: z.string().describe('Updated ISO 8601 timestamp'),
});

export interface RawWorkflowRun {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  head_branch?: string;
  head_sha?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
}

export const mapWorkflowRun = (r: RawWorkflowRun) => ({
  id: r.id ?? 0,
  name: r.name ?? '',
  status: r.status ?? '',
  conclusion: r.conclusion ?? '',
  head_branch: r.head_branch ?? '',
  head_sha: r.head_sha ?? '',
  html_url: r.html_url ?? '',
  created_at: r.created_at ?? '',
  updated_at: r.updated_at ?? '',
});

// --- Release schemas ---

export const releaseSchema = z.object({
  id: z.number().describe('Release ID'),
  tag_name: z.string().describe('Git tag name'),
  name: z.string().describe('Release title'),
  body: z.string().describe('Release notes in Markdown'),
  draft: z.boolean().describe('Whether this is a draft release'),
  prerelease: z.boolean().describe('Whether this is a prerelease'),
  created_at: z.string().describe('Created ISO 8601 timestamp'),
  published_at: z.string().describe('Published ISO 8601 timestamp'),
  html_url: z.string().describe('URL to the release on GitHub'),
  author_login: z.string().describe('Login of the release author'),
});

export interface RawRelease {
  id?: number;
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  created_at?: string;
  published_at?: string | null;
  html_url?: string;
  author?: { login?: string };
}

export const mapRelease = (r: RawRelease) => ({
  id: r.id ?? 0,
  tag_name: r.tag_name ?? '',
  name: r.name ?? '',
  body: r.body ?? '',
  draft: r.draft ?? false,
  prerelease: r.prerelease ?? false,
  created_at: r.created_at ?? '',
  published_at: r.published_at ?? '',
  html_url: r.html_url ?? '',
  author_login: r.author?.login ?? '',
});

// --- Commit schemas ---

export const commitSchema = z.object({
  sha: z.string().describe('Full commit SHA'),
  message: z.string().describe('Commit message'),
  author_name: z.string().describe('Author name'),
  author_email: z.string().describe('Author email'),
  date: z.string().describe('Authored date ISO 8601 timestamp'),
  url: z.string().describe('URL to the commit on GitHub'),
});

// Commit mapper handles both REST API and same-origin page JSON shapes
// Same-origin shape: { oid, shortMessage, authoredDate, committedDate, url,
//   authors: [{ login, displayName }] }
export interface RawCommit {
  sha?: string;
  oid?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string };
  };
  html_url?: string;
  url?: string;
  shortMessage?: string;
  authoredDate?: string;
  committedDate?: string;
  authors?: Array<{ login?: string; displayName?: string; email?: string }>;
}

export const mapCommit = (c: RawCommit) => ({
  sha: c.sha ?? c.oid ?? '',
  message: c.commit?.message ?? c.shortMessage ?? '',
  author_name: c.commit?.author?.name ?? c.authors?.[0]?.displayName ?? '',
  author_email: c.commit?.author?.email ?? c.authors?.[0]?.email ?? '',
  date: c.commit?.author?.date ?? c.authoredDate ?? c.committedDate ?? '',
  url: c.html_url ?? c.url ?? '',
});

// --- File diff schema ---

export const fileDiffSchema = z.object({
  filename: z.string().describe('File path'),
  status: z.string().describe('Change type: added, removed, modified, renamed, etc.'),
  additions: z.number().describe('Lines added'),
  deletions: z.number().describe('Lines deleted'),
  changes: z.number().describe('Total lines changed'),
});

export interface RawFileDiff {
  filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  // Same-origin shape
  path?: string;
  changeType?: string;
  linesAdded?: number;
  linesDeleted?: number;
  linesChanged?: number;
}

export const mapFileDiff = (f: RawFileDiff) => ({
  filename: f.filename ?? f.path ?? '',
  status: f.status ?? f.changeType?.toLowerCase() ?? '',
  additions: f.additions ?? f.linesAdded ?? 0,
  deletions: f.deletions ?? f.linesDeleted ?? 0,
  changes: f.changes ?? f.linesChanged ?? (f.linesAdded ?? 0) + (f.linesDeleted ?? 0),
});

// --- Relay GraphQL response helpers ---

// Helper to extract labels from Relay edge format
export const extractRelayLabels = (labels: unknown): RawIssueOrPR['relayLabels'] => {
  if (!labels || typeof labels !== 'object') return undefined;
  const l = labels as { edges?: Array<{ node?: { name?: string } }> };
  return l.edges ? { edges: l.edges } : undefined;
};

// Helper to build RawIssueOrPR from Relay GraphQL node
export const relayNodeToRaw = (node: Record<string, unknown>): RawIssueOrPR => ({
  __typename: node.__typename as string | undefined,
  number: node.number as number | undefined,
  title: node.title as string | undefined,
  author: node.author as { login?: string; name?: string; displayName?: string } | undefined,
  createdAt: node.createdAt as string | undefined,
  updatedAt: node.updatedAt as string | undefined,
  closed: node.closed as boolean | undefined,
  closedAt: node.closedAt as string | null | undefined,
  isDraft: node.isDraft as boolean | undefined,
  pullRequestState: node.pullRequestState as string | undefined,
  milestone: node.milestone as { title?: string } | null | undefined,
  relayLabels: extractRelayLabels(node.labels),
  repository: node.repository as RawIssueOrPR['repository'],
});
