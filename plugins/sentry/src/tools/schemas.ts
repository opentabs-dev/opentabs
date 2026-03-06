import { z } from 'zod';

// --- Issue ---

export const issueSchema = z.object({
  id: z.string().describe('Issue ID'),
  short_id: z.string().describe('Human-readable short ID (e.g., PROJECT-123)'),
  title: z.string().describe('Issue title'),
  culprit: z.string().describe('The function or module that caused the issue'),
  level: z.string().describe('Severity level (error, warning, info, debug, fatal)'),
  status: z.string().describe('Issue status (unresolved, resolved, ignored)'),
  priority: z.string().describe('Issue priority (critical, high, medium, low)'),
  count: z.string().describe('Total number of events for this issue'),
  user_count: z.number().describe('Number of unique users affected'),
  first_seen: z.string().describe('ISO 8601 timestamp when the issue was first seen'),
  last_seen: z.string().describe('ISO 8601 timestamp when the issue was last seen'),
  permalink: z.string().describe('URL to the issue in Sentry'),
  project: z
    .object({
      id: z.string().describe('Project ID'),
      name: z.string().describe('Project name'),
      slug: z.string().describe('Project slug'),
    })
    .describe('Project the issue belongs to'),
  assigned_to: z.string().nullable().describe('Name of the assigned user or team, or null if unassigned'),
  is_bookmarked: z.boolean().describe('Whether the issue is bookmarked'),
  has_seen: z.boolean().describe('Whether the current user has seen the issue'),
  issue_category: z.string().describe('Issue category (error, performance, etc.)'),
  issue_type: z.string().describe('Specific issue type'),
});

export type Issue = z.infer<typeof issueSchema>;

export const mapIssue = (i: Record<string, unknown> | undefined): Issue => {
  const project = (i?.project as Record<string, unknown>) ?? {};
  const assignedTo = i?.assignedTo as Record<string, unknown> | null | undefined;
  return {
    id: (i?.id as string) ?? '',
    short_id: (i?.shortId as string) ?? '',
    title: (i?.title as string) ?? '',
    culprit: (i?.culprit as string) ?? '',
    level: (i?.level as string) ?? '',
    status: (i?.status as string) ?? '',
    priority: (i?.priority as string) ?? '',
    count: (i?.count as string) ?? '0',
    user_count: (i?.userCount as number) ?? 0,
    first_seen: (i?.firstSeen as string) ?? '',
    last_seen: (i?.lastSeen as string) ?? '',
    permalink: (i?.permalink as string) ?? '',
    project: {
      id: (project.id as string) ?? '',
      name: (project.name as string) ?? '',
      slug: (project.slug as string) ?? '',
    },
    assigned_to: assignedTo?.name ? (assignedTo.name as string) : null,
    is_bookmarked: (i?.isBookmarked as boolean) ?? false,
    has_seen: (i?.hasSeen as boolean) ?? false,
    issue_category: (i?.issueCategory as string) ?? '',
    issue_type: (i?.issueType as string) ?? '',
  };
};

// --- Event ---

export const eventSchema = z.object({
  id: z.string().describe('Event ID'),
  event_id: z.string().describe('Event UUID'),
  title: z.string().describe('Event title'),
  message: z.string().describe('Event message'),
  platform: z.string().describe('Platform (e.g., python, javascript)'),
  date_created: z.string().describe('ISO 8601 timestamp when the event occurred'),
  tags: z
    .array(z.object({ key: z.string().describe('Tag key'), value: z.string().describe('Tag value') }))
    .describe('Event tags'),
});

export type Event = z.infer<typeof eventSchema>;

export const mapEvent = (e: Record<string, unknown> | undefined): Event => {
  const rawTags = (e?.tags as Array<Record<string, unknown>>) ?? [];
  return {
    id: (e?.id as string) ?? '',
    event_id: (e?.eventID as string) ?? (e?.id as string) ?? '',
    title: (e?.title as string) ?? '',
    message: (e?.message as string) ?? ((e?.metadata as Record<string, unknown>)?.value as string) ?? '',
    platform: (e?.platform as string) ?? '',
    date_created: (e?.dateCreated as string) ?? '',
    tags: rawTags.map(t => ({
      key: (t.key as string) ?? '',
      value: (t.value as string) ?? '',
    })),
  };
};

// --- Project ---

