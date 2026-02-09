import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

interface ColumnInfo {
  column_name: string;
  data_type: string;
  column_description?: string | null;
}

type SchemaInfo = Record<string, Record<string, ColumnInfo[]>>;

export const registerSqlpadSchemaTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // Get database schema
  defineTool(
    tools,
    server,
    'sqlpad_get_schema',
    {
      description: `Get schema information for a database connection, including tables and columns.

Returns the database schema organized by schema name and table name:
- Schema names (e.g., "public", "billing_lifecycle")
- Table names within each schema
- Column information: name, data type, description

Parameters:
- connectionId: The database connection ID
- schemaFilter: Optional filter to show only specific schema(s)
- tableFilter: Optional filter to show only specific table(s)

Example usage:
- Get all tables: sqlpad_get_schema(connectionId: "billing-lifecycle-replica")
- Get specific schema: sqlpad_get_schema(connectionId: "billing-lifecycle-replica", schemaFilter: "billing_lifecycle")
- Get specific table: sqlpad_get_schema(connectionId: "billing-lifecycle-replica", tableFilter: "collection_promises")

This is useful for:
- Discovering available tables in a database
- Understanding table structure before writing queries
- Finding column names and data types`,
      inputSchema: {
        connectionId: z.string().describe('Database connection ID (e.g., "billing-lifecycle-replica")'),
        schemaFilter: z.string().optional().describe('Filter to specific schema name (case-insensitive partial match)'),
        tableFilter: z.string().optional().describe('Filter to specific table name (case-insensitive partial match)'),
        env: z.enum(['production', 'staging']).optional().describe('SQLPad environment to query (default: production)'),
      },
    },
    async ({ connectionId, schemaFilter, tableFilter, env }) => {
      const schemaInfo = (await sendServiceRequest('sqlpad', {
        endpoint: `/api/schema-info/${connectionId}`,
        method: 'GET',
        ...(env && { env }),
      })) as SchemaInfo;

      // Apply filters
      const schemaFilterLower = schemaFilter?.toLowerCase();
      const tableFilterLower = tableFilter?.toLowerCase();

      interface TableInfo {
        schema: string;
        table: string;
        columns: Array<{
          name: string;
          type: string;
          description?: string | null;
        }>;
      }

      const tables: TableInfo[] = [];

      for (const [schemaName, schemaTables] of Object.entries(schemaInfo)) {
        // Filter by schema name if provided
        if (schemaFilterLower && !schemaName.toLowerCase().includes(schemaFilterLower)) {
          continue;
        }

        for (const [tableName, columns] of Object.entries(schemaTables)) {
          // Filter by table name if provided
          if (tableFilterLower && !tableName.toLowerCase().includes(tableFilterLower)) {
            continue;
          }

          // Dedupe columns (SQLPad sometimes returns duplicates with different types)
          const seenColumns = new Set<string>();
          const uniqueColumns = columns.filter(col => {
            if (seenColumns.has(col.column_name)) {
              return false;
            }
            seenColumns.add(col.column_name);
            return true;
          });

          tables.push({
            schema: schemaName,
            table: tableName,
            columns: uniqueColumns.map(col => ({
              name: col.column_name,
              type: col.data_type,
              description: col.column_description,
            })),
          });
        }
      }

      // Sort tables by schema and name
      tables.sort((a, b) => {
        const schemaCompare = a.schema.localeCompare(b.schema);
        if (schemaCompare !== 0) return schemaCompare;
        return a.table.localeCompare(b.table);
      });

      return success({
        connectionId,
        tableCount: tables.length,
        tables,
      });
    },
  );

  // List tables only (lighter weight than full schema)
  defineTool(
    tools,
    server,
    'sqlpad_list_tables',
    {
      description: `List all tables in a database connection without column details.

This is a lighter-weight alternative to sqlpad_get_schema when you just need 
to know what tables exist.

Returns:
- List of schema.table names
- Table count per schema

Use sqlpad_get_schema if you need column information.`,
      inputSchema: {
        connectionId: z.string().describe('Database connection ID (e.g., "billing-lifecycle-replica")'),
        schemaFilter: z.string().optional().describe('Filter to specific schema name (case-insensitive partial match)'),
        env: z.enum(['production', 'staging']).optional().describe('SQLPad environment to query (default: production)'),
      },
    },
    async ({ connectionId, schemaFilter, env }) => {
      const schemaInfo = (await sendServiceRequest('sqlpad', {
        endpoint: `/api/schema-info/${connectionId}`,
        method: 'GET',
        ...(env && { env }),
      })) as SchemaInfo;

      const schemaFilterLower = schemaFilter?.toLowerCase();

      interface SchemaTableCount {
        schema: string;
        tables: string[];
        count: number;
      }

      const schemas: SchemaTableCount[] = [];

      for (const [schemaName, schemaTables] of Object.entries(schemaInfo)) {
        // Filter by schema name if provided
        if (schemaFilterLower && !schemaName.toLowerCase().includes(schemaFilterLower)) {
          continue;
        }

        const tableNames = Object.keys(schemaTables).sort();
        schemas.push({
          schema: schemaName,
          tables: tableNames,
          count: tableNames.length,
        });
      }

      // Sort by schema name
      schemas.sort((a, b) => a.schema.localeCompare(b.schema));

      const totalTables = schemas.reduce((sum, s) => sum + s.count, 0);

      return success({
        connectionId,
        schemaCount: schemas.length,
        totalTables,
        schemas,
      });
    },
  );

  return tools;
};
