import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './glama-api.js';
import { getChatSessionTool } from './tools/get-chat-session.js';
import { getCurrentUserTool } from './tools/get-current-user.js';
import { getServer } from './tools/get-server.js';
import { getServerScore } from './tools/get-server-score.js';
import { listAvailableModelsTool } from './tools/list-available-models.js';
import { listGatewayModels } from './tools/list-gateway-models.js';
import { listMcpClients } from './tools/list-mcp-clients.js';
import { listPopularServers } from './tools/list-popular-servers.js';
import { listProjectsTool } from './tools/list-projects.js';
import { listRecentChatsTool } from './tools/list-recent-chats.js';
import { listServerCategories } from './tools/list-server-categories.js';
import { listServerTools } from './tools/list-server-tools.js';
import { listServersByCategory } from './tools/list-servers-by-category.js';
import { searchServers } from './tools/search-servers.js';
import { searchTools } from './tools/search-tools.js';

class GlamaPlugin extends OpenTabsPlugin {
  readonly name = 'glama';
  readonly description = 'OpenTabs plugin for Glama';
  override readonly displayName = 'Glama';
  readonly urlPatterns = ['*://*.glama.ai/*'];
  override readonly homepage = 'https://glama.ai';
  readonly tools: ToolDefinition[] = [
    searchServers,
    getServer,
    listPopularServers,
    listServerTools,
    listServerCategories,
    listServersByCategory,
    getServerScore,
    searchTools,
    listMcpClients,
    listRecentChatsTool,
    getChatSessionTool,
    listAvailableModelsTool,
    listProjectsTool,
    listGatewayModels,
    getCurrentUserTool,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new GlamaPlugin();
