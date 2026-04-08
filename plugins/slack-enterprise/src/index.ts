import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isEnterpriseAuthenticated, waitForEnterpriseAuth } from './slack-enterprise-api.js';

// Messages
import { sendMessage } from './tools/send-message.js';
import { readMessages } from './tools/read-messages.js';
import { readThread } from './tools/read-thread.js';
import { replyToThread } from './tools/reply-to-thread.js';
import { reactToMessage } from './tools/react-to-message.js';
import { updateMessage } from './tools/update-message.js';
import { deleteMessage } from './tools/delete-message.js';

// Search
import { searchMessages } from './tools/search-messages.js';
import { searchFiles } from './tools/search-files.js';
import { searchUsers } from './tools/search-users.js';
import { searchChannels } from './tools/search-channels.js';

// Channels
import { listChannels } from './tools/list-channels.js';
import { getChannelInfo } from './tools/get-channel-info.js';
import { listMembers } from './tools/list-members.js';

// Conversations
import { openDm } from './tools/open-dm.js';
import { createChannel } from './tools/create-channel.js';
import { archiveChannel } from './tools/archive-channel.js';
import { unarchiveChannel } from './tools/unarchive-channel.js';
import { setChannelTopic } from './tools/set-channel-topic.js';
import { setChannelPurpose } from './tools/set-channel-purpose.js';
import { inviteToChannel } from './tools/invite-to-channel.js';
import { kickFromChannel } from './tools/kick-from-channel.js';
import { renameChannel } from './tools/rename-channel.js';
import { joinChannel } from './tools/join-channel.js';
import { leaveChannel } from './tools/leave-channel.js';

// Users
import { getUserInfo } from './tools/get-user-info.js';
import { listUsers } from './tools/list-users.js';
import { getMyProfile } from './tools/get-my-profile.js';

// Files
import { getFileInfo } from './tools/get-file-info.js';
import { listFiles } from './tools/list-files.js';
import { uploadFile } from './tools/upload-file.js';

// Pins
import { pinMessage } from './tools/pin-message.js';
import { unpinMessage } from './tools/unpin-message.js';
import { listPins } from './tools/list-pins.js';

// Stars
import { starMessage } from './tools/star-message.js';
import { starFile } from './tools/star-file.js';
import { unstarMessage } from './tools/unstar-message.js';
import { unstarFile } from './tools/unstar-file.js';
import { listStars } from './tools/list-stars.js';

// Reactions
import { removeReaction } from './tools/remove-reaction.js';
import { getReactions } from './tools/get-reactions.js';

// Bookmarks
import { listBookmarks } from './tools/list-bookmarks.js';
import { addBookmark } from './tools/add-bookmark.js';
import { removeBookmark } from './tools/remove-bookmark.js';

// User Groups
import { listUserGroups } from './tools/list-user-groups.js';
import { listUserGroupMembers } from './tools/list-user-group-members.js';

// Profile
import { setStatus } from './tools/set-status.js';

// Reminders
import { addReminder } from './tools/add-reminder.js';
import { listReminders } from './tools/list-reminders.js';
import { deleteReminder } from './tools/delete-reminder.js';
import { completeReminder } from './tools/complete-reminder.js';
// Note: complete_reminder and delete_reminder may return not_found on some
// Enterprise Grid configurations due to cross-team ID resolution limitations.

// Do Not Disturb
import { setSnooze } from './tools/set-snooze.js';
import { endSnooze } from './tools/end-snooze.js';
import { getDndStatus } from './tools/get-dnd-status.js';

class SlackEnterprisePlugin extends OpenTabsPlugin {
  readonly name = 'slack-enterprise';
  readonly description = 'OpenTabs plugin for Slack Enterprise Grid';
  override readonly displayName = 'Slack Enterprise';
  readonly urlPatterns = ['*://app.slack.com/*'];
  override readonly homepage = 'https://app.slack.com';

  readonly tools: ToolDefinition[] = [
    // Messages
    sendMessage,
    readMessages,
    readThread,
    replyToThread,
    reactToMessage,
    updateMessage,
    deleteMessage,
    // Search
    searchMessages,
    searchFiles,
    searchUsers,
    searchChannels,
    // Channels
    listChannels,
    getChannelInfo,
    listMembers,
    // Conversations
    openDm,
    createChannel,
    archiveChannel,
    unarchiveChannel,
    setChannelTopic,
    setChannelPurpose,
    inviteToChannel,
    kickFromChannel,
    renameChannel,
    joinChannel,
    leaveChannel,
    // Users
    getUserInfo,
    listUsers,
    getMyProfile,
    // Files
    getFileInfo,
    listFiles,
    uploadFile,
    // Pins
    pinMessage,
    unpinMessage,
    listPins,
    // Stars
    starMessage,
    starFile,
    unstarMessage,
    unstarFile,
    listStars,
    // Reactions
    removeReaction,
    getReactions,
    // Bookmarks
    listBookmarks,
    addBookmark,
    removeBookmark,
    // User Groups
    listUserGroups,
    listUserGroupMembers,
    // Profile
    setStatus,
    // Reminders
    addReminder,
    listReminders,
    deleteReminder,
    completeReminder,
    // Do Not Disturb
    setSnooze,
    endSnooze,
    getDndStatus,
  ];

  async isReady(): Promise<boolean> {
    if (isEnterpriseAuthenticated()) return true;
    return waitForEnterpriseAuth();
  }
}

export default new SlackEnterprisePlugin();
