import { databaseSchema, mapDatabase } from './schemas.js';
import { getSpaceId, getUserId, notionApi } from '../notion-api.js';
import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

const PROPERTY_TYPES: Record<string, string> = {
  text: 'text',
  number: 'number',
  select: 'select',
  multi_select: 'multi_select',
  checkbox: 'checkbox',
  url: 'url',
  email: 'email',
  phone: 'phone_number',
};

export const createDatabase = defineTool({
  name: 'create_database',
  displayName: 'Create Database',
  description: 'Create a new database in a Notion page. Creates a basic database with a title column.',
  summary: 'Create a new database',
  icon: 'database',
  group: 'Databases',
  input: z.object({
    parent_page_id: z.string().min(1).describe('Page ID to create the database in'),
    title: z.string().min(1).describe('Database title'),
    properties: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Additional property names with types: "text", "number", "select", "multi_select", "checkbox", "url", "email", "phone"',
      ),
  }),
  output: z.object({
    database: databaseSchema.describe('The created database'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();
    const userId = getUserId();
    const now = Date.now();

    // Verify parent page exists
    const parentResult = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: params.parent_page_id, table: 'block' }],
    });
    const parentData = parentResult.results?.[0]?.value;
    if (!parentData) throw ToolError.notFound(`Parent page not found: ${params.parent_page_id}`);

    const collectionId = crypto.randomUUID();
    const collectionViewPageId = crypto.randomUUID();
    const collectionViewId = crypto.randomUUID();

    // Build the schema — always includes a title column
    const schema: Record<string, Record<string, unknown>> = {
      title: { name: 'Name', type: 'title' },
    };

    if (params.properties) {
      for (const [propName, propType] of Object.entries(params.properties)) {
        const resolvedType = PROPERTY_TYPES[propType.toLowerCase()];
        if (!resolvedType) {
          throw ToolError.validation(
            `Unknown property type "${propType}" for "${propName}". Valid types: ${Object.keys(PROPERTY_TYPES).join(', ')}`,
          );
        }
        const propId = crypto.randomUUID().replace(/-/g, '').substring(0, 4);
        schema[propId] = { name: propName, type: resolvedType };
      }
    }

    const operations: Record<string, unknown>[] = [
      // Create the collection (database schema)
      {
        pointer: { table: 'collection', id: collectionId, spaceId },
        command: 'set',
        path: [],
        args: {
          id: collectionId,
          version: 1,
          name: [[params.title]],
          schema,
          parent_id: collectionViewPageId,
          parent_table: 'block',
          alive: true,
          space_id: spaceId,
        },
      },
      // Create the collection_view_page block (the database container)
      {
        pointer: { table: 'block', id: collectionViewPageId, spaceId },
        command: 'set',
        path: [],
        args: {
          type: 'collection_view_page',
          id: collectionViewPageId,
          version: 1,
          collection_id: collectionId,
          view_ids: [collectionViewId],
          parent_id: params.parent_page_id,
          parent_table: 'block',
          alive: true,
          created_time: now,
          created_by_id: userId,
          created_by_table: 'notion_user',
          last_edited_time: now,
          last_edited_by_id: userId,
          last_edited_by_table: 'notion_user',
          space_id: spaceId,
          permissions: [{ type: 'user_permission', role: 'editor', user_id: userId }],
        },
      },
      // Create the default table view
      {
        pointer: { table: 'collection_view', id: collectionViewId, spaceId },
        command: 'set',
        path: [],
        args: {
          id: collectionViewId,
          version: 1,
          type: 'table',
          name: 'Default view',
          parent_id: collectionViewPageId,
          parent_table: 'block',
          alive: true,
          page_sort: [],
          space_id: spaceId,
        },
      },
      // Add the database page to the parent's content list
      {
        pointer: { table: 'block', id: params.parent_page_id, spaceId },
        command: 'listAfter',
        path: ['content'],
        args: { id: collectionViewPageId },
      },
    ];

    await notionApi('submitTransaction', {
      requestId: crypto.randomUUID(),
      transactions: [{ id: crypto.randomUUID(), spaceId, operations }],
    });

    // Fetch the created collection to return it
    const result = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: collectionId, table: 'collection' }],
    });

    const collData = result.results?.[0]?.value;
    return { database: mapDatabase(collData as Record<string, unknown> | undefined) };
  },
});
