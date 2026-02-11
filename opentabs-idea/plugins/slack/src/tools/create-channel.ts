import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const createChannel = defineTool({
  name: 'create_channel',
  description: 'Create a new public or private Slack channel',
  input: z.object({
    name: z.string().describe('Name for the new channel — must be lowercase, no spaces, max 80 chars (e.g., "project-updates")'),
    is_private: z.boolean().optional().describe('Whether to create a private channel (default false — creates public channel)'),
    topic: z.string().optional().describe('Initial topic for the channel'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the channel was created successfully'),
    channel: z.object({
      id: z.string().describe('ID of the newly created channel'),
      name: z.string().describe('Name of the created channel'),
      is_private: z.boolean().describe('Whether the channel is private'),
    }).describe('The newly created channel'),
  }),
  handle: async (params) => {
    const body: Record<string, unknown> = {
      name: params.name,
      is_private: params.is_private ?? false,
    }
    const res = await fetch('/api/conversations.create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to create channel', data.error ?? 'unknown_error')
    }
    if (params.topic) {
      await fetch('/api/conversations.setTopic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: data.channel.id, topic: params.topic }),
      })
    }
    return { ok: data.ok, channel: { id: data.channel.id, name: data.channel.name, is_private: data.channel.is_private } }
  },
})
