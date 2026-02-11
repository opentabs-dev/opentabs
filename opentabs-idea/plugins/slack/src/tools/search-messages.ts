import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

const matchSchema = z.object({
  channel: z.object({
    id: z.string().describe('Channel ID where the message was found'),
    name: z.string().describe('Channel name'),
  }).describe('Channel information'),
  username: z.string().describe('Username of the message author'),
  text: z.string().describe('Message text content'),
  ts: z.string().describe('Message timestamp'),
  permalink: z.string().describe('Permanent link to the message'),
})

export const searchMessages = defineTool({
  name: 'search_messages',
  description: 'Search for messages across Slack channels',
  input: z.object({
    query: z.string().describe('Search query string — supports Slack search modifiers (e.g., "from:@user in:#channel")'),
    count: z.number().optional().describe('Number of results to return (default 20)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the search was successful'),
    messages: z.object({
      total: z.number().describe('Total number of matching messages'),
      matches: z.array(matchSchema).describe('Array of matching messages'),
    }).describe('Search results'),
  }),
  handle: async (params) => {
    const body: Record<string, unknown> = { query: params.query, count: params.count ?? 20 }
    const res = await fetch('/api/search.messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to search messages', data.error ?? 'unknown_error')
    }
    return { ok: data.ok, messages: data.messages }
  },
})
