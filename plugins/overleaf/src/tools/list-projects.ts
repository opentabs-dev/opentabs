import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { post } from '../overleaf-api.js';
import { objectId } from './schemas.js';

const rawProject = z.object({
  id: objectId,
  name: z.string(),
  accessLevel: z.string(),
  source: z.string().optional(),
  owner: z.object({ id: objectId }).optional(),
  archived: z.boolean(),
  trashed: z.boolean(),
  lastUpdated: z.string(),
});
const responseSchema = z.object({
  totalSize: z.number().int().nonnegative(),
  projects: z.array(rawProject).max(10_000),
});

export const listProjects = defineTool({
  name: 'list_projects',
  displayName: 'List Projects',
  description:
    'List hosted Overleaf projects with IDs, names, access levels, and archive/trash metadata. ' +
    'The backend currently returns the full filtered list and ignores page fields: offset/limit are applied locally. ' +
    'Use the same name filter on subsequent pages; changes between calls can shift offsets. Never compiles.',
  summary: 'List projects and access metadata',
  icon: 'folders',
  group: 'Projects',
  input: z.object({
    name_filter: z.string().max(200).optional().describe('Case-insensitive literal substring of the project name'),
    offset: z.number().int().min(0).max(10_000).default(0).describe('Client-side offset in the filtered backend list'),
    limit: z.number().int().min(1).max(100).default(20).describe('Maximum projects returned, from 1 to 100'),
  }),
  output: z.object({
    projects: z
      .array(
        z.object({
          id: objectId.describe('Project ID'),
          name: z.string().describe('Project name'),
          access_level: z.string().describe('Caller access level reported by Overleaf'),
          access_source: z.string().nullable().describe('How access was granted when available'),
          owner_id: objectId.nullable().describe('Owner ID when available to the caller'),
          archived: z.boolean().describe('Whether the project is archived'),
          trashed: z.boolean().describe('Whether the project is trashed'),
          last_updated: z.string().describe('Server-reported last update time'),
        }),
      )
      .describe('Bounded client-side page of matching projects'),
    total: z.number().int().nonnegative().describe('Total matching projects reported by the backend'),
    offset: z.number().int().nonnegative().describe('Applied client-side offset'),
    next_offset: z.number().int().nullable().describe('Next client-side offset, or null at the end'),
    pagination: z.literal('client_side').describe('The backend does not implement its page fields'),
  }),
  handle: async params => {
    const data = await post(
      '/api/project',
      {
        filters: params.name_filter ? { search: params.name_filter } : {},
        sort: { by: 'lastUpdated', order: 'desc' },
      },
      responseSchema,
    );
    if (data.projects.length !== data.totalSize) {
      throw ToolError.internal('Overleaf returned a partial project list without a supported pagination contract.');
    }
    const projects = data.projects.slice(params.offset, params.offset + params.limit).map(project => ({
      id: project.id,
      name: project.name,
      access_level: project.accessLevel,
      access_source: project.source ?? null,
      owner_id: project.owner?.id ?? null,
      archived: project.archived,
      trashed: project.trashed,
      last_updated: project.lastUpdated,
    }));
    const end = params.offset + projects.length;
    return {
      projects,
      total: data.totalSize,
      offset: params.offset,
      next_offset: end < data.totalSize ? end : null,
      pagination: 'client_side' as const,
    };
  },
});
