import { databaseItemSchema, mapDatabaseItem } from './schemas.js';
import { getSpaceId, getUserId, notionApi } from '../notion-api.js';
import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

interface GetRecordValuesResponse {
  results: Array<{ value?: Record<string, unknown> }>;
}

export const updateDatabaseItem = defineTool({
  name: 'update_database_item',
  displayName: 'Update Database Item',
  description: 'Update a row/item in a Notion database. Use get_database first to understand the property schema.',
  summary: 'Update a database row by setting property values',
  icon: 'table',
  group: 'Databases',
  input: z.object({
    page_id: z.string().min(1).describe('Page/row ID (UUID) of the database item to update'),
    title: z.string().optional().describe('New title for the row'),
    properties: z
      .record(z.string(), z.string())
      .optional()
      .describe('Property values as key-value pairs. Keys are property names (from get_database). Values are strings.'),
  }),
  output: z.object({
    item: databaseItemSchema.describe('The updated database item'),
  }),
  handle: async params => {
    const spaceId = await getSpaceId();
    const userId = getUserId();
    const now = Date.now();

    // Fetch the current page to find its parent collection
    const pageResult = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: params.page_id, table: 'block' }],
    });
    const pageData = pageResult.results?.[0]?.value;
    if (!pageData) throw ToolError.notFound(`Database item not found: ${params.page_id}`);

    const parentId = (pageData.parent_id as string) ?? '';
    const parentTable = (pageData.parent_table as string) ?? '';
    if (parentTable !== 'collection')
      throw ToolError.validation(
        `Block ${params.page_id} is not a database item (parent_table is "${parentTable}", expected "collection")`,
      );

    // Get the database schema to map property names to IDs
    const collResult = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: parentId, table: 'collection' }],
    });
    const collData = collResult.results?.[0]?.value;
    if (!collData) throw ToolError.notFound(`Parent database not found: ${parentId}`);

    const schema = (collData.schema as Record<string, Record<string, unknown>>) ?? {};

    const operations: Record<string, unknown>[] = [];

    // Update title if provided
    if (params.title !== undefined) {
      operations.push({
        pointer: { table: 'block', id: params.page_id, spaceId },
        command: 'set',
        path: ['properties', 'title'],
        args: [[params.title]],
      });
    }

    // Update properties by mapping names to schema IDs
    if (params.properties) {
      for (const [propName, propValue] of Object.entries(params.properties)) {
        const schemaEntry = Object.entries(schema).find(
          ([, prop]) => (prop.name as string)?.toLowerCase() === propName.toLowerCase(),
        );
        if (schemaEntry) {
          const [propId, propDef] = schemaEntry;
          if (propId !== 'title') {
            const propType = (propDef.type as string) ?? 'text';
            let encodedValue: unknown[][];

            if (propType === 'select' || propType === 'multi_select') {
              // For select properties, find the matching option and use its ID annotation
              const options = (propDef.options as Array<{ id?: string; value?: string }>) ?? [];
              const match = options.find(o => (o.value ?? '').toLowerCase() === propValue.toLowerCase());
              if (match?.id) {
                encodedValue = [[propValue, [['a', match.id]]]];
              } else {
                encodedValue = [[propValue]];
              }
            } else if (propType === 'checkbox') {
              encodedValue = [[propValue === 'true' || propValue === 'Yes' ? 'Yes' : 'No']];
            } else {
              encodedValue = [[propValue]];
            }

            operations.push({
              pointer: { table: 'block', id: params.page_id, spaceId },
              command: 'set',
              path: ['properties', propId],
              args: encodedValue,
            });
          }
        }
      }
    }

    // Always update last_edited metadata
    operations.push({
      pointer: { table: 'block', id: params.page_id, spaceId },
      command: 'update',
      path: [],
      args: {
        last_edited_time: now,
        last_edited_by_id: userId,
        last_edited_by_table: 'notion_user',
      },
    });

    await notionApi('submitTransaction', {
      requestId: crypto.randomUUID(),
      transactions: [{ id: crypto.randomUUID(), spaceId, operations }],
    });

    // Fetch the updated item
    const result = await notionApi<GetRecordValuesResponse>('getRecordValues', {
      requests: [{ id: params.page_id, table: 'block' }],
    });

    const itemData = result.results?.[0]?.value;
    return { item: mapDatabaseItem(itemData as Record<string, unknown> | undefined, schema) };
  },
});
