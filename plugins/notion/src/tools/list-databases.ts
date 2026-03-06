import { databaseSchema, mapDatabase } from './schemas.js';
import { getSpaceId, notionApi } from '../notion-api.js';
import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface SearchResponse {
  results: Array<{ id: string }>;
  total: number;
  recordMap: {
    block?: Record<string, { value?: Record<string, unknown> }>;
    collection?: Record<string, { value?: Record<string, unknown> }>;
  };
}

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

export const listDatabases = defineTool({
  name: 'list_databases',
  displayName: 'List Databases',
  description: 'List all databases in the Notion workspace. Returns databases sorted by last edited time.',
  summary: 'List databases in the workspace',
  icon: 'database',
  group: 'Databases',
  input: z.object({
    limit: z.number().int().min(1).max(100).optional().describe('Maximum number of databases to return (default 20)'),
  }),
  output: z.object({
    databases: z.array(databaseSchema).describe('Databases in the workspace'),
    total: z.number().describe('Total number of results'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();
    const limit = params.limit ?? 20;

    // Search for collection_view_page and collection_view blocks (database containers)
    const data = await notionApi<SearchResponse>('search', {
      type: 'BlocksInSpace',
      query: '',
      spaceId,
      limit,
      filters: {
        isDeletedOnly: false,
        excludeTemplates: true,
        navigableBlockContentOnly: true,
        requireEditPermissions: false,
        ancestors: [],
        createdBy: [],
        editedBy: [],
        lastEditedTime: {},
        createdTime: {},
        inTeams: [],
      },
      sort: { field: 'lastEdited', direction: 'desc' },
      source: 'quick_find',
    });

    // Filter results to only database blocks (collection_view_page or collection_view)
    const dbBlocks = (data.results ?? []).filter(r => {
      const block = data.recordMap?.block?.[r.id]?.value as Record<string, unknown> | undefined;
      const type = block?.type as string | undefined;
      return type === 'collection_view_page' || type === 'collection_view';
    });

    // Collect unique collection IDs from the database blocks
    const collectionIds = new Set<string>();
    for (const r of dbBlocks) {
      const block = data.recordMap?.block?.[r.id]?.value as Record<string, unknown> | undefined;
      const collId = (block?.collection_id as string) ?? '';
      if (collId) collectionIds.add(collId);
    }

    if (collectionIds.size === 0) {
      return { databases: [], total: 0 };
    }

    // Fetch collection records to get schema and names
    const collResult = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [...collectionIds].map(id => ({ id, table: 'collection' })),
    });

    const databases = (collResult.results ?? [])
      .map(r => r.value)
      .filter((v): v is Record<string, unknown> => v != null)
      .map(v => mapDatabase(v));

    return { databases, total: databases.length };
  },
});
