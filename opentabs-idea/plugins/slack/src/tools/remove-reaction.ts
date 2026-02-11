import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const removeReaction = defineTool({
  name: 'remove_reaction',
  description: 'Remove an emoji reaction from a Slack message',
  input: z.object({
    channel: z.string().describe('Channel ID where the message is located (e.g., C01234567)'),
    timestamp: z.string().describe('Timestamp of the message to remove the reaction from (e.g., 1234567890.123456)'),
    name: z.string().describe('Emoji name without colons (e.g., thumbsup, heart, rocket)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the reaction was removed successfully'),
  }),
  handle: async (params) => {
    const res = await fetch('/api/reactions.remove', {
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
      throw new ToolError(data.error ?? 'Failed to remove reaction', data.error ?? 'unknown_error')
    }
    return { ok: data.ok }
  },
})
