import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const addReaction = defineTool({
  name: 'add_reaction',
  description: 'Add an emoji reaction to a Slack message',
  input: z.object({
    channel: z.string().describe('Channel ID where the message is located (e.g., C01234567)'),
    timestamp: z.string().describe('Timestamp of the message to react to — serves as the unique message ID (e.g., 1234567890.123456)'),
    name: z.string().describe('Emoji name without colons (e.g., thumbsup, heart, rocket)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the reaction was added successfully'),
  }),
  handle: async (params) => {
    const res = await fetch('/api/reactions.add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: params.channel,
        timestamp: params.timestamp,
        name: params.name,
      }),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to add reaction', data.error ?? 'unknown_error')
    }
    return { ok: data.ok }
  },
})
