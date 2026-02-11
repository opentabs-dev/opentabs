import { z } from 'zod'
import { defineTool, ToolError } from '@opentabs/plugin-sdk'

export const listFiles = defineTool({
  name: 'list_files',
  description: 'List files in a Slack channel or workspace with optional filters',
  input: z.object({
    channel: z.string().optional().describe('Channel ID to filter files by — omit to search the entire workspace'),
    count: z.number().optional().describe('Number of files to return (default 20, max 100)'),
    page: z.number().optional().describe('Page number for pagination (default 1)'),
    types: z.string().optional().describe('Filter by file type: all, spaces, snippets, images, gdocs, zips, pdfs (default all)'),
    user: z.string().optional().describe('Filter files by the user who uploaded them (user ID)'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the request was successful'),
    files: z.array(z.object({
      id: z.string().describe('File ID'),
      name: z.string().describe('File name'),
      title: z.string().describe('File title'),
      filetype: z.string().describe('File type identifier (e.g., png, pdf, txt)'),
      size: z.number().describe('File size in bytes'),
      user: z.string().describe('User ID of the uploader'),
      created: z.number().describe('Unix timestamp of when the file was created'),
      permalink: z.string().describe('Permanent link to the file in Slack'),
    })).describe('Array of file objects'),
    paging: z.object({
      count: z.number().describe('Number of files per page'),
      total: z.number().describe('Total number of files matching the filter'),
      page: z.number().describe('Current page number'),
      pages: z.number().describe('Total number of pages'),
    }).optional().describe('Pagination information'),
  }),
  handle: async (params) => {
    const body: Record<string, unknown> = {
      count: params.count ?? 20,
    }
    if (params.channel) body.channel = params.channel
    if (params.page) body.page = params.page
    if (params.types) body.types = params.types
    if (params.user) body.user = params.user
    const res = await fetch('/api/files.list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) {
      throw new ToolError(data.error ?? 'Failed to list files', data.error ?? 'unknown_error')
    }
    return {
      ok: data.ok,
      files: (data.files ?? []).map((f: Record<string, unknown>) => ({
        id: f.id as string,
        name: f.name as string,
        title: (f.title as string) ?? (f.name as string),
        filetype: (f.filetype as string) ?? '',
        size: (f.size as number) ?? 0,
        user: (f.user as string) ?? '',
        created: (f.created as number) ?? 0,
        permalink: (f.permalink as string) ?? '',
      })),
      paging: data.paging,
    }
  },
})
