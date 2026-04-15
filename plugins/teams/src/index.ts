import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { clearCaches, isTeamsAuthenticated, waitForTeamsAuth } from './teams-api.js';
import { addMember } from './tools/add-member.js';
import { createChat } from './tools/create-chat.js';
import { deleteMessage } from './tools/delete-message.js';
import { editMessage } from './tools/edit-message.js';
import { getConversationDetails } from './tools/get-conversation-details.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { listConversations } from './tools/list-conversations.js';
import { readMessages } from './tools/read-messages.js';
import { removeMember } from './tools/remove-member.js';
import { sendMessage } from './tools/send-message.js';
import { setChannelTopic } from './tools/set-channel-topic.js';

class TeamsPlugin extends OpenTabsPlugin {
  readonly name = 'teams';
  readonly description = 'OpenTabs plugin for Microsoft Teams';
  override readonly displayName = 'Microsoft Teams';
  readonly urlPatterns = ['*://teams.live.com/*', '*://teams.microsoft.com/*'];
  override readonly homepage = 'https://teams.live.com/v2/';
  readonly tools: ToolDefinition[] = [
    // Chats
    listConversations,
    getConversationDetails,
    createChat,
    setChannelTopic,
    // Messages
    sendMessage,
    readMessages,
    editMessage,
    deleteMessage,
    // Members
    addMember,
    removeMember,
    // User
    getCurrentUser,
  ];

  override teardown(): void {
    clearCaches();
  }

  async isReady(): Promise<boolean> {
    if (isTeamsAuthenticated()) return true;
    return waitForTeamsAuth();
  }
}

export default new TeamsPlugin();
