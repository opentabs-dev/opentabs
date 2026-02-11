import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const listMembers = defineTool({
  name: 'list_members',
  description: 'List members of a Slack channel with optional pagination',
  input: z.object({
    channel: z.string().describe('Channel ID to list members for (e.g., C01234567)'),
    limit: z.number().optional().describe('Maximum number of members to return (default 100, max 1000)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response for fetching the next page'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the request was successful'),
    members: z.array(z.string().describe('User ID')).describe('Array of user IDs who are members of the channel'),
    response_metadata: z.object({
      next_cursor: z.string().describe('Cursor for the next page of results — empty string if no more pages'),
    }).optional().describe('Pagination metadata'),
  }),
  handle: async (params) => {
    const body: Record<string, unknown> = {
      channel: params.channel,
      limit: params.limit ?? 100,
    }
    if (params.cursor) {
      body.cursor = params.cursor
    }
    const res = await fetch('/api/conversations.members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to list channel members', data.error ?? 'unknown_error')
    }
    return {
      ok: data.ok,
      members: data.members,
      response_metadata: data.response_metadata,
    }
  },
})
