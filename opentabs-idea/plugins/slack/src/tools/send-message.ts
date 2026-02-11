import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const sendMessage = defineTool({
  name: 'send_message',
  description: 'Send a message to a Slack channel',
  input: z.object({
    channel: z.string().describe('Channel ID to send the message to (e.g., C01234567)'),
    text: z.string().describe('Message text to send — supports Slack mrkdwn formatting'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the message was sent successfully'),
    channel: z.string().describe('Channel ID the message was posted to'),
    ts: z.string().describe('Timestamp of the posted message — used as a unique message ID'),
  }),
  handle: async (params) => {
    const res = await fetch('/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: params.channel, text: params.text }),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to send message', data.error ?? 'unknown_error')
    }
    return { ok: data.ok, channel: data.channel, ts: data.ts }
  },
})
