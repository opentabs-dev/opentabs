import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './linkedin-api.js';
import { getConversationMessages } from './tools/get-conversation-messages.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getMailboxCounts } from './tools/get-mailbox-counts.js';
import { getUserProfile } from './tools/get-user-profile.js';
import { listConversations } from './tools/list-conversations.js';
import { sendMessage } from './tools/send-message.js';

class LinkedInPlugin extends OpenTabsPlugin {
  readonly name = 'linkedin';
  readonly description = 'OpenTabs plugin for LinkedIn';
  override readonly displayName = 'LinkedIn';
  readonly urlPatterns = ['*://*.linkedin.com/*'];
  override readonly homepage = 'https://www.linkedin.com';
  readonly tools: ToolDefinition[] = [
    // Profile
    getCurrentUser,
    getUserProfile,
    // Messaging
    listConversations,
    getConversationMessages,
    sendMessage,
    getMailboxCounts,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new LinkedInPlugin();
