import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const getChannelInfo = defineTool({
  name: 'get_channel_info',
  description: 'Get detailed information about a Slack channel including topic, purpose, and member count',
  input: z.object({
    channel: z.string().describe('Channel ID to get info for (e.g., C01234567)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the request was successful'),
    channel: z.object({
      id: z.string().describe('Channel ID'),
      name: z.string().describe('Channel name without the # prefix'),
      is_channel: z.boolean().describe('Whether this is a public channel'),
      is_private: z.boolean().describe('Whether this is a private channel'),
      num_members: z.number().describe('Number of members in the channel'),
      topic: z.object({
        value: z.string().describe('Channel topic text'),
      }).describe('Channel topic'),
      purpose: z.object({
        value: z.string().describe('Channel purpose text'),
      }).describe('Channel purpose'),
    }).describe('Detailed channel information'),
  }),
  handle: async (params) => {
    const res = await fetch('/api/conversations.info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: params.channel }),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to get channel info', data.error ?? 'unknown_error')
    }
    return { ok: data.ok, channel: data.channel }
  },
})
