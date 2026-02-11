import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const unpinMessage = defineTool({
  name: 'unpin_message',
  description: 'Unpin a message from a Slack channel',
  input: z.object({
    channel: z.string().describe('Channel ID where the message is pinned (e.g., C01234567)'),
    timestamp: z.string().describe('Timestamp of the message to unpin (e.g., 1234567890.123456)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the message was unpinned successfully'),
  }),
  handle: async (params) => {
    const res = await fetch('/api/pins.remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: params.channel,
        timestamp: params.timestamp,
      }),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to unpin message', data.error ?? 'unknown_error')
    }
    return { ok: data.ok }
  },
})
