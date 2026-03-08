import { z } from 'zod';

// --- Shared schemas ---

export const repositorySchema = z.object({
  uuid: z.string().describe('Repository UUID'),
  slug: z.string().describe('Repository slug'),
  full_name: z.string().describe('Full name in "workspace/repo" format'),
  name: z.string().describe('Repository name'),
  description: z.string().describe('Repository description'),
  is_private: z.boolean().describe('Whether the repository is private'),
  scm: z.string().describe('Source control type (e.g., "git")'),
  language: z.string().describe('Primary programming language'),
  default_branch: z.string().describe('Default branch name'),
  web_url: z.string().describe('URL to the repository on Bitbucket'),
  created_on: z.string().describe('Created ISO 8601 timestamp'),
  updated_on: z.string().describe('Updated ISO 8601 timestamp'),
});

export const pullRequestSchema = z.object({
  id: z.number().int().describe('Pull request ID'),
  title: z.string().describe('Pull request title'),
  description: z.string().describe('Pull request description in Markdown'),
  state: z.string().describe('PR state: OPEN, MERGED, DECLINED, or SUPERSEDED'),
  source_branch: z.string().describe('Source branch name'),
  destination_branch: z.string().describe('Destination branch name'),
  author: z.string().describe('Author display name'),
  close_source_branch: z.boolean().describe('Whether source branch is deleted after merge'),
  comment_count: z.number().int().describe('Number of comments'),
  web_url: z.string().describe('URL to the pull request on Bitbucket'),
  created_on: z.string().describe('Created ISO 8601 timestamp'),
  updated_on: z.string().describe('Updated ISO 8601 timestamp'),
});

export const branchSchema = z.object({
  name: z.string().describe('Branch name'),
  target_hash: z.string().describe('SHA of the branch HEAD commit'),
  target_date: z.string().describe('Date of the HEAD commit'),
  target_message: z.string().describe('Commit message of the HEAD commit'),
  target_author: z.string().describe('Author of the HEAD commit'),
});

export const commitSchema = z.object({
  hash: z.string().describe('Full commit SHA'),
  message: z.string().describe('Full commit message'),
  author_raw: z.string().describe('Author in "Name <email>" format'),
  date: z.string().describe('Authored ISO 8601 timestamp'),
  web_url: z.string().describe('URL to the commit on Bitbucket'),
});

export const tagSchema = z.object({
  name: z.string().describe('Tag name'),
  target_hash: z.string().describe('SHA of the tagged commit'),
  target_date: z.string().describe('Date of the tagged commit'),
  message: z.string().describe('Tag message'),
});

export const pipelineSchema = z.object({
  uuid: z.string().describe('Pipeline UUID'),
  build_number: z.number().int().describe('Pipeline build number'),
  state_name: z.string().describe('Pipeline state (e.g., COMPLETED, IN_PROGRESS, PENDING)'),
  result_name: z.string().describe('Pipeline result (e.g., SUCCESSFUL, FAILED, STOPPED) or empty if in progress'),
  target_branch: z.string().describe('Target branch name'),
  target_hash: z.string().describe('Target commit SHA'),
  creator: z.string().describe('Display name of the pipeline creator'),
  duration_seconds: z.number().int().describe('Duration in seconds or 0 if not finished'),
  created_on: z.string().describe('Created ISO 8601 timestamp'),
  completed_on: z.string().describe('Completed ISO 8601 timestamp or empty string'),
});

export const pipelineStepSchema = z.object({
  uuid: z.string().describe('Step UUID'),
  name: z.string().describe('Step name'),
  state_name: z.string().describe('Step state (e.g., COMPLETED, IN_PROGRESS, PENDING)'),
  result_name: z.string().describe('Step result (e.g., SUCCESSFUL, FAILED) or empty if in progress'),
  duration_seconds: z.number().int().describe('Duration in seconds or 0 if not finished'),
  started_on: z.string().describe('Started ISO 8601 timestamp or empty string'),
  completed_on: z.string().describe('Completed ISO 8601 timestamp or empty string'),
});

export const commentSchema = z.object({
  id: z.number().int().describe('Comment ID'),
  content: z.string().describe('Comment content in Markdown'),
  author: z.string().describe('Author display name'),
  created_on: z.string().describe('Created ISO 8601 timestamp'),
  updated_on: z.string().describe('Updated ISO 8601 timestamp'),
});

export const userSchema = z.object({
  uuid: z.string().describe('User UUID'),
  username: z.string().describe('Username (account_id for Atlassian accounts)'),
  display_name: z.string().describe('Display name'),
  type: z.string().describe('Account type (e.g., "user")'),
  web_url: z.string().describe('URL to the user profile on Bitbucket'),
});

export const workspaceSchema = z.object({
  uuid: z.string().describe('Workspace UUID'),
  slug: z.string().describe('Workspace slug'),
  name: z.string().describe('Workspace name'),
  type: z.string().describe('Workspace type'),
});

export const memberSchema = z.object({
  display_name: z.string().describe('Member display name'),
  uuid: z.string().describe('Member UUID'),
  type: z.string().describe('Account type'),
  permission: z.string().describe('Workspace permission level (e.g., "owner", "collaborator", "member")'),
});

// --- Defensive mappers ---

export interface RawRepo {
  uuid?: string;
  slug?: string;
  full_name?: string;
  name?: string;
  description?: string;
  is_private?: boolean;
  scm?: string;
  language?: string;
  mainbranch?: { name?: string };
  links?: { html?: { href?: string } };
  created_on?: string;
  updated_on?: string;
}

