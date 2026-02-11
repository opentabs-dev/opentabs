import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

const messageSchema = z.object({
  type: z.string().describe('Message type (e.g., "message")'),
  user: z.string().optional().describe('User ID who sent the message'),
  text: z.string().describe('Message text content'),
  ts: z.string().describe('Message timestamp — unique message identifier'),
})

export const readMessages = defineTool({
  name: 'read_messages',
  description: 'Read recent messages from a Slack channel',
  input: z.object({
    channel: z.string().describe('Channel ID to read messages from (e.g., C01234567)'),
    limit: z.number().optional().describe('Maximum number of messages to return (default 20, max 1000)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the request was successful'),
    messages: z.array(messageSchema).describe('Array of messages in reverse chronological order'),
  }),
  handle: async (params) => {
    const body: Record<string, unknown> = { channel: params.channel, limit: params.limit ?? 20 }
    const res = await fetch('/api/conversations.history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to read messages', data.error ?? 'unknown_error')
    }
    return { ok: data.ok, messages: data.messages }
  },
})
