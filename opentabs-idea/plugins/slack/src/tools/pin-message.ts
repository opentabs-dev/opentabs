import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const pinMessage = defineTool({
  name: 'pin_message',
  description: 'Pin a message to a Slack channel',
  input: z.object({
    channel: z.string().describe('Channel ID where the message is located (e.g., C01234567)'),
    timestamp: z.string().describe('Timestamp of the message to pin (e.g., 1234567890.123456)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the message was pinned successfully'),
  }),
  handle: async (params) => {
    const res = await fetch('/api/pins.add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: params.channel,
        timestamp: params.timestamp,
      }),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to pin message', data.error ?? 'unknown_error')
    }
    return { ok: data.ok }
  },
})
