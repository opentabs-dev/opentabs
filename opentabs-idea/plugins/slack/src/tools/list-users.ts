import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const listUsers = defineTool({
  name: 'list_users',
  description: 'List users in the Slack workspace with optional pagination',
  input: z.object({
    limit: z.number().optional().describe('Maximum number of users to return (default 100, max 1000)'),
    cursor: z.string().optional().describe('Pagination cursor from a previous response for fetching the next page'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the request was successful'),
    members: z.array(z.object({
      id: z.string().describe('User ID'),
      name: z.string().describe('Username (handle)'),
      real_name: z.string().describe('Full display name'),
      is_admin: z.boolean().describe('Whether the user is a workspace admin'),
      is_bot: z.boolean().describe('Whether the user is a bot'),
    })).describe('Array of user objects'),
    response_metadata: z.object({
      next_cursor: z.string().describe('Cursor for the next page of results — empty string if no more pages'),
    }).optional().describe('Pagination metadata'),
  }),
  handle: async (params) => {
    const body: Record<string, unknown> = {
      limit: params.limit ?? 100,
    }
    if (params.cursor) {
      body.cursor = params.cursor
    }
    const res = await fetch('/api/users.list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to list users', data.error ?? 'unknown_error')
    }
    return {
      ok: data.ok,
      members: (data.members ?? []).map((m: Record<string, unknown>) => ({
        id: m.id as string,
        name: m.name as string,
        real_name: (m.real_name as string) ?? '',
        is_admin: (m.is_admin as boolean) ?? false,
        is_bot: (m.is_bot as boolean) ?? false,
      })),
      response_metadata: data.response_metadata,
    }
  },
})
