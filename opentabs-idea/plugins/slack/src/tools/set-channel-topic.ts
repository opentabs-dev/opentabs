import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const setChannelTopic = defineTool({
  name: 'set_channel_topic',
  description: 'Set the topic of a Slack channel',
  input: z.object({
    channel: z.string().describe('Channel ID to set the topic for (e.g., C01234567)'),
    topic: z.string().describe('New topic text for the channel (max 250 chars)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the topic was set successfully'),
    topic: z.string().describe('The topic that was set'),
  }),
  handle: async (params) => {
    const res = await fetch('/api/conversations.setTopic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: params.channel, topic: params.topic }),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to set channel topic', data.error ?? 'unknown_error')
    }
    return { ok: data.ok, topic: data.topic }
  },
})
