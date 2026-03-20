import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './outlook-api.js';
import { createDraft } from './tools/create-draft.js';
import { deleteMessage } from './tools/delete-message.js';
import { forwardMessage } from './tools/forward-message.js';
import { getAttachmentContent } from './tools/get-attachment-content.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getMessage } from './tools/get-message.js';
import { listAttachments } from './tools/list-attachments.js';
import { listFolders } from './tools/list-folders.js';
import { listMessages } from './tools/list-messages.js';
import { moveMessage } from './tools/move-message.js';
import { replyToMessage } from './tools/reply-to-message.js';
import { searchMessages } from './tools/search-messages.js';
import { sendMessage } from './tools/send-message.js';
import { updateMessage } from './tools/update-message.js';

class OutlookPlugin extends OpenTabsPlugin {
  readonly name = 'outlook';
  readonly description = 'OpenTabs plugin for Microsoft Outlook — read, search, send, and manage emails';
  override readonly displayName = 'Microsoft Outlook';
  readonly urlPatterns = [
    '*://outlook.cloud.microsoft/*',
    '*://outlook.live.com/*',
    '*://outlook.office.com/*',
    '*://outlook.office365.com/*',
  ];
  override readonly homepage = 'https://outlook.cloud.microsoft';
  readonly tools: ToolDefinition[] = [
    // Account
    getCurrentUser,
    // Messages
    listMessages,
    getMessage,
    searchMessages,
    sendMessage,
    replyToMessage,
    forwardMessage,
    createDraft,
    updateMessage,
    moveMessage,
    deleteMessage,
    listAttachments,
    getAttachmentContent,
    // Folders
    listFolders,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new OutlookPlugin();
