import { parseQueryResult } from './format.js';
import { error, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Run a Snowflake SQL query via the adapter's api action and return the parsed result.
 */
const runQuery = async (sqlText: string): Promise<unknown> =>
  sendServiceRequest('snowflake', {
    endpoint: '/v1/queries',
    method: 'POST',
    body: { sqlText, asyncExec: false, sequenceId: 0, querySubmissionTime: Date.now() },
  });

export const registerSnowflakeDataTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // Browse data catalog
  defineTool(
    tools,
    server,
    'snowflake_browse_data',
    {
      description: `List all databases accessible to the current Snowflake user/role.

Returns an array of databases with: name, owner, kind (STANDARD or APPLICATION), created_on, and comment.
Use snowflake_run_query with "SHOW SCHEMAS IN DATABASE <name>" or "SHOW TABLES IN SCHEMA <db>.<schema>" to drill deeper.`,
      inputSchema: {},
    },
    async () => {
      const raw = await runQuery('SHOW DATABASES');
      const parsed = parseQueryResult(raw);
      const rows = (parsed.rows ?? []) as Record<string, unknown>[];

      // Extract just the useful fields from SHOW DATABASES rows
      const databases = rows.map(r => ({
        name: r.name,
        owner: r.owner,
        kind: r.kind,
        created_on: r.created_on,
        comment: r.comment || undefined,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({ databases, count: databases.length }, null, 2) }],
      };
    },
  );

  // Search data catalog
  defineTool(
    tools,
    server,
    'snowflake_search_data',
    {
      description: `Search for Snowflake databases by name pattern (case-insensitive LIKE match).

Returns matching databases with: name, owner, kind, created_on, and comment.
For searching tables or schemas within a database, use snowflake_run_query with
"SHOW TABLES LIKE '%pattern%' IN SCHEMA db.schema" instead.`,
      inputSchema: {
        query: z.string().describe('Database name pattern to search (case-insensitive, e.g. "billing")'),
      },
    },
    async ({ query }) => {
      const escaped = query.replace(/'/g, "''");
      const raw = await runQuery(`SHOW DATABASES LIKE '%${escaped}%'`);
      const parsed = parseQueryResult(raw);
      const rows = (parsed.rows ?? []) as Record<string, unknown>[];

      const databases = rows.map(r => ({
        name: r.name,
        owner: r.owner,
        kind: r.kind,
        created_on: r.created_on,
        comment: r.comment || undefined,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ query, databases, count: databases.length }, null, 2),
          },
        ],
      };
    },
  );

  // Get data dictionary object details
  defineTool(
    tools,
    server,
    'snowflake_get_object_details',
    {
      description: `Get column-level schema details for a Snowflake table or view using DESCRIBE TABLE.

Returns an array of columns with: name, type (e.g. "VARCHAR(16777216)", "TIMESTAMP_NTZ(9)"),
kind, nullable, default, primaryKey, uniqueKey, and comment.

The objectName must be fully qualified: DATABASE.SCHEMA.TABLE (e.g. "BILLING_LIFECYCLE.BILLING_LIFECYCLE.COLLECTION_PROMISES").`,
      inputSchema: {
        objectName: z.string().describe('Fully qualified object name (e.g., "MY_DB.MY_SCHEMA.MY_TABLE")'),
      },
    },
    async ({ objectName }) => {
      // Validate objectName contains only safe identifier characters (alphanumeric, dots, underscores, dollar signs)
      if (!/^[\w.$]+$/i.test(objectName)) {
        return error(
          'Invalid object name. Use fully qualified identifiers: DATABASE.SCHEMA.TABLE (alphanumeric, dots, underscores only).',
        );
      }

      const raw = await runQuery(`DESCRIBE TABLE ${objectName}`);
      const parsed = parseQueryResult(raw);
      const rows = (parsed.rows ?? []) as Record<string, unknown>[];

      // DESCRIBE TABLE returns: name, type, kind, null?, default, primary key, unique key, check, expression, comment, policy name, privacy domain
      const columns = rows.map(r => ({
        name: r.name,
        type: r.type,
        kind: r.kind,
        nullable: r['null?'] === 'Y',
        default: r.default || undefined,
        primaryKey: r['primary key'] === 'Y' ? true : undefined,
        uniqueKey: r['unique key'] === 'Y' ? true : undefined,
        comment: r.comment || undefined,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ objectName, columns, columnCount: columns.length }, null, 2),
          },
        ],
      };
    },
  );

  // List shared objects
  defineTool(
    tools,
    server,
    'snowflake_list_shared_objects',
    {
      description: `List data shares in the Snowflake account using SHOW SHARES.

Returns shares with: name, kind, owner_account, database_name, and recipient information.`,
      inputSchema: {},
    },
    async () => {
      const raw = await runQuery('SHOW SHARES');
      const parsed = parseQueryResult(raw);
      return {
        content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
      };
    },
  );

  return tools;
};
