import { registerRetoolAppTools } from './apps.js';
import { registerRetoolFolderTools } from './folders.js';
import { registerRetoolObservabilityTools } from './observability.js';
import { registerRetoolOrgTools } from './organization.js';
import { registerRetoolQueryTools } from './queries.js';
import { registerRetoolResourceTools } from './resources.js';
import { registerRetoolSourceControlTools } from './source-control.js';
import { registerRetoolWorkflowTools } from './workflows.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

type ToolRegistrationFn = (server: McpServer) => Map<string, RegisteredTool>;

export const registerRetoolTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  const registrations: ToolRegistrationFn[] = [
    registerRetoolOrgTools,
    registerRetoolAppTools,
    registerRetoolWorkflowTools,
    registerRetoolResourceTools,
    registerRetoolQueryTools,
    registerRetoolFolderTools,
    registerRetoolSourceControlTools,
    registerRetoolObservabilityTools,
  ];

  for (const register of registrations) {
    for (const [name, tool] of register(server)) {
      tools.set(name, tool);
    }
  }

  return tools;
};

export {
  registerRetoolOrgTools,
  registerRetoolAppTools,
  registerRetoolWorkflowTools,
  registerRetoolResourceTools,
  registerRetoolQueryTools,
  registerRetoolFolderTools,
  registerRetoolSourceControlTools,
  registerRetoolObservabilityTools,
};
