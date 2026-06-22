import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './chatgpt-api.js';
import { archiveConversation } from './tools/archive-conversation.js';
import { deleteConversation } from './tools/delete-conversation.js';
import { discoverGpts } from './tools/discover-gpts.js';
import { downloadFile, getFileContent } from './tools/file-download.js';
import { getAccountInfo } from './tools/get-account-info.js';
import { getBetaFeatures } from './tools/get-beta-features.js';
import { getConversation } from './tools/get-conversation.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getCustomInstructions } from './tools/get-custom-instructions.js';
import { getGpt } from './tools/get-gpt.js';
import { getMemories } from './tools/get-memories.js';
import { getPromptLibrary } from './tools/get-prompt-library.js';
import { sendImageMessage, uploadImage } from './tools/image-message.js';
import { listConversations } from './tools/list-conversations.js';
import { listConversationFiles } from './tools/list-conversation-files.js';
import { listModels } from './tools/list-models.js';
import { listSharedConversations } from './tools/list-shared-conversations.js';
import { renameConversation } from './tools/rename-conversation.js';
import { searchConversations } from './tools/search-conversations.js';
import { sendMessage } from './tools/send-message.js';
import { starConversation } from './tools/star-conversation.js';
import { unarchiveConversation } from './tools/unarchive-conversation.js';
import { unstarConversation } from './tools/unstar-conversation.js';
import { updateCustomInstructions } from './tools/update-custom-instructions.js';

class ChatGPTPlugin extends OpenTabsPlugin {
  readonly name = 'chatgpt';
  readonly description = 'OpenTabs plugin for ChatGPT';
  override readonly displayName = 'ChatGPT';
  readonly urlPatterns = ['*://*.chatgpt.com/*'];
  override readonly homepage = 'https://chatgpt.com';
  readonly tools: ToolDefinition[] = [
    // Account
    getCurrentUser,
    getAccountInfo,
    // Models
    listModels,
    // Conversations
    listConversations,
    getConversation,
    sendMessage,
    uploadImage,
    sendImageMessage,
    searchConversations,
    renameConversation,
    archiveConversation,
    unarchiveConversation,
    starConversation,
    unstarConversation,
    deleteConversation,
    listSharedConversations,
    // Files
    listConversationFiles,
    getFileContent,
    downloadFile,
    // Memories
    getMemories,
    // Settings
    getCustomInstructions,
    updateCustomInstructions,
    getBetaFeatures,
    // Prompts
    getPromptLibrary,
    // GPTs
    getGpt,
    discoverGpts,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new ChatGPTPlugin();
