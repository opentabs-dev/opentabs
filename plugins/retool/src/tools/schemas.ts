import { z } from 'zod';

// --- App (Page) ---

export const appSchema = z.object({
  id: z.number().describe('Numeric app ID'),
  name: z.string().describe('App name'),
  uuid: z.string().describe('App UUID'),
  folder_id: z.number().describe('Parent folder ID'),
  organization_id: z.number().describe('Organization ID'),
  description: z.string().describe('App description'),
  is_mobile_app: z.boolean().describe('Whether the app is a mobile app'),
  is_global_widget: z.boolean().describe('Whether the app is a global widget (module)'),
  is_form_app: z.boolean().describe('Whether the app is a form app'),
  protected: z.boolean().describe('Whether the app is protected'),
  synced: z.boolean().describe('Whether the app is synced to source control'),
  access_level: z.string().describe('Access level for the current user'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
});

export interface RawApp {
  id?: number;
  name?: string;
  uuid?: string;
  folderId?: number;
  organizationId?: number;
  description?: string | null;
  isMobileApp?: boolean | null;
  isGlobalWidget?: boolean | null;
  isFormApp?: boolean;
  protected?: boolean;
  synced?: boolean;
  accessLevel?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const mapApp = (a: RawApp) => ({
  id: a.id ?? 0,
  name: a.name ?? '',
  uuid: a.uuid ?? '',
  folder_id: a.folderId ?? 0,
  organization_id: a.organizationId ?? 0,
  description: a.description ?? '',
  is_mobile_app: a.isMobileApp ?? false,
  is_global_widget: a.isGlobalWidget ?? false,
  is_form_app: a.isFormApp ?? false,
  protected: a.protected ?? false,
  synced: a.synced ?? false,
  access_level: a.accessLevel ?? '',
  created_at: a.createdAt ?? '',
  updated_at: a.updatedAt ?? '',
});

// --- Folder ---

export const folderSchema = z.object({
  id: z.number().describe('Numeric folder ID'),
  name: z.string().describe('Folder name'),
  display_name: z.string().describe('Folder display name'),
  system_folder: z.boolean().describe('Whether the folder is a system folder'),
  folder_type: z.string().describe('Folder type (app or workflow)'),
  parent_folder_id: z.number().nullable().describe('Parent folder ID, null for root'),
  organization_id: z.number().describe('Organization ID'),
  access_level: z.string().describe('Access level for the current user'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
});

export interface RawFolder {
  id?: number;
  name?: string;
  displayName?: string;
  systemFolder?: boolean;
  folderType?: string;
  parentFolderId?: number | null;
  organizationId?: number;
  accessLevel?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const mapFolder = (f: RawFolder) => ({
  id: f.id ?? 0,
  name: f.name ?? '',
  display_name: f.displayName ?? '',
  system_folder: f.systemFolder ?? false,
  folder_type: f.folderType ?? '',
  parent_folder_id: f.parentFolderId ?? null,
  organization_id: f.organizationId ?? 0,
  access_level: f.accessLevel ?? '',
  created_at: f.createdAt ?? '',
  updated_at: f.updatedAt ?? '',
});

// --- User ---

export const userSchema = z.object({
  id: z.number().describe('Numeric user ID'),
  email: z.string().describe('Email address'),
  first_name: z.string().describe('First name'),
  last_name: z.string().describe('Last name'),
  profile_photo_url: z.string().describe('Profile photo URL'),
  organization_id: z.number().describe('Organization ID'),
  sid: z.string().describe('User SID'),
  enabled: z.boolean().describe('Whether the user account is enabled'),
  user_type: z.string().describe('User type (e.g., default)'),
  seat_type: z.string().describe('Seat type (e.g., internalUser)'),
  email_is_verified: z.boolean().describe('Whether the email is verified'),
  last_logged_in: z.string().describe('ISO 8601 last login timestamp'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
});

export interface RawUser {
  id?: number;
  email?: string;
  firstName?: string;
  lastName?: string;
  profilePhotoUrl?: string | null;
  organizationId?: number;
  sid?: string;
  enabled?: boolean;
  userType?: string;
  seatType?: string;
  emailIsVerified?: boolean;
  lastLoggedIn?: string;
  createdAt?: string;
}

export const mapUser = (u: RawUser) => ({
  id: u.id ?? 0,
  email: u.email ?? '',
  first_name: u.firstName ?? '',
  last_name: u.lastName ?? '',
  profile_photo_url: u.profilePhotoUrl ?? '',
  organization_id: u.organizationId ?? 0,
  sid: u.sid ?? '',
  enabled: u.enabled ?? false,
  user_type: u.userType ?? '',
  seat_type: u.seatType ?? '',
  email_is_verified: u.emailIsVerified ?? false,
  last_logged_in: u.lastLoggedIn ?? '',
  created_at: u.createdAt ?? '',
});

// --- Organization ---

export const organizationSchema = z.object({
  id: z.number().describe('Numeric organization ID'),
  name: z.string().describe('Organization name'),
  subdomain: z.string().describe('Organization subdomain'),
  sid: z.string().describe('Organization SID'),
  plan_id: z.number().describe('Plan ID'),
  release_management_enabled: z.boolean().describe('Whether release management is enabled'),
  enabled: z.boolean().describe('Whether the organization is enabled'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
});

export interface RawOrganization {
  id?: number;
  name?: string;
  subdomain?: string;
  sid?: string;
  planId?: number;
  releaseManagementEnabled?: boolean;
  enabled?: boolean;
  createdAt?: string;
}

export const mapOrganization = (o: RawOrganization) => ({
  id: o.id ?? 0,
  name: o.name ?? '',
  subdomain: o.subdomain ?? '',
  sid: o.sid ?? '',
  plan_id: o.planId ?? 0,
  release_management_enabled: o.releaseManagementEnabled ?? false,
  enabled: o.enabled ?? false,
  created_at: o.createdAt ?? '',
});

// --- Resource ---

export const resourceSchema = z.object({
  id: z.number().describe('Numeric resource ID'),
  uuid: z.string().describe('Resource UUID'),
  type: z.string().describe('Resource type (e.g., postgresql, restapi, anthropic)'),
  name: z.string().describe('Internal resource name'),
  display_name: z.string().describe('Display name'),
  protected: z.boolean().describe('Whether the resource is protected'),
  synced: z.boolean().describe('Whether the resource is synced to source control'),
  access_level: z.string().describe('Access level for the current user'),
  editor_type: z.string().describe('Editor type for queries'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
});

export interface RawResource {
  id?: number;
  uuid?: string;
  type?: string;
  name?: string;
  displayName?: string;
  protected?: boolean;
  synced?: boolean;
  accessLevel?: string;
  editorType?: string;
  production?: { createdAt?: string; updatedAt?: string };
}

export const mapResource = (r: RawResource) => ({
  id: r.id ?? 0,
  uuid: r.uuid ?? '',
  type: r.type ?? '',
  name: r.name ?? '',
  display_name: r.displayName ?? '',
  protected: r.protected ?? false,
  synced: r.synced ?? false,
  access_level: r.accessLevel ?? '',
  editor_type: r.editorType ?? '',
  created_at: r.production?.createdAt ?? '',
  updated_at: r.production?.updatedAt ?? '',
});

// --- Resource Folder ---

export const resourceFolderSchema = z.object({
  id: z.number().describe('Resource folder ID'),
  name: z.string().describe('Folder name'),
  parent_folder_id: z.number().nullable().describe('Parent folder ID'),
  organization_id: z.number().describe('Organization ID'),
  system_folder: z.boolean().describe('Whether the folder is a system folder'),
  access_level: z.string().describe('Access level for the current user'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
});

export interface RawResourceFolder {
  id?: number;
  name?: string;
  parentFolderId?: number | null;
  organizationId?: number;
  systemFolder?: boolean;
  accessLevel?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const mapResourceFolder = (f: RawResourceFolder) => ({
  id: f.id ?? 0,
  name: f.name ?? '',
  parent_folder_id: f.parentFolderId ?? null,
  organization_id: f.organizationId ?? 0,
  system_folder: f.systemFolder ?? false,
  access_level: f.accessLevel ?? '',
  created_at: f.createdAt ?? '',
  updated_at: f.updatedAt ?? '',
});

// --- Workflow ---

export const workflowSchema = z.object({
  id: z.string().describe('Workflow ID (UUID)'),
  name: z.string().describe('Workflow name'),
  folder_id: z.number().describe('Parent folder ID'),
  is_enabled: z.boolean().describe('Whether the workflow is enabled'),
  access_level: z.string().describe('Access level for the current user'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
});

export interface RawWorkflow {
  id?: string | number;
  name?: string;
  folderId?: number;
  isEnabled?: boolean;
  accessLevel?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const mapWorkflow = (w: RawWorkflow) => ({
  id: String(w.id ?? ''),
  name: w.name ?? '',
  folder_id: w.folderId ?? 0,
  is_enabled: w.isEnabled ?? false,
  access_level: w.accessLevel ?? '',
  created_at: w.createdAt ?? '',
  updated_at: w.updatedAt ?? '',
});

// --- Workflow Run ---

export const workflowRunSchema = z.object({
  id: z.string().describe('Workflow run ID'),
  status: z.string().describe('Run status (e.g., success, failed, running)'),
  trigger_type: z.string().describe('How the run was triggered (e.g., manual, webhook, schedule)'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  execution_time_ms: z.number().describe('Time taken to execute in milliseconds'),
  input_data_size_bytes: z.number().describe('Input data size in bytes'),
  output_data_size_bytes: z.number().describe('Output data size in bytes'),
});

export interface RawWorkflowRun {
  id?: string;
  status?: string;
  triggerType?: string;
  createdAt?: string;
  timeTakenToExecuteWorkflow?: number | string;
  inputDataSizeBytes?: number | string;
  outputDataSizeBytes?: number | string;
}

export const mapWorkflowRun = (r: RawWorkflowRun) => ({
  id: r.id ?? '',
  status: r.status ?? '',
  trigger_type: r.triggerType ?? '',
  created_at: r.createdAt ?? '',
  execution_time_ms: Number(r.timeTakenToExecuteWorkflow ?? 0),
  input_data_size_bytes: Number(r.inputDataSizeBytes ?? 0),
  output_data_size_bytes: Number(r.outputDataSizeBytes ?? 0),
});

// --- Workflow Trigger ---

export const workflowTriggerSchema = z.object({
  id: z.string().describe('Trigger ID'),
  trigger_type: z.string().describe('Trigger type (e.g., webhook, schedule)'),
  crontab: z.string().describe('Cron expression for schedule triggers'),
  timezone: z.string().describe('Timezone for schedule triggers'),
  environment_id: z.string().describe('Associated environment ID'),
});

export interface RawWorkflowTrigger {
  id?: string;
  triggerType?: string;
  triggerOptions?: { crontab?: string; timezone?: string };
  environmentId?: string;
}

export const mapWorkflowTrigger = (t: RawWorkflowTrigger) => ({
  id: t.id ?? '',
  trigger_type: t.triggerType ?? '',
  crontab: t.triggerOptions?.crontab ?? '',
  timezone: t.triggerOptions?.timezone ?? '',
  environment_id: t.environmentId ?? '',
});

// --- Workflow Release ---

export const workflowReleaseSchema = z.object({
  version: z.number().describe('Release version number'),
  deployer: z.string().describe('User who deployed this release'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
});

export interface RawWorkflowRelease {
  version?: number;
  deployer?: string;
  createdAt?: string;
}

export const mapWorkflowRelease = (r: RawWorkflowRelease) => ({
  version: r.version ?? 0,
  deployer: r.deployer ?? '',
  created_at: r.createdAt ?? '',
});

// --- Environment ---

export const environmentSchema = z.object({
  id: z.string().describe('Environment UUID'),
  name: z.string().describe('Environment name (e.g., production, staging)'),
  description: z.string().describe('Environment description'),
  display_color: z.string().describe('Hex display color'),
  is_default: z.boolean().describe('Whether this is the default environment'),
  organization_id: z.number().describe('Organization ID'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
});

export interface RawEnvironment {
  id?: string;
  name?: string;
  description?: string | null;
  displayColor?: string;
  isDefault?: boolean;
  organizationId?: number;
  createdAt?: string;
  updatedAt?: string;
}

export const mapEnvironment = (e: RawEnvironment) => ({
  id: e.id ?? '',
  name: e.name ?? '',
  description: e.description ?? '',
  display_color: e.displayColor ?? '',
  is_default: e.isDefault ?? false,
  organization_id: e.organizationId ?? 0,
  created_at: e.createdAt ?? '',
  updated_at: e.updatedAt ?? '',
});

// --- Branch ---

export const branchSchema = z.object({
  name: z.string().describe('Branch name'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
});

export interface RawBranch {
  name?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const mapBranch = (b: RawBranch) => ({
  name: b.name ?? '',
  created_at: b.createdAt ?? '',
  updated_at: b.updatedAt ?? '',
});

// --- Source Control Settings ---

export const sourceControlSettingsSchema = z.object({
  enable_auto_branch_naming: z.boolean().describe('Whether auto branch naming is enabled'),
  enable_custom_pull_request_template: z.boolean().describe('Whether custom PR templates are enabled'),
  version_control_locked: z.boolean().describe('Whether version control is locked'),
  enable_auto_cleanup_branches: z.boolean().describe('Whether auto branch cleanup is enabled'),
  disable_auto_catch_up_commits: z.boolean().describe('Whether auto catch-up commits are disabled'),
});

export interface RawSourceControlSettings {
  enableAutoBranchNaming?: boolean;
  enableCustomPullRequestTemplate?: boolean;
  versionControlLocked?: boolean;
  enableAutoCleanupBranches?: boolean;
  disableAutoCatchUpCommits?: boolean;
}

export const mapSourceControlSettings = (s: RawSourceControlSettings) => ({
  enable_auto_branch_naming: s.enableAutoBranchNaming ?? false,
  enable_custom_pull_request_template: s.enableCustomPullRequestTemplate ?? false,
  version_control_locked: s.versionControlLocked ?? false,
  enable_auto_cleanup_branches: s.enableAutoCleanupBranches ?? false,
  disable_auto_catch_up_commits: s.disableAutoCatchUpCommits ?? false,
});

// --- User Space ---

export const userSpaceSchema = z.object({
  user_id: z.number().describe('User ID'),
  org_id: z.number().describe('Organization ID'),
  space_name: z.string().describe('Space name'),
  domain: z.string().describe('Space domain'),
  is_parent_org: z.boolean().describe('Whether this is the parent organization'),
});

export interface RawUserSpace {
  userId?: number;
  orgId?: number;
  spaceName?: string;
  domain?: string;
  isParentOrg?: boolean;
}

export const mapUserSpace = (s: RawUserSpace) => ({
  user_id: s.userId ?? 0,
  org_id: s.orgId ?? 0,
  space_name: s.spaceName ?? '',
  domain: s.domain ?? '',
  is_parent_org: s.isParentOrg ?? false,
});

// --- Playground Query ---

export const playgroundQuerySchema = z.object({
  id: z.number().describe('Query ID'),
  name: z.string().describe('Query name'),
  uuid: z.string().describe('Query UUID'),
  query: z.string().describe('SQL or query text'),
  resource_id: z.number().describe('Associated resource ID'),
  resource_uuid: z.string().describe('Associated resource UUID'),
  shared: z.boolean().describe('Whether the query is shared with the organization'),
  editor_name: z.string().describe('Name of the last editor'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
});

export interface RawPlaygroundQuery {
  id?: number;
  name?: string;
  uuid?: string;
  query?: string;
  resourceId?: number;
  resourceUuid?: string;
  shared?: boolean;
  editorName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const mapPlaygroundQuery = (q: RawPlaygroundQuery) => ({
  id: q.id ?? 0,
  name: q.name ?? '',
  uuid: q.uuid ?? '',
  query: q.query ?? '',
  resource_id: q.resourceId ?? 0,
  resource_uuid: q.resourceUuid ?? '',
  shared: q.shared ?? false,
  editor_name: q.editorName ?? '',
  created_at: q.createdAt ?? '',
  updated_at: q.updatedAt ?? '',
});

// --- Agent ---

export const agentSchema = z.object({
  id: z.number().describe('Agent ID'),
  name: z.string().describe('Agent name'),
  uuid: z.string().describe('Agent UUID'),
  description: z.string().describe('Agent description'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
});

export interface RawAgent {
  id?: number;
  name?: string;
  uuid?: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const mapAgent = (a: RawAgent) => ({
  id: a.id ?? 0,
  name: a.name ?? '',
  uuid: a.uuid ?? '',
  description: a.description ?? '',
  created_at: a.createdAt ?? '',
  updated_at: a.updatedAt ?? '',
});

// --- Page Save (edit history entry) ---

export const pageSaveSchema = z.object({
  id: z.number().describe('Save ID'),
  user_email: z.string().describe('Email of user who saved'),
  commit_message: z.string().describe('Commit/change message'),
  is_released: z.boolean().describe('Whether this save was released'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
});

export interface RawPageSave {
  id?: number;
  user?: { email?: string };
  commitMessage?: string;
  isReleased?: boolean;
  createdAt?: string;
}

export const mapPageSave = (s: RawPageSave) => ({
  id: s.id ?? 0,
  user_email: s.user?.email ?? '',
  commit_message: s.commitMessage ?? '',
  is_released: s.isReleased ?? false,
  created_at: s.createdAt ?? '',
});

// --- App Tag (release/version) ---

export const appTagSchema = z.object({
  id: z.number().describe('Tag ID'),
  name: z.string().describe('Tag name (e.g., v1.0)'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
});

export interface RawAppTag {
  id?: number;
  name?: string;
  createdAt?: string;
}

export const mapAppTag = (t: RawAppTag) => ({
  id: t.id ?? 0,
  name: t.name ?? '',
  created_at: t.createdAt ?? '',
});

// --- Grid (Retool Database table) ---

export const gridSchema = z.object({
  id: z.string().describe('Grid ID'),
  name: z.string().describe('Grid (table) name'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
});

export interface RawGrid {
  id?: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const mapGrid = (g: RawGrid) => ({
  id: g.id ?? '',
  name: g.name ?? '',
  created_at: g.createdAt ?? '',
  updated_at: g.updatedAt ?? '',
});
