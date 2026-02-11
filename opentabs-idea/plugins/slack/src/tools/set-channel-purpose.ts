import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const setChannelPurpose = defineTool({
  name: 'set_channel_purpose',
  description: 'Set the purpose of a Slack channel',
  input: z.object({
    channel: z.string().describe('Channel ID to set the purpose for (e.g., C01234567)'),
    purpose: z.string().describe('New purpose text for the channel (max 250 chars)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the purpose was set successfully'),
    purpose: z.string().describe('The purpose that was set'),
  }),
  handle: async (params) => {
    const res = await fetch('/api/conversations.setPurpose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: params.channel, purpose: params.purpose }),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to set channel purpose', data.error ?? 'unknown_error')
    }
    return { ok: data.ok, purpose: data.purpose }
  },
})
