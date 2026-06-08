import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './outlook-api.js';
import { createDraft } from './tools/create-draft.js';
import { createEvent } from './tools/create-event.js';
import { deleteEvent } from './tools/delete-event.js';
import { deleteMessage } from './tools/delete-message.js';
import { forwardMessage } from './tools/forward-message.js';
import { downloadAttachment } from './tools/download-attachment.js';
import { getAttachmentContent } from './tools/get-attachment-content.js';
import { getCalendarView } from './tools/get-calendar-view.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getEvent } from './tools/get-event.js';
import { getMessage } from './tools/get-message.js';
import { getSchedule } from './tools/get-schedule.js';
import { listAttachments } from './tools/list-attachments.js';
import { listCalendars } from './tools/list-calendars.js';
import { listEvents } from './tools/list-events.js';
import { listFolders } from './tools/list-folders.js';
import { listMessages } from './tools/list-messages.js';
import { moveMessage } from './tools/move-message.js';
import { replyToMessage } from './tools/reply-to-message.js';
import { respondToEvent } from './tools/respond-to-event.js';
import { searchMessages } from './tools/search-messages.js';
import { sendMessage } from './tools/send-message.js';
import { updateEvent } from './tools/update-event.js';
import { updateMessage } from './tools/update-message.js';

class OutlookPlugin extends OpenTabsPlugin {
  readonly name = 'outlook';
  readonly description =
    'OpenTabs plugin for Microsoft Outlook — read, search, send, and manage emails, and view and manage calendar events';
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
    // Calendar
    listCalendars,
    listEvents,
    getCalendarView,
    getEvent,
    createEvent,
    updateEvent,
    deleteEvent,
    respondToEvent,
    getSchedule,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new OutlookPlugin();
