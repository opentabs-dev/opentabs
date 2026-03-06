import { databaseItemSchema, mapDatabaseItem } from './schemas.js';
import { getSpaceId, getUserId, notionApi } from '../notion-api.js';
import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

export const createDatabaseItem = defineTool({
  name: 'create_database_item',
  displayName: 'Create Database Item',
  description: 'Add a new row/item to a Notion database. Use get_database first to understand the property schema.',
  summary: 'Add a row to a database',
  icon: 'table-rows-split',
  group: 'Databases',
  input: z.object({
    database_id: z.string().min(1).describe('Database (collection) ID to add a row to'),
    title: z.string().min(1).describe('Title for the new row'),
    properties: z
      .record(z.string(), z.string())
      .optional()
      .describe('Property values as key-value pairs. Keys are property names (from get_database). Values are strings.'),
  }),
  output: z.object({
    item: databaseItemSchema.describe('The created database item'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();
    const userId = getUserId();
    const itemId = crypto.randomUUID();
    const now = Date.now();

    // Get the database schema to map property names to IDs
    const collResult = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: params.database_id, table: 'collection' }],
    });
    const collData = collResult.results?.[0]?.value;
    if (!collData) throw ToolError.notFound(`Database not found: ${params.database_id}`);

    const schema = (collData.schema as Record<string, Record<string, unknown>>) ?? {};
    const parentId = (collData.parent_id as string) ?? '';
    if (!parentId)
      throw ToolError.internal(
        `Database ${params.database_id} has no parent_id — cannot add item to parent content list`,
      );

    // Build properties object with schema property IDs
    const blockProperties: Record<string, unknown> = {
      title: [[params.title]],
    };

    if (params.properties) {
      for (const [propName, propValue] of Object.entries(params.properties)) {
        // Find schema entry by name
        const schemaEntry = Object.entries(schema).find(
          ([, prop]) => (prop.name as string)?.toLowerCase() === propName.toLowerCase(),
        );
        if (schemaEntry) {
          const [propId, propDef] = schemaEntry;
          if (propId !== 'title') {
            const propType = (propDef.type as string) ?? 'text';

            if (propType === 'select' || propType === 'multi_select') {
              const options = (propDef.options as Array<{ id?: string; value?: string }>) ?? [];
              const match = options.find(o => (o.value ?? '').toLowerCase() === propValue.toLowerCase());
              blockProperties[propId] = match?.id ? [[propValue, [['a', match.id]]]] : [[propValue]];
            } else if (propType === 'checkbox') {
              blockProperties[propId] = [[propValue === 'true' || propValue === 'Yes' ? 'Yes' : 'No']];
            } else {
              blockProperties[propId] = [[propValue]];
            }
          }
        }
      }
    }

    await notionApi('submitTransaction', {
      requestId: crypto.randomUUID(),
      transactions: [
        {
          id: crypto.randomUUID(),
          spaceId,
          operations: [
            {
              pointer: { table: 'block', id: itemId, spaceId },
              command: 'set',
              path: [],
              args: {
                type: 'page',
                id: itemId,
                version: 1,
                parent_id: params.database_id,
                parent_table: 'collection',
                alive: true,
                created_time: now,
                created_by_id: userId,
                created_by_table: 'notion_user',
                last_edited_time: now,
                last_edited_by_id: userId,
                last_edited_by_table: 'notion_user',
                space_id: spaceId,
                properties: blockProperties,
              },
            },
            {
              pointer: { table: 'block', id: parentId, spaceId },
              command: 'listAfter',
              path: ['content'],
              args: { id: itemId },
            },
          ],
        },
      ],
    });

    // Fetch the created item
    const result = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: itemId, table: 'block' }],
    });

    const itemData = result.results?.[0]?.value;
    return { item: mapDatabaseItem(itemData as Record<string, unknown> | undefined, schema) };
  },
});
