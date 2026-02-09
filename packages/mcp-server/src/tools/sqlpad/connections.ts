import { success, sendServiceRequest, createToolRegistrar } from '../../utils.js';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

interface SqlpadConnection {
  id: string;
  name: string;
  driver: string;
  database: string;
  host?: string;
  port?: string;
  maxRows?: number;
  editable?: boolean;
  groups?: string[];
}

export const registerSqlpadConnectionsTools = (server: McpServer): Map<string, RegisteredTool> => {
  const { tools, define } = createToolRegistrar(server);

  // List all database connections
  define(
    'sqlpad_list_connections',
    {
      description: `List all available database connections in SQLPad.

Returns a list of database connections you have access to, including:
- id: Connection ID to use with other SQLPad tools
- name: Human-readable connection name
- driver: Database type (postgres, mysql, etc.)
- database: Database name
- host: Database host (if available)

Use the connection ID with sqlpad_run_query and sqlpad_get_schema tools.

Example usage:
1. Call sqlpad_list_connections to see available databases
2. Find the connection ID for the database you need (e.g., "billing-lifecycle-replica")
3. Use that ID with sqlpad_run_query to execute queries`,
      inputSchema: {
        search: z.string().optional().describe('Optional search term to filter connections by name (case-insensitive)'),
        env: z.enum(['production', 'staging']).optional().describe('SQLPad environment to query (default: production)'),
      },
    },
    async ({ search, env }) => {
      const connections = (await sendServiceRequest('sqlpad', {
        endpoint: '/api/connections',
        method: 'GET',
        ...(env && { env }),
      })) as SqlpadConnection[];

      // Filter by search term if provided
      let filtered = connections;
      if (search) {
        const searchLower = search.toLowerCase();
        filtered = connections.filter(
          conn =>
            conn.name.toLowerCase().includes(searchLower) ||
            conn.id.toLowerCase().includes(searchLower) ||
            conn.database?.toLowerCase().includes(searchLower),
        );
      }

      // Format output to be more readable
      const formatted = filtered.map(conn => ({
        id: conn.id,
        name: conn.name,
        driver: conn.driver,
        database: conn.database,
        host: conn.host,
        maxRows: conn.maxRows,
      }));

      return success({
        count: formatted.length,
        totalAvailable: connections.length,
        connections: formatted,
      });
    },
  );

  // Get details about a specific connection
  define(
    'sqlpad_get_connection',
    {
      description: `Get detailed information about a specific database connection.

Returns connection details including:
- Connection configuration
- Access groups
- Query timeout settings
- Maximum rows limit

Use sqlpad_list_connections first to find available connection IDs.`,
      inputSchema: {
        connectionId: z.string().describe('The connection ID (e.g., "billing-lifecycle-replica")'),
        env: z.enum(['production', 'staging']).optional().describe('SQLPad environment to query (default: production)'),
      },
    },
    async ({ connectionId, env }) => {
      // SQLPad doesn't have a single-connection endpoint; fetch all and filter
      const connections = (await sendServiceRequest('sqlpad', {
        endpoint: '/api/connections',
        method: 'GET',
        ...(env && { env }),
      })) as SqlpadConnection[];

      const conn = connections.find(c => c.id === connectionId) as
        | (SqlpadConnection & { queryTimeout?: string; preQueryStatements?: string })
        | undefined;

      if (!conn) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      return success({
        id: conn.id,
        name: conn.name,
        driver: conn.driver,
        database: conn.database,
        host: conn.host,
        port: conn.port,
        maxRows: conn.maxRows,
        queryTimeout: conn.queryTimeout,
        groups: conn.groups,
      });
    },
  );

  return tools;
};