export const mapRepository = (r: RawRepo) => ({
  uuid: r.uuid ?? '',
  slug: r.slug ?? '',
  full_name: r.full_name ?? '',
  name: r.name ?? r.slug ?? '',
  description: r.description ?? '',
  is_private: r.is_private ?? false,
  scm: r.scm ?? '',
  language: r.language ?? '',
  default_branch: r.mainbranch?.name ?? '',
  web_url: r.links?.html?.href ?? '',
  created_on: r.created_on ?? '',
  updated_on: r.updated_on ?? '',
});

export interface RawPR {
  id?: number;
  title?: string;
  description?: string;
  state?: string;
  source?: { branch?: { name?: string } };
  destination?: { branch?: { name?: string } };
  author?: { display_name?: string };
  close_source_branch?: boolean;
  comment_count?: number;
  links?: { html?: { href?: string } };
  created_on?: string;
  updated_on?: string;
}

export const mapPullRequest = (pr: RawPR) => ({
  id: pr.id ?? 0,
  title: pr.title ?? '',
  description: pr.description ?? '',
  state: pr.state ?? '',
  source_branch: pr.source?.branch?.name ?? '',
  destination_branch: pr.destination?.branch?.name ?? '',
  author: pr.author?.display_name ?? '',
  close_source_branch: pr.close_source_branch ?? false,
  comment_count: pr.comment_count ?? 0,
  web_url: pr.links?.html?.href ?? '',
  created_on: pr.created_on ?? '',
  updated_on: pr.updated_on ?? '',
});

export interface RawBranch {
  name?: string;
  target?: { hash?: string; date?: string; message?: string; author?: { raw?: string } };
}

export const mapBranch = (b: RawBranch) => ({
  name: b.name ?? '',
  target_hash: b.target?.hash ?? '',
  target_date: b.target?.date ?? '',
  target_message: (b.target?.message ?? '').trim(),
  target_author: b.target?.author?.raw ?? '',
});

export interface RawCommit {
  hash?: string;
  message?: string;
  author?: { raw?: string };
  date?: string;
  links?: { html?: { href?: string } };
}

export const mapCommit = (c: RawCommit) => ({
  hash: c.hash ?? '',
  message: (c.message ?? '').trim(),
  author_raw: c.author?.raw ?? '',
  date: c.date ?? '',
  web_url: c.links?.html?.href ?? '',
});

export interface RawTag {
  name?: string;
  target?: { hash?: string; date?: string };
  message?: string;
}

export const mapTag = (t: RawTag) => ({
  name: t.name ?? '',
  target_hash: t.target?.hash ?? '',
  target_date: t.target?.date ?? '',
  message: (t.message ?? '').trim(),
});

export interface RawPipeline {
  uuid?: string;
  build_number?: number;
  state?: { name?: string; result?: { name?: string } };
  target?: { ref_name?: string; commit?: { hash?: string } };
  creator?: { display_name?: string };
  duration_in_seconds?: number;
  created_on?: string;
  completed_on?: string;
}

export const mapPipeline = (p: RawPipeline) => ({
  uuid: p.uuid ?? '',
  build_number: p.build_number ?? 0,
  state_name: p.state?.name ?? '',
  result_name: p.state?.result?.name ?? '',
  target_branch: p.target?.ref_name ?? '',
  target_hash: p.target?.commit?.hash ?? '',
  creator: p.creator?.display_name ?? '',
  duration_seconds: p.duration_in_seconds ?? 0,
  created_on: p.created_on ?? '',
  completed_on: p.completed_on ?? '',
});

export interface RawPipelineStep {
  uuid?: string;
  name?: string;
  state?: { name?: string; result?: { name?: string } };
  duration_in_seconds?: number;
  started_on?: string;
  completed_on?: string;
}

export const mapPipelineStep = (s: RawPipelineStep) => ({
  uuid: s.uuid ?? '',
  name: s.name ?? '',
  state_name: s.state?.name ?? '',
  result_name: s.state?.result?.name ?? '',
  duration_seconds: s.duration_in_seconds ?? 0,
  started_on: s.started_on ?? '',
  completed_on: s.completed_on ?? '',
});

export interface RawComment {
  id?: number;
  content?: { raw?: string };
  user?: { display_name?: string };
  created_on?: string;
  updated_on?: string;
}

export const mapComment = (c: RawComment) => ({
  id: c.id ?? 0,
  content: c.content?.raw ?? '',
  author: c.user?.display_name ?? '',
  created_on: c.created_on ?? '',
  updated_on: c.updated_on ?? '',
});

export interface RawUser {
  uuid?: string;
  username?: string;
  display_name?: string;
  type?: string;
  links?: { html?: { href?: string } };
}

export const mapUser = (u: RawUser) => ({
  uuid: u.uuid ?? '',
  username: u.username ?? '',
  display_name: u.display_name ?? '',
  type: u.type ?? '',
  web_url: u.links?.html?.href ?? '',
});

export interface RawWorkspace {
  uuid?: string;
  slug?: string;
  name?: string;
  type?: string;
}

export const mapWorkspace = (w: RawWorkspace) => ({
  uuid: w.uuid ?? '',
  slug: w.slug ?? '',
  name: w.name ?? '',
  type: w.type ?? '',
});

export interface RawMember {
  user?: { display_name?: string; uuid?: string; type?: string };
  permission?: string;
}

export const mapMember = (m: RawMember) => ({
  display_name: m.user?.display_name ?? '',
  uuid: m.user?.uuid ?? '',
  type: m.user?.type ?? '',
  permission: m.permission ?? '',
});
