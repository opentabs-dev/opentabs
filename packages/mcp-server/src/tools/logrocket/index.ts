import { registerLogrocketChartTools } from './charts.js';
import { registerLogrocketGalileoTools } from './galileo.js';
import { registerLogrocketIntegrationTools } from './integrations.js';
import { registerLogrocketIssueTools } from './issues.js';
import { registerLogrocketOrgTools } from './organization.js';
import { registerLogrocketSegmentTools } from './segments.js';
import { registerLogrocketSessionTools } from './sessions.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

type ToolRegistrationFn = (server: McpServer) => Map<string, RegisteredTool>;

export const registerLogrocketTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  const registrations: ToolRegistrationFn[] = [
    registerLogrocketOrgTools,
    registerLogrocketSessionTools,
    registerLogrocketIssueTools,
    registerLogrocketGalileoTools,
    registerLogrocketChartTools,
    registerLogrocketSegmentTools,
    registerLogrocketIntegrationTools,
  ];

  for (const register of registrations) {
    for (const [name, tool] of register(server)) {
      tools.set(name, tool);
    }
  }

  return tools;
};

export {
  registerLogrocketOrgTools,
  registerLogrocketSessionTools,
  registerLogrocketIssueTools,
  registerLogrocketGalileoTools,
  registerLogrocketChartTools,
  registerLogrocketSegmentTools,
  registerLogrocketIntegrationTools,
};