export const projectSchema = z.object({
  id: z.string().describe('Project ID'),
  name: z.string().describe('Project name'),
  slug: z.string().describe('Project slug'),
  platform: z.string().describe('Project platform (e.g., python, javascript)'),
  date_created: z.string().describe('ISO 8601 timestamp when the project was created'),
  is_bookmarked: z.boolean().describe('Whether the project is bookmarked'),
  has_access: z.boolean().describe('Whether the current user has access'),
  status: z.string().describe('Project status'),
});

export type Project = z.infer<typeof projectSchema>;

export const mapProject = (p: Record<string, unknown> | undefined): Project => ({
  id: (p?.id as string) ?? '',
  name: (p?.name as string) ?? '',
  slug: (p?.slug as string) ?? '',
  platform: (p?.platform as string) ?? '',
  date_created: (p?.dateCreated as string) ?? '',
  is_bookmarked: (p?.isBookmarked as boolean) ?? false,
  has_access: (p?.hasAccess as boolean) ?? false,
  status: (p?.status as string) ?? '',
});

// --- Organization ---

export const organizationSchema = z.object({
  id: z.string().describe('Organization ID'),
  name: z.string().describe('Organization name'),
  slug: z.string().describe('Organization slug'),
  date_created: z.string().describe('ISO 8601 timestamp when the org was created'),
  status: z.string().describe('Organization status'),
});

export type Organization = z.infer<typeof organizationSchema>;

export const mapOrganization = (o: Record<string, unknown> | undefined): Organization => {
  const status = (o?.status as Record<string, unknown>) ?? {};
  return {
    id: (o?.id as string) ?? '',
    name: (o?.name as string) ?? '',
    slug: (o?.slug as string) ?? '',
    date_created: (o?.dateCreated as string) ?? '',
    status: (status.id as string) ?? (o?.status as string) ?? '',
  };
};

// --- Team ---

export const teamSchema = z.object({
  id: z.string().describe('Team ID'),
  name: z.string().describe('Team name'),
  slug: z.string().describe('Team slug'),
  member_count: z.number().describe('Number of members in the team'),
  date_created: z.string().describe('ISO 8601 timestamp when the team was created'),
});

export type Team = z.infer<typeof teamSchema>;

export const mapTeam = (t: Record<string, unknown> | undefined): Team => ({
  id: (t?.id as string) ?? '',
  name: (t?.name as string) ?? '',
  slug: (t?.slug as string) ?? '',
  member_count: (t?.memberCount as number) ?? 0,
  date_created: (t?.dateCreated as string) ?? '',
});

// --- Member ---

export const memberSchema = z.object({
  id: z.string().describe('Member ID'),
  email: z.string().describe('Member email address'),
  name: z.string().describe('Member display name'),
  role: z.string().describe('Member role in the organization'),
  date_joined: z.string().describe('ISO 8601 timestamp when the member joined'),
  is_pending: z.boolean().describe('Whether the invitation is still pending'),
});

export type Member = z.infer<typeof memberSchema>;

export const mapMember = (m: Record<string, unknown> | undefined): Member => {
  const user = (m?.user as Record<string, unknown>) ?? {};
  return {
    id: (m?.id as string) ?? '',
    email: (m?.email as string) ?? (user.email as string) ?? '',
    name: (user.name as string) ?? (m?.name as string) ?? '',
    role: (m?.orgRole as string) ?? (m?.role as string) ?? '',
    date_joined: (m?.dateCreated as string) ?? '',
    is_pending: (m?.pending as boolean) ?? false,
  };
};

// --- Release ---

export const releaseSchema = z.object({
  version: z.string().describe('Release version identifier'),
  short_version: z.string().describe('Short version for display'),
  date_released: z.string().describe('ISO 8601 timestamp when the release was deployed'),
  date_created: z.string().describe('ISO 8601 timestamp when the release was created'),
  new_groups: z.number().describe('Number of new issues in this release'),
  commit_count: z.number().describe('Number of commits in this release'),
  deploy_count: z.number().describe('Number of deployments for this release'),
});

export type Release = z.infer<typeof releaseSchema>;

export const mapRelease = (r: Record<string, unknown> | undefined): Release => ({
  version: (r?.version as string) ?? '',
  short_version: (r?.shortVersion as string) ?? '',
  date_released: (r?.dateReleased as string) ?? '',
  date_created: (r?.dateCreated as string) ?? '',
  new_groups: (r?.newGroups as number) ?? 0,
  commit_count: (r?.commitCount as number) ?? 0,
  deploy_count: (r?.deployCount as number) ?? 0,
});
