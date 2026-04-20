// Outlook on cloud.microsoft enforces Trusted Types (CSP). Zod's allowsEval
// feature-detect calls new Function("") the first time a zod parser runs
// (lazy, memoized via cached()). This policy just needs to exist before that
// first runtime call — import statements are hoisted regardless, but the probe
// only fires when a tool handler first invokes a zod schema at runtime.
if (typeof window !== 'undefined') {
  try {
    const tt = (window as Window & {
      trustedTypes?: TrustedTypePolicyFactory & { defaultPolicy?: TrustedTypePolicy | null };
    }).trustedTypes;
    if (tt && !tt.defaultPolicy) {
      tt.createPolicy('default', {
        createScript: (s: string) => {
          // Only allow the empty-string probe used by zod's allowsEval feature-detect.
          if (s !== '') throw new TypeError('Blocked Trusted Types script conversion');
          return s;
        },
      });
    }
  } catch {
    // 'default' policy already exists, or Trusted Types not supported — safe to ignore.
  }
}

import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './outlook-api.js';
import { createDraft } from './tools/create-draft.js';
import { deleteMessage } from './tools/delete-message.js';
import { forwardMessage } from './tools/forward-message.js';
import { downloadAttachment } from './tools/download-attachment.js';
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
    downloadAttachment,
    // Folders
    listFolders,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new OutlookPlugin();
