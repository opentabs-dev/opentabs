import { databaseItemSchema, mapDatabaseItem } from './schemas.js';
import { getSpaceId, notionApi } from '../notion-api.js';
import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

interface ReducerResults {
  collection_group_results?: {
    blockIds?: string[];
    total?: number;
  };
}

interface QueryCollectionResponse {
  result?: {
    type: string;
    reducerResults?: ReducerResults;
    sizeHint?: number;
  };
  recordMap?: {
    block?: Record<string, { value?: Record<string, unknown> }>;
    collection?: Record<string, { value?: Record<string, unknown> }>;
  };
}

export const queryDatabase = defineTool({
  name: 'query_database',
  displayName: 'Query Database',
  description: 'Query rows from a Notion database with optional search. Returns items with their property values.',
  summary: 'Query rows from a database',
  icon: 'table',
  group: 'Databases',
  input: z.object({
    database_id: z.string().describe('Database (collection) ID to query'),
    view_id: z.string().optional().describe('Collection view ID. If omitted, uses the first available view.'),
    query: z.string().optional().describe('Search query to filter results'),
    limit: z.number().optional().describe('Maximum number of results (default 50, max 100)'),
  }),
  output: z.object({
    items: z.array(databaseItemSchema).describe('Database rows/items'),
    total: z.number().describe('Total number of items in the database'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();
    const limit = Math.min(params.limit ?? 50, 100);

    // Get the collection data first
    const collResult = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: params.database_id, table: 'collection' }],
    });
    const collData = collResult.results?.[0]?.value;
    if (!collData) throw ToolError.notFound(`Database not found: ${params.database_id}`);

    const schema = (collData.schema as Record<string, Record<string, unknown>>) ?? {};

    // If no view_id, find the parent block to get view IDs
    let viewId = params.view_id;
    if (!viewId) {
      const parentId = (collData.parent_id as string) ?? '';
      if (parentId) {
        const parentResult = await notionApi<GetRecordValuesResponse>('getRecordValues', {
          requests: [{ id: parentId, table: 'block' }],
        });
        const parentData = parentResult.results?.[0]?.value;
        const viewIds = parentData?.view_ids as string[] | undefined;
        viewId = viewIds?.[0];
      }
    }

    if (!viewId) {
      throw ToolError.validation('Could not determine a view ID for this database. Please provide a view_id.');
    }

    // Use the newer queryCollection format with source + reducer
    const data = await notionApi<QueryCollectionResponse>('queryCollection', {
      source: {
        type: 'collection',
        id: params.database_id,
        spaceId,
      },
      collectionView: {
        id: viewId,
        spaceId,
      },
      loader: {
        type: 'reducer',
        reducers: {
          collection_group_results: {
            type: 'results',
            limit,
            loadContentCover: false,
          },
        },
        searchQuery: params.query ?? '',
        userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });

    const groupResults = data.result?.reducerResults?.collection_group_results;
    const blockIds = groupResults?.blockIds ?? [];
    const blockMap = data.recordMap?.block ?? {};

    const items = blockIds.map(id => {
      const entry = blockMap[id];
      // queryCollection wraps block data in an extra { value, role } layer
      const blockData =
        (entry?.value as { value?: Record<string, unknown>; role?: string } | undefined)?.value ??
        (entry?.value as Record<string, unknown> | undefined);
      return mapDatabaseItem(blockData as Record<string, unknown> | undefined, schema);
    });

    return {
      items,
      total: groupResults?.total ?? items.length,
    };
  },
});
