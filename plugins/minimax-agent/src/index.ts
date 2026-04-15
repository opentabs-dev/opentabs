import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth, resetWebpackCache } from './minimax-api.js';
// Account
import { getCurrentUser } from './tools/get-current-user.js';
import { getMembershipInfo } from './tools/get-membership-info.js';
import { getCreditDetails } from './tools/get-credit-details.js';
// Chats
import { listChats } from './tools/list-chats.js';
import { getChatDetail } from './tools/get-chat-detail.js';
import { newSession } from './tools/new-session.js';
import { sendMessage } from './tools/send-message.js';
import { renameChat } from './tools/rename-chat.js';
import { deleteChat } from './tools/delete-chat.js';
import { searchChats } from './tools/search-chats.js';
// Experts
import { listExperts } from './tools/list-experts.js';
import { getExpert } from './tools/get-expert.js';
import { deleteExpert } from './tools/delete-expert.js';
import { pinExpert } from './tools/pin-expert.js';
import { voteExpert } from './tools/vote-expert.js';
import { listExpertTags } from './tools/list-expert-tags.js';
import { listHomepageExperts } from './tools/list-homepage-experts.js';
// Gallery
import { listGalleryCategories } from './tools/list-gallery-categories.js';
import { listGalleryFeed } from './tools/list-gallery-feed.js';
import { getGalleryDetail } from './tools/get-gallery-detail.js';
// Schedules
import { listCronJobs } from './tools/list-cron-jobs.js';
import { getCronJob } from './tools/get-cron-job.js';
import { createCronJob } from './tools/create-cron-job.js';
import { updateCronJob } from './tools/update-cron-job.js';
import { executeCronJob } from './tools/execute-cron-job.js';
import { listCronExecutions } from './tools/list-cron-executions.js';
// MCP Servers
import { listMcpServers } from './tools/list-mcp-servers.js';
import { addMcpServer } from './tools/add-mcp-server.js';
import { removeMcpServer } from './tools/remove-mcp-server.js';
// Workspace
import { getWorkspace } from './tools/get-workspace.js';
import { listWorkspaceMembers } from './tools/list-workspace-members.js';

class MinimaxAgentPlugin extends OpenTabsPlugin {
  readonly name = 'minimax-agent';
  readonly description =
    'OpenTabs plugin for MiniMax Agent — AI assistant platform for chat, experts, scheduled tasks, and agent automation';
  override readonly displayName = 'MiniMax Agent';
  readonly urlPatterns = ['*://agent.minimax.io/*', '*://agent.minimaxi.com/*'];
  override readonly homepage = 'https://agent.minimax.io';
  readonly tools: ToolDefinition[] = [
    // Account
    getCurrentUser,
    getMembershipInfo,
    getCreditDetails,
    // Chats
    listChats,
    getChatDetail,
    newSession,
    sendMessage,
    renameChat,
    deleteChat,
    searchChats,
    // Experts
    listExperts,
    getExpert,
    deleteExpert,
    pinExpert,
    voteExpert,
    listExpertTags,
    listHomepageExperts,
    // Gallery
    listGalleryCategories,
    listGalleryFeed,
    getGalleryDetail,
    // Schedules
    listCronJobs,
    getCronJob,
    createCronJob,
    updateCronJob,
    executeCronJob,
    listCronExecutions,
    // MCP Servers
    listMcpServers,
    addMcpServer,
    removeMcpServer,
    // Workspace
    getWorkspace,
    listWorkspaceMembers,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }

  override onDeactivate(): void {
    resetWebpackCache();
  }
}

export default new MinimaxAgentPlugin();
