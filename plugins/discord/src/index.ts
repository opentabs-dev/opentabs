import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isDiscordAuthenticated, waitForDiscordAuth } from './discord-api.js';
import { sendMessage } from './tools/send-message.js';
import { editMessage } from './tools/edit-message.js';
import { deleteMessage } from './tools/delete-message.js';
import { readMessages } from './tools/read-messages.js';
import { readThread } from './tools/read-thread.js';
import { searchMessages } from './tools/search-messages.js';
import { getMessage } from './tools/get-message.js';
import { listPinnedMessages } from './tools/list-pinned-messages.js';
import { listGuilds } from './tools/list-guilds.js';
import { getGuildInfo } from './tools/get-guild-info.js';
import { listChannels } from './tools/list-channels.js';
import { getChannelInfo } from './tools/get-channel-info.js';
import { createChannel } from './tools/create-channel.js';
import { editChannel } from './tools/edit-channel.js';
import { deleteChannel } from './tools/delete-channel.js';
import { listMembers } from './tools/list-members.js';
import { listRoles } from './tools/list-roles.js';
import { getUserProfile } from './tools/get-user-profile.js';
import { listDms } from './tools/list-dms.js';
import { openDm } from './tools/open-dm.js';
import { addReaction } from './tools/add-reaction.js';
import { removeReaction } from './tools/remove-reaction.js';
import { pinMessage } from './tools/pin-message.js';
import { unpinMessage } from './tools/unpin-message.js';
import { createThread } from './tools/create-thread.js';
import { uploadFile } from './tools/upload-file.js';

class DiscordPlugin extends OpenTabsPlugin {
  readonly name = 'discord';
  readonly description = 'OpenTabs plugin for Discord';
  override readonly displayName = 'Discord';
  readonly urlPatterns = ['*://discord.com/*'];
  readonly tools: ToolDefinition[] = [
    // Messages
    sendMessage,
    editMessage,
    deleteMessage,
    readMessages,
    readThread,
    searchMessages,
    getMessage,
    listPinnedMessages,
    // Servers
    listGuilds,
    getGuildInfo,
    // Channels
    listChannels,
    getChannelInfo,
    createChannel,
    editChannel,
    deleteChannel,
    // Members & Roles
    listMembers,
    listRoles,
    getUserProfile,
    // DMs
    listDms,
    openDm,
    // Reactions & Pins
    addReaction,
    removeReaction,
    pinMessage,
    unpinMessage,
    // Threads
    createThread,
    // Files
    uploadFile,
  ];

  async isReady(): Promise<boolean> {
    if (isDiscordAuthenticated()) return true;
    return waitForDiscordAuth();
  }
}

export default new DiscordPlugin();
