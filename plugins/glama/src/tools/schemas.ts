import { z } from 'zod';

// --- MCP Server ---

export const mcpServerSummarySchema = z.object({
  uid: z.string().describe('Unique identifier'),
  slug: z.string().describe('URL slug'),
  displayName: z.string().describe('Display name'),
  namespace: z.string().describe('Namespace/owner slug'),
  description: z.string().describe('Plain text description'),
  toolCount: z.number().int().describe('Number of tools'),
  stargazers: z.number().int().describe('GitHub stars'),
  language: z.string().describe('Primary programming language'),
  license: z.string().describe('SPDX license name'),
  addedAt: z.string().describe('ISO 8601 timestamp when added'),
  updatedAt: z.string().describe('ISO 8601 timestamp when last updated'),
  recentUsage: z.number().int().describe('Recent usage count'),
  attributes: z.array(z.string()).describe('Server attributes (categories, environment, etc.)'),
});

export interface RawMcpServerSummary {
  uid?: string;
  slug?: string;
  displayName?: string;
  namespace?: { slug?: string };
  descriptionPlainText?: string;
  toolCount?: number;
  repository?: {
    githubRepository?: {
      stargazers?: number;
      language?: string;
      spdxLicense?: { name?: string };
    };
  };
  addedAt?: string;
  updatedAt?: string;
  recentUsage?: number;
  attributes?: string[];
}

export const mapMcpServerSummary = (s: RawMcpServerSummary) => ({
  uid: s.uid ?? '',
  slug: s.slug ?? '',
  displayName: s.displayName ?? '',
  namespace: s.namespace?.slug ?? '',
  description: s.descriptionPlainText ?? '',
  toolCount: s.toolCount ?? 0,
  stargazers: s.repository?.githubRepository?.stargazers ?? 0,
  language: s.repository?.githubRepository?.language ?? '',
  license: s.repository?.githubRepository?.spdxLicense?.name ?? '',
  addedAt: s.addedAt ?? '',
  updatedAt: s.updatedAt ?? '',
  recentUsage: s.recentUsage ?? 0,
  attributes: s.attributes ?? [],
});

// --- MCP Server Detail ---

export const mcpServerDetailSchema = mcpServerSummarySchema.extend({
  descriptionMarkdown: z.string().describe('Markdown description'),
  githubRepoUrl: z.string().describe('GitHub repository URL'),
  githubRepoFullName: z.string().describe('GitHub repo full name (owner/repo)'),
  defaultBranch: z.string().describe('Default git branch'),
  scores: z
    .object({
      license: z.number().nullable().describe('License score (0-100)'),
      quality: z.number().nullable().describe('Quality score (0-100)'),
      security: z.number().nullable().describe('Security score (0-100)'),
    })
    .describe('Quality scores'),
  npmPackage: z.string().describe('npm package name, empty if none'),
  supportedPlatforms: z.array(z.string()).describe('Supported platforms (MACOS, WINDOWS, LINUX)'),
  integrations: z
    .array(
      z.object({
        name: z.string().describe('Integration brand name'),
        slug: z.string().describe('Integration slug'),
        description: z.string().describe('Integration description'),
      }),
    )
    .describe('Supported integrations'),
});

export interface RawMcpServerDetail extends RawMcpServerSummary {
  descriptionMarkdown?: string;
  repository?: {
    githubRepository?: {
      stargazers?: number;
      language?: string;
      spdxLicense?: { name?: string };
      fullName?: string;
      defaultBranch?: string;
    };
    githubProject?: { url?: string };
    npmPackage?: { name?: string };
    supportedPlatforms?: string[];
  };
  scores?: { license?: number | null; quality?: number | null; security?: number | null };
  integrations?: Array<{
    brand?: { name?: string; slug?: string };
    description?: string;
  }>;
}

export const mapMcpServerDetail = (s: RawMcpServerDetail) => ({
  ...mapMcpServerSummary(s),
  descriptionMarkdown: s.descriptionMarkdown ?? '',
  githubRepoUrl: s.repository?.githubProject?.url ?? '',
  githubRepoFullName: s.repository?.githubRepository?.fullName ?? '',
  defaultBranch: s.repository?.githubRepository?.defaultBranch ?? '',
  scores: {
    license: s.scores?.license ?? null,
    quality: s.scores?.quality ?? null,
    security: s.scores?.security ?? null,
  },
  npmPackage: s.repository?.npmPackage?.name ?? '',
  supportedPlatforms: s.repository?.supportedPlatforms ?? [],
  integrations: (s.integrations ?? []).map(i => ({
    name: i.brand?.name ?? '',
    slug: i.brand?.slug ?? '',
    description: i.description ?? '',
  })),
});

