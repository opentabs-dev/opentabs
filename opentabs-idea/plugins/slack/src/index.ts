import { OpenTabsPlugin, type ToolDefinition } from '@opentabs/plugin-sdk'
import { sendMessage } from './tools/send-message.js'
import { readMessages } from './tools/read-messages.js'
import { searchMessages } from './tools/search-messages.js'
import { listChannels } from './tools/list-channels.js'
import { getChannelInfo } from './tools/get-channel-info.js'
import { createChannel } from './tools/create-channel.js'
import { setChannelTopic } from './tools/set-channel-topic.js'
import { setChannelPurpose } from './tools/set-channel-purpose.js'
import { inviteToChannel } from './tools/invite-to-channel.js'
import { listMembers } from './tools/list-members.js'
import { getUserProfile } from './tools/get-user-profile.js'
import { listUsers } from './tools/list-users.js'
import { uploadFile } from './tools/upload-file.js'
import { listFiles } from './tools/list-files.js'
import { addReaction } from './tools/add-reaction.js'
import { removeReaction } from './tools/remove-reaction.js'
import { pinMessage } from './tools/pin-message.js'
import { unpinMessage } from './tools/unpin-message.js'

class SlackPlugin extends OpenTabsPlugin {
  readonly name = "slack"
  readonly version = '0.0.1'
  readonly description = "OpenTabs plugin for Slack"
  readonly displayName = "Slack"
  readonly urlPatterns = ["*://*.slack.com/*"]
  readonly tools: ToolDefinition[] = [
    sendMessage,
    readMessages,
    searchMessages,
    listChannels,
    getChannelInfo,
    createChannel,
    setChannelTopic,
    setChannelPurpose,
    inviteToChannel,
    listMembers,
    getUserProfile,
    listUsers,
    uploadFile,
    listFiles,
    addReaction,
    removeReaction,
    pinMessage,
    unpinMessage,
  ]

  async isReady(): Promise<boolean> {
    try {
      const res = await fetch('/api/auth.test', { method: 'POST' })
      const data = await res.json()
      return data.ok === true
    } catch {
      return false
    }
  }
}

export default new SlackPlugin()
