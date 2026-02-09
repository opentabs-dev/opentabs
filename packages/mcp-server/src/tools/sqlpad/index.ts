import { registerSqlpadConnectionsTools } from './connections.js';
import { registerSqlpadQueriesTools } from './queries.js';
import { registerSqlpadSchemaTools } from './schema.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

type ToolRegistrationFn = (server: McpServer) => Map<string, RegisteredTool>;

export const registerTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  const registrations: ToolRegistrationFn[] = [
    registerSqlpadConnectionsTools,
    registerSqlpadQueriesTools,
    registerSqlpadSchemaTools,
  ];

  for (const register of registrations) {
    for (const [name, tool] of register(server)) {
      tools.set(name, tool);
    }
  }

  return tools;
};

export { registerSqlpadConnectionsTools, registerSqlpadQueriesTools, registerSqlpadSchemaTools };