// --- MCP Tool ---

export const mcpToolSchema = z.object({
  uid: z.string().describe('Unique identifier'),
  name: z.string().describe('Tool name'),
  description: z.string().describe('Tool description'),
  serverDisplayName: z.string().describe('Parent MCP server display name'),
  serverNamespace: z.string().describe('Parent MCP server namespace'),
  serverSlug: z.string().describe('Parent MCP server slug'),
});

export interface RawMcpTool {
  uid?: string;
  name?: string;
  description?: string;
  mcpServer?: {
    displayName?: string;
    namespace?: { slug?: string };
    slug?: string;
  };
}

export const mapMcpTool = (t: RawMcpTool) => ({
  uid: t.uid ?? '',
  name: t.name ?? '',
  description: t.description ?? '',
  serverDisplayName: t.mcpServer?.displayName ?? '',
  serverNamespace: t.mcpServer?.namespace?.slug ?? '',
  serverSlug: t.mcpServer?.slug ?? '',
});

// --- Chat Session ---

export const chatSessionSchema = z.object({
  uid: z.string().describe('Chat session unique ID'),
  title: z.string().describe('Chat title'),
  model: z.string().describe('LLM model name'),
  projectName: z.string().describe('Parent project name, empty if none'),
  reasoningEffort: z.string().describe('Reasoning effort level'),
});

export interface RawChatSession {
  uid?: string;
  title?: string;
  hostedLlmModel?: { name?: string };
  project?: { name?: string };
  reasoningEffort?: string;
}

export const mapChatSession = (c: RawChatSession) => ({
  uid: c.uid ?? '',
  title: c.title ?? '',
  model: c.hostedLlmModel?.name ?? '',
  projectName: c.project?.name ?? '',
  reasoningEffort: c.reasoningEffort ?? '',
});

// --- Chat Session Summary (from sidebar) ---

export const chatSessionSummarySchema = z.object({
  uid: z.string().describe('Chat session unique ID'),
  title: z.string().describe('Chat title'),
});

export interface RawChatSessionSummary {
  uid?: string;
  title?: string;
}

export const mapChatSessionSummary = (c: RawChatSessionSummary) => ({
  uid: c.uid ?? '',
  title: c.title ?? '',
});

// --- Project ---

export const projectSchema = z.object({
  uid: z.string().describe('Project unique ID'),
  name: z.string().describe('Project name'),
});

export interface RawProject {
  uid?: string;
  name?: string;
}

export const mapProject = (p: RawProject) => ({
  uid: p.uid ?? '',
  name: p.name ?? '',
});

// --- Gateway Model ---

export const gatewayModelSchema = z.object({
  name: z.string().describe('Model name/ID'),
});

export interface RawGatewayModel {
  name?: string;
}

export const mapGatewayModel = (m: RawGatewayModel) => ({
  name: m.name ?? '',
});

// --- User Profile ---

export const userProfileSchema = z.object({
  referenceId: z.string().describe('User account reference ID'),
  email: z.string().describe('Email address'),
  fullName: z.string().describe('Full name'),
  workspaceName: z.string().describe('Workspace name'),
  workspaceId: z.number().int().describe('Workspace ID'),
  role: z.string().describe('Workspace role'),
});

export interface RawVisitorSession {
  userAccount?: {
    referenceId?: string;
    emailAddress?: string;
    fullName?: string;
  };
  membership?: {
    role?: { name?: string };
    workspace?: { name?: string; id?: number };
  };
}

export const mapUserProfile = (v: RawVisitorSession) => ({
  referenceId: v.userAccount?.referenceId ?? '',
  email: v.userAccount?.emailAddress ?? '',
  fullName: v.userAccount?.fullName ?? '',
  workspaceName: v.membership?.workspace?.name ?? '',
  workspaceId: v.membership?.workspace?.id ?? 0,
  role: v.membership?.role?.name ?? '',
});

// --- Directory Stats ---

export const directoryStatsSchema = z.object({
  totalServerCount: z.number().int().describe('Total number of MCP servers in the directory'),
  lastUpdated: z.string().describe('ISO 8601 timestamp of last directory update'),
});

export interface RawDirectoryStats {
  totalServerCount?: number;
  lastUpdated?: string;
}

export const mapDirectoryStats = (s: RawDirectoryStats) => ({
  totalServerCount: s.totalServerCount ?? 0,
  lastUpdated: s.lastUpdated ?? '',
});
