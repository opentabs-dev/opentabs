import { registerSnowflakeAccountTools } from './account.js';
import { registerSnowflakeDataTools } from './data.js';
import { registerSnowflakeQueryTools } from './queries.js';
import { registerSnowflakeWorksheetTools } from './worksheets.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

type ToolRegistrationFn = (server: McpServer) => Map<string, RegisteredTool>;

export const registerTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  const registrations: ToolRegistrationFn[] = [
    registerSnowflakeQueryTools,
    registerSnowflakeDataTools,
    registerSnowflakeWorksheetTools,
    registerSnowflakeAccountTools,
  ];

  for (const register of registrations) {
    for (const [name, tool] of register(server)) {
      tools.set(name, tool);
    }
  }

  return tools;
};

export {
  registerSnowflakeQueryTools,
  registerSnowflakeDataTools,
  registerSnowflakeWorksheetTools,
  registerSnowflakeAccountTools,
};
