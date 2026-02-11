import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const inviteToChannel = defineTool({
  name: 'invite_to_channel',
  description: 'Invite a user to a Slack channel',
  input: z.object({
    channel: z.string().describe('Channel ID to invite the user to (e.g., C01234567)'),
    users: z.string().describe('User ID to invite (e.g., U01234567)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the invitation was successful'),
    channel: z.object({
      id: z.string().describe('Channel ID the user was invited to'),
      name: z.string().describe('Channel name'),
    }).describe('The channel the user was invited to'),
  }),
  handle: async (params) => {
    const res = await fetch('/api/conversations.invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: params.channel, users: params.users }),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to invite user to channel', data.error ?? 'unknown_error')
    }
    return { ok: data.ok, channel: { id: data.channel.id, name: data.channel.name } }
  },
})
