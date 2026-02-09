import { success, sendServiceRequest, defineTool } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

interface QueryColumn {
  name: string;
  datatype: string;
}

export const registerSqlpadQueriesTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  // Run a SQL query
  defineTool(
    tools,
    server,
    'sqlpad_run_query',
    {
      description: `Execute a SQL query on a database connection and return the results.

This is the main tool for running SQL queries against databases via SQLPad.

Parameters:
- connectionId: The database connection ID (use sqlpad_list_connections to find available connections)
- query: The SQL query to execute
- maxRows: Maximum number of rows to return (default: 100, max varies by connection)

Common connection IDs:
- billing-lifecycle-replica: Billing lifecycle data (collection_promises, auto_collection_settings)
- ledger-replica: Ledger/accounting data
- present-replica: Present billing system
- legal-entities-replica: Legal entity configurations

Example queries:
- SELECT * FROM collection_promises WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT 10
- SELECT id, status, amount FROM auto_collection_settings WHERE journal_account_id = 'joa_xxx'

The tool waits for the query to complete and returns:
- columns: Column names and types
- rows: Result data
- rowCount: Number of rows returned
- executionTime: How long the query took

Note: Queries have a timeout (usually 5 minutes). For complex queries, consider adding LIMIT clauses.`,
      inputSchema: {
        connectionId: z.string().describe('Database connection ID (e.g., "billing-lifecycle-replica")'),
        query: z.string().describe('SQL query to execute'),
        maxRows: z
          .number()
          .optional()
          .default(100)
          .describe('Maximum rows to return (default: 100). Set higher for large result sets.'),
        env: z.enum(['production', 'staging']).optional().describe('SQLPad environment to query (default: production)'),
      },
    },
    async ({ connectionId, query, maxRows, env }) => {
      const effectiveMaxRows = maxRows ?? 100;

      // Use the adapter's runQuery action which handles submit → poll → fetch
      const result = (await sendServiceRequest(
        'sqlpad',
        {
          connectionId,
          query,
          maxRows: effectiveMaxRows,
          ...(env && { env }),
        },
        'runQuery',
      )) as {
        executionTimeMs: number;
        columns?: QueryColumn[];
        rowCount: number;
        rows: Record<string, unknown>[];
        truncated: boolean;
      };

      return success({
        status: 'success',
        executionTimeMs: result.executionTimeMs,
        columns: result.columns?.map(c => ({ name: c.name, type: c.datatype })),
        rowCount: result.rowCount,
        returnedRows: result.rows.length,
        truncated: result.truncated,
        rows: result.rows,
      });
    },
  );

  // List saved queries
  defineTool(
    tools,
    server,
    'sqlpad_list_saved_queries',
    {
      description: `List saved SQL queries in SQLPad.

Returns a list of your saved queries including:
- id: Query ID
- name: Query name
- connectionId: Associated database connection

Use this to find and reuse previously saved queries.`,
      inputSchema: {
        search: z.string().optional().describe('Optional search term to filter queries by name'),
        limit: z.number().optional().default(50).describe('Maximum number of queries to return (default: 50)'),
        env: z.enum(['production', 'staging']).optional().describe('SQLPad environment to query (default: production)'),
      },
    },
    async ({ search, limit, env }) => {
      const effectiveLimit = limit ?? 50;

      interface SavedQuery {
        id: string;
        name: string;
        connectionId?: string;
        createdAt?: string;
        updatedAt?: string;
      }

      let queries = (await sendServiceRequest('sqlpad', {
        endpoint: '/api/queries',
        method: 'GET',
        ...(env && { env }),
      })) as SavedQuery[];

      // Filter by search term if provided
      if (search) {
        const searchLower = search.toLowerCase();
        queries = queries.filter(q => q.name?.toLowerCase().includes(searchLower));
      }

      // Limit results
      queries = queries.slice(0, effectiveLimit);

      const formatted = queries.map(q => ({
        id: q.id,
        name: q.name,
        connectionId: q.connectionId,
        updatedAt: q.updatedAt,
      }));

      return success({
        count: formatted.length,
        queries: formatted,
      });
    },
  );

  // Get a saved query
  defineTool(
    tools,
    server,
    'sqlpad_get_saved_query',
    {
      description: `Get a saved SQL query by ID, including the full query text.

Returns:
- id: Query ID
- name: Query name
- queryText: The full SQL query
- connectionId: Associated database connection

Use sqlpad_list_saved_queries first to find query IDs.`,
      inputSchema: {
        queryId: z.string().describe('The saved query ID'),
        env: z.enum(['production', 'staging']).optional().describe('SQLPad environment to query (default: production)'),
      },
    },
    async ({ queryId, env }) => {
      interface SavedQueryDetail {
        id: string;
        name: string;
        queryText?: string;
        connectionId?: string;
        createdAt?: string;
        updatedAt?: string;
      }

      const query = (await sendServiceRequest('sqlpad', {
        endpoint: `/api/queries/${queryId}`,
        method: 'GET',
        ...(env && { env }),
      })) as SavedQueryDetail;

      return success({
        id: query.id,
        name: query.name,
        queryText: query.queryText,
        connectionId: query.connectionId,
        createdAt: query.createdAt,
        updatedAt: query.updatedAt,
      });
    },
  );

  return tools;
};
