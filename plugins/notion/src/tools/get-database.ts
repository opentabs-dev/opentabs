import { databaseSchema, mapDatabase } from './schemas.js';
import { notionApi } from '../notion-api.js';
import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

export const getDatabase = defineTool({
  name: 'get_database',
  displayName: 'Get Database',
  description:
    'Get a Notion database (collection) schema including its properties/columns and their types. Use this to understand the structure before querying.',
  summary: 'Get a database schema',
  icon: 'database',
  group: 'Databases',
  input: z.object({
    database_id: z
      .string()
      .describe('Database (collection) ID. You can find this from a collection_view or collection_view_page block.'),
  }),
  output: z.object({
    database: databaseSchema.describe('Database schema and properties'),
  }),
  handle: async params => {
    const result = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: params.database_id, table: 'collection' }],
    });

    const collectionData = result.results?.[0]?.value;
    if (!collectionData) throw ToolError.notFound(`Database not found: ${params.database_id}`);

    return { database: mapDatabase(collectionData as Record<string, unknown>) };
  },
});
