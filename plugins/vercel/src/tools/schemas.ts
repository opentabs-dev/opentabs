import { z } from 'zod';

// --- Project ---

export const projectSchema = z.object({
  id: z.string().describe('Project ID'),
  name: z.string().describe('Project name'),
  framework: z.string().nullable().describe('Detected framework (e.g., "nextjs", "vite")'),
  node_version: z.string().describe('Node.js version used for builds'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
  live: z.boolean().describe('Whether the project has a production deployment'),
  git_repository: z
    .object({
      type: z.string().describe('Git provider (e.g., "github")'),
      repo: z.string().describe('Repository name (owner/repo)'),
    })
    .nullable()
    .describe('Linked Git repository'),
});

export type Project = z.infer<typeof projectSchema>;

export const mapProject = (p: Record<string, unknown>): Project => {
  const link = p.link as Record<string, unknown> | undefined;
  return {
    id: (p.id as string) ?? '',
    name: (p.name as string) ?? '',
    framework: (p.framework as string) ?? null,
    node_version: (p.nodeVersion as string) ?? '18.x',
    created_at: p.createdAt ? new Date(p.createdAt as number).toISOString() : '',
    updated_at: p.updatedAt ? new Date(p.updatedAt as number).toISOString() : '',
    live: (p.live as boolean) ?? false,
    git_repository: link
      ? {
          type: (link.type as string) ?? '',
          repo: (link.repo as string) ?? '',
        }
      : null,
  };
};

// --- Deployment ---

export const deploymentSchema = z.object({
  uid: z.string().describe('Deployment ID'),
  name: z.string().describe('Project name'),
  url: z.string().describe('Deployment URL'),
  state: z.string().describe('Deployment state (READY, ERROR, BUILDING, QUEUED, CANCELED)'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  ready_at: z.string().nullable().describe('ISO 8601 ready timestamp'),
  source: z.string().describe('Deployment source (e.g., "git", "cli")'),
  target: z.string().nullable().describe('Deployment target ("production" or null for preview)'),
  meta: z
    .object({
      git_commit_sha: z.string().describe('Git commit SHA'),
      git_commit_message: z.string().describe('Git commit message'),
      git_commit_ref: z.string().describe('Git branch name'),
    })
    .nullable()
    .describe('Git metadata'),
});

export type Deployment = z.infer<typeof deploymentSchema>;

export const mapDeployment = (d: Record<string, unknown>): Deployment => {
  const meta = d.meta as Record<string, unknown> | undefined;
  return {
    uid: (d.uid as string) ?? '',
    name: (d.name as string) ?? '',
    url: (d.url as string) ?? '',
    state: (d.state as string) ?? (d.readyState as string) ?? '',
    created_at: (d.createdAt ?? d.created) ? new Date((d.createdAt ?? d.created) as number).toISOString() : '',
    ready_at: d.ready ? new Date(d.ready as number).toISOString() : null,
    source: (d.source as string) ?? '',
    target: (d.target as string) ?? null,
    meta: meta
      ? {
          git_commit_sha: (meta.githubCommitSha as string) ?? (meta.gitlabCommitSha as string) ?? '',
          git_commit_message: (meta.githubCommitMessage as string) ?? (meta.gitlabCommitMessage as string) ?? '',
          git_commit_ref: (meta.githubCommitRef as string) ?? (meta.gitlabCommitRef as string) ?? '',
        }
      : null,
  };
};

// --- Domain ---

export const domainSchema = z.object({
  name: z.string().describe('Domain name'),
  configured: z.boolean().describe('Whether DNS is properly configured'),
  redirect: z.string().nullable().describe('Redirect target domain, if this is a redirect'),
  redirect_status_code: z.number().nullable().describe('HTTP status code for redirect (301 or 308)'),
  git_branch: z.string().nullable().describe('Git branch this domain is linked to'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
});

export type Domain = z.infer<typeof domainSchema>;

export const mapDomain = (d: Record<string, unknown>): Domain => ({
  name: (d.name as string) ?? '',
  configured: (d.configured as boolean) ?? false,
  redirect: (d.redirect as string) ?? null,
  redirect_status_code: (d.redirectStatusCode as number) ?? null,
  git_branch: (d.gitBranch as string) ?? null,
  created_at: d.createdAt ? new Date(d.createdAt as number).toISOString() : '',
  updated_at: d.updatedAt ? new Date(d.updatedAt as number).toISOString() : '',
});

// --- Environment Variable ---

export const envVarSchema = z.object({
  id: z.string().describe('Environment variable ID'),
  key: z.string().describe('Variable name'),
  value: z.string().describe('Variable value (may be encrypted/masked)'),
  target: z.array(z.string()).describe('Deployment targets: "production", "preview", "development"'),
  type: z.string().describe('Variable type: "system", "encrypted", "plain", "secret", "sensitive"'),
  git_branch: z.string().nullable().describe('Git branch filter, if scoped to a specific branch'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
});

export type EnvVar = z.infer<typeof envVarSchema>;

export const mapEnvVar = (e: Record<string, unknown>): EnvVar => ({
  id: (e.id as string) ?? '',
  key: (e.key as string) ?? '',
  value: (e.value as string) ?? '',
  target: Array.isArray(e.target) ? (e.target as string[]) : [],
  type: (e.type as string) ?? 'plain',
  git_branch: (e.gitBranch as string) ?? null,
  created_at: e.createdAt ? new Date(e.createdAt as number).toISOString() : '',
  updated_at: e.updatedAt ? new Date(e.updatedAt as number).toISOString() : '',
});
