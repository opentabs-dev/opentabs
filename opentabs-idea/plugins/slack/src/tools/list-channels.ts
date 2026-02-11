import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

const channelSchema = z.object({
  id: z.string().describe('Channel ID (e.g., C01234567)'),
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
})

export const listChannels = defineTool({
  name: 'list_channels',
  description: 'List channels in the Slack workspace',
  input: z.object({
    limit: z.number().optional().describe('Maximum number of channels to return (default 100, max 1000)'),
    types: z.string().optional().describe('Comma-separated channel types to include (default "public_channel" — options: public_channel, private_channel, mpim, im)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the request was successful'),
    channels: z.array(channelSchema).describe('Array of channels matching the filter criteria'),
  }),
  handle: async (params) => {
    const body: Record<string, unknown> = {
      limit: params.limit ?? 100,
      types: params.types ?? 'public_channel',
    }
    const res = await fetch('/api/conversations.list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to list channels', data.error ?? 'unknown_error')
    }
    return { ok: data.ok, channels: data.channels }
  },
})
