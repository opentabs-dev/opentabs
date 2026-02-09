import { registerChannelTools } from './channels.js';
import { registerConversationTools } from './conversations.js';
import { registerFileTools } from './files.js';
import { registerMessageTools } from './messages.js';
import { registerPinTools } from './pins.js';
import { registerReactionTools } from './reactions.js';
import { registerSearchTools } from './search.js';
import { registerStarTools } from './stars.js';
import { registerUserTools } from './users.js';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

type ToolRegistrationFn = (server: McpServer) => Map<string, RegisteredTool>;

export const registerTools = (server: McpServer): Map<string, RegisteredTool> => {
  const tools = new Map<string, RegisteredTool>();

  const registrations: ToolRegistrationFn[] = [
    registerMessageTools,
    registerSearchTools,
    registerChannelTools,
    registerConversationTools,
    registerUserTools,
    registerFileTools,
    registerPinTools,
    registerStarTools,
    registerReactionTools,
  ];

  for (const register of registrations) {
    for (const [name, tool] of register(server)) {
      tools.set(name, tool);
    }
  }

  return tools;
};

export {
  registerChannelTools,
  registerConversationTools,
  registerFileTools,
  registerMessageTools,
  registerPinTools,
  registerReactionTools,
  registerSearchTools,
  registerStarTools,
  registerUserTools,
};
